import { ExpertTools, isToolName, toolRegistry } from "../../expert/tools.js";
import { rangeSchema, scopeSchema } from "../../expert/schemas.js";
import type { Range, Scope } from "../contracts.js";
import { minimumCloudData } from "./privacy.js";

// Shared cloud boundary: provider requests never get SQL, filesystem access or
// unscoped tool results. Each execution uses the authoritative read-only tools.
export class ScopedCloudTools {
  readonly #scope: Scope;
  readonly #ranges: Range[];
  #calls = 0;
  #characters = 0;
  readonly #repeated = new Map<string, number>();
  constructor(private readonly path: string, scope: Scope, ranges: Range[]) {
    this.#scope = scopeSchema.parse(scope);
    this.#ranges = ranges.map(range => rangeSchema.parse(range));
    if (!this.#ranges.length || this.#ranges.length > 2) throw new Error("Choose one or two bounded analysis periods");
  }
  call(name: string, raw: unknown): string {
    if (++this.#calls > 12) throw new Error("OSCAR tool-call limit reached");
    if (!isToolName(name)) throw new Error("Unapproved OSCAR tool");
    // Parse before scope checks/cache keys; property order cannot evade the
    // repetition bound. ExpertTools retains its own validation before querying.
    const input = toolRegistry[name].schema.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid OSCAR tool arguments");
    const ranges = name === "compare_ranges" ? [input.current, input.baseline] : name === "get_statistics" ? [input] : [{startDate: input.date, endDate: input.date}];
    for (const rawRange of ranges) {
      const parsed = rangeSchema.safeParse(rawRange);
      if (!parsed.success || !this.#ranges.some(allowed => parsed.data.startDate >= allowed.startDate && parsed.data.endDate <= allowed.endDate)) throw new Error("OSCAR tool requested dates outside the selected analysis");
    }
    const key = `${name}:${JSON.stringify(input)}`, count = (this.#repeated.get(key) ?? 0) + 1;
    this.#repeated.set(key, count);
    if (count > 2) throw new Error("Repeated OSCAR tool-call loop detected");
    const tools = new ExpertTools(this.path, this.#scope);
    try {
      const text = JSON.stringify(minimumCloudData(tools.call(name, input)));
      this.#characters += text.length;
      if (this.#characters > 180_000) throw new Error("OSCAR tool context limit reached; select a shorter range");
      return text;
    } finally { tools.close(); }
  }
}
