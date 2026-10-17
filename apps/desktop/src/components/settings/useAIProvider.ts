import { useState } from "react";
import type { AIProviderId } from "../../../../../src/ai/contracts.js";

const key = "oscar-next-ai-provider";

export function useAIProvider() {
  const [provider, setProvider] = useState<AIProviderId>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "ollama" || saved === "openai" || saved === "groq") return saved;
    } catch { /* Keep local processing as the default when storage is unavailable. */ }
    return "ollama";
  });
  function selectProvider(next: AIProviderId) {
    try { localStorage.setItem(key, next); } catch { /* The selection still works for this session. */ }
    setProvider(next);
  }
  return { provider, selectProvider };
}
