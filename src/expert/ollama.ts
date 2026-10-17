import * as z from "zod/v4";
import type { ExpertSettings, Compatibility } from "./schemas.js";
export type { Compatibility } from "./schemas.js";

export interface ModelMessage { role: "system" | "user" | "assistant" | "tool"; content: string; tool_name?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>; }
export interface ModelRequest { messages: ModelMessage[]; tools?: unknown[]; format?: unknown; }
export interface ModelProvider { chat(request: ModelRequest, signal: AbortSignal): Promise<ModelMessage>; }
export class StructuredOutputError extends Error {
  constructor(readonly reason: "empty" | "length" | "context", contextSize?: number) {
    super(reason === "context" ? `Review context window is full (${contextSize} tokens). Choose context size ${Math.max(8192,(contextSize ?? 4096)*2)} in Local AI settings, save and test compatibility; no result accepted` : reason === "length" ? "Model reached its output token limit before completing the JSON review; no result accepted" : "Model returned an empty structured review; no result accepted");
  }
}
const messageSchema = z.object({ role: z.literal("assistant").default("assistant"), content: z.string().max(80_000).default(""), tool_calls: z.array(z.object({ function: z.object({ name: z.string().max(100), arguments: z.record(z.string(),z.unknown()) }) })).max(12).optional() });
export function localEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Ollama must use an HTTP loopback root URL without credentials");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}
export class OllamaProvider implements ModelProvider {
  readonly endpoint: string;
  constructor(readonly settings: ExpertSettings) { this.endpoint = localEndpoint(settings.endpoint); }
  async request(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try { response = await fetch(`${this.endpoint}/api/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal }); }
    catch { signal.throwIfAborted(); throw new Error("Ollama unavailable. Start the local Ollama service and test the connection."); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 404 ? "Configured local model or Ollama API unavailable" : "Ollama request failed; check local model memory and service status"); }
    const reader = response.body?.getReader(); if (!reader) throw new Error("Empty Ollama response");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 256_000) { await reader.cancel(); throw new Error("Ollama response exceeds limit"); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new Error("Ollama returned invalid JSON"); }
  }
  async models(signal: AbortSignal): Promise<Array<{ name: string; digest: string }>> {
    const result = z.object({ models: z.array(z.object({ name: z.string().max(150), digest: z.string().max(150) })) }).parse(await this.request("tags", undefined, signal));
    return result.models.filter(model => !/cloud/i.test(model.name));
  }
  async assertLocalModel(signal: AbortSignal): Promise<string> {
    if (!this.settings.model || /cloud/i.test(this.settings.model)) throw new Error("Select an installed local model; cloud models are disabled");
    const installed = (await this.models(signal)).find(model => model.name === this.settings.model);
    if (!installed) throw new Error("Configured local model is not installed");
    const detail = await this.request("show", { model: this.settings.model }, signal) as Record<string, unknown>;
    // Local Qwen licenses mention Alibaba Cloud; inspect sources, not license prose.
    const cloudSource = /^[ \t]*FROM[ \t]+[^\r\n]*cloud/im.test(String(detail.modelfile ?? ""));
    if (detail.remote_host || detail.remote_model || detail.remote || cloudSource) throw new Error("Remote-backed Ollama models are disabled");
    if (!detail.model_info || typeof detail.model_info !== "object" || !Object.keys(detail.model_info).length) throw new Error("Unable to verify local model weights; select a downloaded model");
    return installed.digest;
  }
  async chat(request: ModelRequest, signal: AbortSignal): Promise<ModelMessage> {
    const outputTokens = request.format ? 4096 : 3000;
    const result = await this.request("chat", { model: this.settings.model, stream: false, think: false, ...request, options: { temperature: 0, num_predict: outputTokens, ...(this.settings.contextSize ? { num_ctx: this.settings.contextSize } : {}) } }, signal);
    const response = z.object({ message: z.unknown(), done_reason: z.string().optional(), prompt_eval_count:z.number().int().nonnegative().optional(), eval_count:z.number().int().nonnegative().optional() }).parse(result);
    if (request.format && response.done_reason === "length") {
      // Ollama also reports "length" when prompt + output fills num_ctx.
      // A larger num_predict cannot solve that, nor can an identical retry.
      const context = this.settings.contextSize;
      if (context && response.prompt_eval_count !== undefined && response.eval_count !== undefined && response.eval_count < outputTokens && response.prompt_eval_count+response.eval_count >= context) throw new StructuredOutputError("context",context);
      throw new StructuredOutputError("length");
    }
    const message = messageSchema.parse(response.message);
    if (request.format && !message.content.trim()) throw new StructuredOutputError("empty");
    return { role: message.role, content: message.content, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
  }
  async compatibility(signal: AbortSignal): Promise<Compatibility> {
    const result: Compatibility = { reachable: false, modelAvailable: false, chat: false, tools: false, structured: false, ready: false, message: "Not tested" };
    try {
      await this.models(signal); result.reachable = true;
      await this.assertLocalModel(signal); result.modelAvailable = true;
      result.chat = !!(await this.chat({ messages: [{ role: "user", content: "Reply with hello." }] },signal)).content.trim();
      const probe = z.object({ marker: z.literal("oscar-local-probe") }).strict();
      const reply = await this.chat({ messages: [{ role: "user", content: "Call oscar_probe exactly once with marker oscar-local-probe. Do not answer in prose." }], tools: [{ type: "function", function: { name: "oscar_probe", description: "Synthetic capability probe; no patient data", parameters: z.toJSONSchema(probe) } }] }, signal);
      result.tools = reply.tool_calls?.length === 1 && reply.tool_calls[0]?.function.name === "oscar_probe" && probe.safeParse(reply.tool_calls[0]?.function.arguments).success;
      const structured = await this.chat({ messages: [{ role: "user", content: 'Return {"marker":"oscar-local-probe"}.' }], format: z.toJSONSchema(probe) },signal);
      try { result.structured = probe.safeParse(JSON.parse(structured.content)).success; } catch { result.structured = false; }
      result.ready = result.chat && result.tools && result.structured;
      result.message = result.ready ? "Ready for local Expert reviews" : "Model did not pass chat, tool calling and structured-output checks. Choose another model.";
    } catch (error) { signal.throwIfAborted(); result.message = error instanceof Error ? error.message : "Local model capability test failed"; }
    return result;
  }
}
