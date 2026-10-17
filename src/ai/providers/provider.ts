import type { AIEvent, AIRequest, Range } from "../contracts.js";
export interface AIMessage { role: "user" | "assistant"; content: string; }
export interface ProviderRequest { messages: AIMessage[]; signal: AbortSignal; toolAuthorization?: string; analysis?: { request: AIRequest; ranges: Range[] }; }
export interface AIProvider {
  ask(request: ProviderRequest): Promise<string>;
  stream(request: ProviderRequest): AsyncIterable<AIEvent>;
  testConnection(signal: AbortSignal): Promise<void>;
  listModels?(signal: AbortSignal): Promise<string[]>;
  getCapabilities(): { streaming: boolean; tools: boolean; local: boolean };
}
