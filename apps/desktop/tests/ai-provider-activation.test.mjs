import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server, activateProvider;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom", server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  ({ activateProvider } = await server.ssrLoadModule("/src/components/settings/activate-provider.ts"));
});
after(async () => { await server?.close(); });

function fixture(enabled = false) {
  const local = { enabled, endpoint: "http://127.0.0.1:11434", model: "synthetic", contextSize: 8192 };
  const openai = { enabled, provider: "openai", model: "synthetic", tunnelEnabled: false, tunnelId: "", apiKeyConfigured: true, runtimeKeyConfigured: true, secretStorage: "os-encrypted" };
  const groq = { enabled, provider: "groq", model: "synthetic/model", apiKeyConfigured: true, secretStorage: "os-encrypted" };
  const calls = [];
  const api = {
    getExpertSettings: async () => ({ ...local }), getAISettings: async () => ({ ...openai }), getGroqSettings: async () => ({ ...groq }),
    configureExpert: async update => { calls.push(["ollama", update]); return { ...local, ...update }; },
    configureAI: async update => { calls.push(["openai", update]); return { ...openai, ...update }; },
    configureGroq: async update => { calls.push(["groq", update]); return { ...groq, ...update }; },
  };
  return { api, calls, local, openai, groq };
}

test("Selecting a provider enables only that provider and preserves its saved configuration", async () => {
  for (const provider of ["ollama", "openai", "groq"]) {
    const { api, calls, local, openai, groq } = fixture();
    const result = await activateProvider(provider, api);
    assert.equal(result.enabled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], provider);
    const expected = provider === "ollama" ? { ...local, enabled: true }
      : provider === "openai" ? { enabled: true, provider, model: openai.model, tunnelEnabled: false, tunnelId: "" }
      : { enabled: true, provider, model: groq.model };
    assert.deepEqual(calls[0][1], expected);
    assert.equal("apiKey" in calls[0][1], false);
    assert.equal("runtimeKey" in calls[0][1], false);
  }
});

test("Reopening an enabled provider does not rewrite settings or reset compatibility", async () => {
  const { api, calls } = fixture(true);
  for (const provider of ["ollama", "openai", "groq"]) assert.equal((await activateProvider(provider, api)).enabled, true);
  assert.deepEqual(calls, []);
});

test("Repeated mounts share activation and a failed save remains retryable", async () => {
  const { api, calls } = fixture();
  const first = activateProvider("groq", api), second = activateProvider("groq", api);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  let fail = true;
  api.configureGroq = async update => { if (fail) throw Error("Synthetic save failure"); return { ...update, apiKeyConfigured: true }; };
  await assert.rejects(() => activateProvider("groq", api), /Synthetic save failure/);
  fail = false;
  assert.equal((await activateProvider("groq", api)).enabled, true);
});
