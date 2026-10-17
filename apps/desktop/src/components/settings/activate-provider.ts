import type { OscarApi } from "../../types";
import type { AIProviderId, AISettingsView, GroqSettingsView } from "../../../../../src/ai/contracts.js";
import type { ExpertSettings } from "../../../../../src/expert/schemas.js";

type Settings = ExpertSettings | AISettingsView | GroqSettingsView;
const pending = new WeakMap<OscarApi, Map<AIProviderId, Promise<Settings>>>();

async function enable(provider: AIProviderId, api: OscarApi): Promise<Settings> {
  if (provider === "ollama") {
    const saved = await api.getExpertSettings();
    return saved.enabled ? saved : api.configureExpert({ ...saved, enabled: true });
  }
  if (provider === "openai") {
    const saved = await api.getAISettings();
    return saved.enabled ? saved : api.configureAI({ enabled: true, provider, model: saved.model,
      tunnelEnabled: saved.tunnelEnabled, tunnelId: saved.tunnelId });
  }
  const saved = await api.getGroqSettings();
  return saved.enabled ? saved : api.configureGroq({ enabled: true, provider, model: saved.model });
}

export function activateProvider(provider: "ollama", api: OscarApi): Promise<ExpertSettings>;
export function activateProvider(provider: "openai", api: OscarApi): Promise<AISettingsView>;
export function activateProvider(provider: "groq", api: OscarApi): Promise<GroqSettingsView>;
export function activateProvider(provider: AIProviderId, api: OscarApi): Promise<Settings> {
  let operations = pending.get(api);
  if (!operations) { operations = new Map(); pending.set(api, operations); }
  const existing = operations.get(provider);
  if (existing) return existing;
  // React StrictMode may mount a selected form twice; share its pending write.
  const operation = enable(provider, api);
  operations.set(provider, operation);
  const clear = () => { operations.delete(provider); };
  void operation.then(clear, clear);
  return operation;
}
