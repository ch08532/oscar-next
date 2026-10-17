import * as z from "zod/v4";
// Shared JSON contracts must remain independent of Node/storage for renderer types.
function therapyDayRange(value: string): { startMs: number; endMs: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid therapy date");
  const startMs = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0,10) !== value) throw new Error("Invalid therapy date");
  return { startMs,endMs:startMs+86_400_000 };
}

export const dateSchema = z.string().refine(value => { try { therapyDayRange(value); return true; } catch { return false; } }, "Expected a valid YYYY-MM-DD therapy date");
export const scopeSchema = z.object({ profileId: z.number().int().positive(), machineId: z.number().int().nonnegative() }).strict();
export const rangeSchema = z.object({ startDate: dateSchema, endDate: dateSchema }).strict().refine(value => {
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000;
  return days >= 0 && days < 90;
}, "Range must contain 1–90 calendar days");
export const windowSchema = z.object({ date: dateSchema, startMs: z.number().finite().optional(), endMs: z.number().finite().optional() }).strict().refine(value => {
  const range = therapyDayRange(value.date), start = value.startMs ?? range.startMs, end = value.endMs ?? range.endMs;
  return start >= range.startMs && end <= range.endMs && start < end;
}, "Window must lie inside the selected noon-to-noon therapy day");
export const settingsSchema = z.object({ enabled: z.boolean(), endpoint: z.string().max(150), model: z.string().max(150), contextSize: z.number().int().min(2048).max(32768).nullable() }).strict();
export type ExpertSettings = z.infer<typeof settingsSchema>;
export const defaultSettings: ExpertSettings = { enabled: false, endpoint: "http://127.0.0.1:11434", model: "", contextSize: null };
export const requestSchema = scopeSchema.extend({ reviewType: z.enum(["night", "trend", "question"]), date: dateSchema, range: rangeSchema.optional(), baseline: rangeSchema.optional(), question: z.string().trim().max(2000).optional() }).strict().superRefine((value, ctx) => {
  if (value.reviewType === "trend" && !value.range) ctx.addIssue({ code: "custom", message: "Trend review requires a range" });
  if (value.reviewType === "question" && !value.question) ctx.addIssue({ code: "custom", message: "Question is required" });
});
export type ExpertRequest = z.infer<typeof requestSchema>;
export const observationSchema = z.object({ id: z.string().max(100), severity: z.enum(["info", "low", "moderate", "high"]), title: z.string().min(1).max(200), explanation: z.string().min(1).max(1600), evidenceIds: z.array(z.string().max(200)).min(1).max(12), confidence: z.enum(["high", "moderate", "low"]) }).strict();
export const reviewSchema = z.object({ reviewType: z.enum(["night", "trend", "question"]), summary: z.string().min(1).max(3000), positiveFindings: z.array(observationSchema).max(12), itemsToReview: z.array(observationSchema).max(12), questionsForClinician: z.array(z.string().max(500)).max(8), limitations: z.array(z.string().max(800)).max(12), evidenceUsed: z.array(z.string().max(200)).min(1).max(40) }).strict();
export type ExpertReview = z.infer<typeof reviewSchema>;
export interface EvidenceReference { id: string; profileId: number; machineId: number; date?: string; startDate?: string; endDate?: string; startMs?: number; endMs?: number; label: string; }
export interface ExpertFinding { id: string; type: string; severity: "info" | "low" | "moderate" | "high"; title: string; measurement: { value: number; unit: string; baseline?: number }; evidence: string[]; }
export interface Compatibility { reachable: boolean; modelAvailable: boolean; chat: boolean; tools: boolean; structured: boolean; ready: boolean; message: string; }
export interface ReviewResult { review: ExpertReview; evidence: EvidenceReference[]; findings: ExpertFinding[]; timings: { toolsMs: number; generationMs: number; totalMs: number; toolCalls: number; toolDurations: Array<{ tool: string; durationMs: number }> }; generatedAt: string; model: string; modelDigest?: string; schemaVersion: number; promptVersion: number; }
export interface ReviewJob { id: string; state: "running" | "complete" | "failed" | "cancelled"; status: string; result?: ReviewResult; error?: string; }
