import * as z from "zod/v4";
import { dateSchema, rangeSchema, scopeSchema } from "../expert/schemas.js";
import type { ReviewResult } from "../expert/schemas.js";
export type AIProviderId = "ollama" | "openai" | "groq";

export const dailyIntents = ["sleep_summary", "ahi_analysis", "event_analysis", "leak_analysis", "pressure_analysis", "flow_limit_analysis", "machine_settings", "detailed_night_analysis"] as const;
export const trendIntents = ["overall_sleep_trend", "ahi_trend", "obstructive_apnea_trend", "central_apnea_trend", "hypopnea_trend", "leak_trend", "pressure_trend", "flow_limitation_trend", "usage_trend"] as const;
export const compareIntents = ["compare_overall", "compare_ahi", "compare_events", "compare_leaks", "compare_pressure", "compare_flow_limitations"] as const;
const context = { ...scopeSchema.shape, conversationId: z.string().uuid().optional(), provider: z.enum(["ollama", "openai", "groq"]).optional() };
export const aiRequestSchema = z.discriminatedUnion("dateMode", [
  z.object({ ...context, type: z.literal("analysis"), dateMode: z.literal("single"), intent: z.enum(dailyIntents), date: dateSchema }).strict(),
  z.object({ ...context, type: z.literal("analysis"), dateMode: z.literal("range"), intent: z.enum(trendIntents), ...rangeSchema.shape }).strict().refine(v => rangeSchema.safeParse({ startDate:v.startDate,endDate:v.endDate }).success, "Range must contain 1–90 days"),
  z.object({ ...context, type: z.literal("analysis"), dateMode: z.literal("compare"), intent: z.enum(compareIntents), periodA: rangeSchema, periodB: rangeSchema }).strict(),
  z.object({ ...context, type: z.literal("chat"), dateMode: z.literal("chat"), message: z.string().trim().min(1).max(4000), range: rangeSchema.optional() }).strict(),
]);
export type AIRequest = z.infer<typeof aiRequestSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export interface Range { startDate: string; endDate: string; }
export type AIEvent = { type: "status" | "text_delta" | "error"; text: string } | { type: "complete"; conversationId: string } | { type: "review"; result: ReviewResult };
export interface AIJob { id: string; conversationId: string; provider: AIProviderId; state: "running" | "complete" | "failed" | "cancelled"; events: AIEvent[]; nextCursor: number; }
export interface AISettings {
  enabled: boolean; provider: "openai"; model: string; tunnelEnabled: boolean; tunnelId: string;
}
export interface AISettingsView extends AISettings { apiKeyConfigured: boolean; runtimeKeyConfigured: boolean; secretStorage: "os-encrypted" | "memory-only"; }
export interface AISettingsUpdate extends AISettings { apiKey?: string | null; runtimeKey?: string | null; }
export interface GroqSettings { enabled: boolean; provider: "groq"; model: string; }
export interface GroqSettingsView extends GroqSettings { apiKeyConfigured: boolean; secretStorage: "os-encrypted" | "memory-only"; }
export interface GroqSettingsUpdate extends GroqSettings { apiKey?: string | null; }
export interface GroqConnectionCheck { connected: boolean; message: string; }
export interface TunnelStatus { state: "stopped" | "starting" | "connected" | "disconnected" | "failed"; process: boolean; healthy: boolean; ready: boolean; attempts: number; error: string | null; }
export interface AIDiagnostics { openai: boolean; mcp: boolean; mcpUrl: string | null; tools: string[]; tunnel: TunnelStatus; ready: boolean; message: string; }
