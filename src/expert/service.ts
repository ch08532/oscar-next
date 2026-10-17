import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { settingsSchema, defaultSettings, requestSchema, scopeSchema, type ExpertSettings, type ExpertRequest, type ReviewJob } from "./schemas.js";
export type { ReviewJob } from "./schemas.js";
import { OllamaProvider, localEndpoint, type Compatibility } from "./ollama.js";
import { ExpertTools, toolRegistry } from "./tools.js";
import { generateReview, type ReviewResult } from "./orchestrator.js";

interface JobRecord { job: ReviewJob; scope: { profileId: number; machineId: number }; controller: AbortController; finishedAt?: number; }
const services = new Map<string, ExpertService>();
export function expertService(path: string): ExpertService { let service = services.get(path); if (!service) { service = new ExpertService(path); services.set(path,service); } return service; }

export class ExpertService {
  readonly #jobs = new Map<string, JobRecord>();
  #compatibility: { key: string; expires: number; value: Compatibility } | undefined;
  #configWriting = false;
  #checking: Promise<Compatibility> | undefined;
  #lastTimings: ReviewResult["timings"] | null = null;
  constructor(readonly databasePath: string) {}
  async settings(): Promise<ExpertSettings> {
    try { return settingsSchema.parse(JSON.parse(await readFile(`${this.databasePath}.expert.json`, "utf8"))); }
    catch (error) { if ((error as { code?: string }).code === "ENOENT") return { ...defaultSettings }; throw new Error("Invalid Expert settings file; configure local AI again"); }
  }
  async configure(raw: unknown): Promise<ExpertSettings> {
    const settings = settingsSchema.parse(raw); settings.endpoint = localEndpoint(settings.endpoint);
    if (/cloud/i.test(settings.model)) throw new Error("Cloud models are disabled");
    if (this.#configWriting || this.#checking || [...this.#jobs.values()].some(record => record.job.state === "running")) throw new Error("Wait for the current Expert operation before changing settings");
    this.#configWriting = true; const temp = `${this.databasePath}.expert-${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(settings), { mode: 0o600 }); await rename(temp,`${this.databasePath}.expert.json`); this.#compatibility = undefined; return settings; }
    catch { throw new Error("Unable to save local AI application settings"); }
    finally { this.#configWriting = false; }
  }
  async models(): Promise<Array<{ name: string; digest: string }>> { return new OllamaProvider(await this.settings()).models(AbortSignal.timeout(10_000)); }
  async check(): Promise<Compatibility> {
    if (this.#checking) return this.#checking;
    if (this.#configWriting || [...this.#jobs.values()].some(record => record.job.state === "running")) throw new Error("Wait for the current Expert operation");
    this.#checking = this.performCheck();
    try { return await this.#checking; } finally { this.#checking = undefined; }
  }
  private async performCheck(): Promise<Compatibility> {
    const settings = await this.settings(), provider = new OllamaProvider(settings);
    const result = await provider.compatibility(AbortSignal.timeout(180_000));
    if (result.ready) this.#compatibility = { key: JSON.stringify(settings)+await provider.assertLocalModel(AbortSignal.timeout(10_000)), expires: Date.now()+300_000,value: result };
    else this.#compatibility = undefined;
    return result;
  }
  async start(raw: unknown, history: ReadonlyArray<{role:"user"|"assistant";content:string}> = []): Promise<ReviewJob> {
    const request = requestSchema.parse(raw), settings = await this.settings();
    if (!settings.enabled) throw new Error("Enable local AI reviews in Expert settings first");
    this.prune(); if (this.#configWriting || this.#checking || [...this.#jobs.values()].some(record => record.job.state === "running")) throw new Error("An Expert operation is already running; cancel it or wait");
    // Verify profile/machine ownership before scheduling or touching the model.
    const tools = new ExpertTools(this.databasePath,{ profileId: request.profileId,machineId: request.machineId }); tools.close();
    const id = randomUUID(), job: ReviewJob = { id,state: "running",status: "Checking local model…" };
    const record: JobRecord = { job,scope: { profileId: request.profileId,machineId: request.machineId },controller: new AbortController() };
    this.#jobs.set(id,record); void this.run(record,request,settings,history); return { ...job };
  }
  private async run(record: JobRecord, request: ExpertRequest, settings: ExpertSettings, history: ReadonlyArray<{role:"user"|"assistant";content:string}>): Promise<void> {
    const signal = AbortSignal.any([record.controller.signal,AbortSignal.timeout(180_000)]);
    let tools: ExpertTools | undefined;
    try {
      const provider = new OllamaProvider(settings);
      const digest = await provider.assertLocalModel(signal);
      const checked = this.#compatibility;
      const compatibility = checked && checked.key === JSON.stringify(settings)+digest && checked.expires > Date.now() ? checked.value : await provider.compatibility(signal);
      if (!compatibility.ready) throw new Error(compatibility.message);
      signal.throwIfAborted();
      tools = new ExpertTools(this.databasePath,record.scope);
      const result = await generateReview(tools,provider,request,signal,message => { record.job.status = message; },settings.model,undefined,12,180_000,history);
      result.modelDigest = digest;
      this.#lastTimings = result.timings;
      signal.throwIfAborted(); record.job.result = result; record.job.state = "complete"; record.job.status = "Review complete";
      // Metadata only: deliberately no dates, IDs, questions, prompts or payloads.
      console.error(JSON.stringify({ component: "expert",result: "success",reviewType: request.reviewType,...result.timings }));
    } catch (error) {
      const cancelled = record.controller.signal.aborted;
      record.job.state = cancelled ? "cancelled" : "failed"; record.job.status = cancelled ? "Review cancelled" : "Review failed";
      if (cancelled) delete record.job.error;
      else record.job.error = signal.aborted ? "Review timed out; try a smaller model or shorter range" : error instanceof Error ? error.message : "Expert review failed";
      // Zod's error payload can include model-provided data; do not log it.
      if (record.job.error && (record.job.error.length > 600 || record.job.error.startsWith("["))) record.job.error = "Model response or arguments failed validation; no review accepted";
    } finally { tools?.close(); record.finishedAt = Date.now(); }
  }
  job(id: string, rawScope: unknown, cancel = false): ReviewJob {
    this.prune(); const scope = scopeSchema.parse(rawScope), record = this.#jobs.get(id);
    if (!record || record.scope.profileId !== scope.profileId || record.scope.machineId !== scope.machineId) throw new Error("Expert review not found in selected scope");
    if (cancel && record.job.state === "running") { record.controller.abort(); record.job.status = "Cancelling…"; }
    return { ...record.job };
  }
  diagnostics() { return { tools: Object.keys(toolRegistry), mcp: "Standalone stdio; launched by an external local host", persistence: "Ephemeral reviews; cleared after 5 minutes", compatibility: this.#compatibility?.value ?? null, lastTimings:this.#lastTimings }; }
  forget(id:string,rawScope:unknown):void {this.job(id,rawScope);const record=this.#jobs.get(id);record?.controller.abort();this.#jobs.delete(id);}
  private prune(): void { for (const [id,record] of this.#jobs) if (record.finishedAt && (Date.now()-record.finishedAt > 300_000 || this.#jobs.size >= 20)) this.#jobs.delete(id); }
}
