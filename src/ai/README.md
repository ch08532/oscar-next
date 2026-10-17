# AI backend layout

```text
ai/
  service.ts                 Jobs, provider selection, scoped history and cancellation
  contracts.ts               Shared request/event/settings schemas and types
  analysis.ts                Guided intents, exact date ranges and prompt construction
  providers/
    provider.ts              Common AIProvider interface
    openai/
      provider.ts            OpenAI Responses protocol and streaming
      tunnel.ts              Verified OpenAI tunnel process lifecycle
    groq/
      provider.ts            Groq Chat Completions and local function-calling loop
    ollama/
      provider.ts            Bridge to the existing validated local Expert service
  configuration/
    settings.ts              OpenAI/Groq defaults, validation and safe settings views
    secure-store.ts          Shared atomic storage and encrypted/memory-only secrets
  tools/
    scoped-tools.ts          Cloud tool allowlist, date scope and resource bounds
    privacy.ts               Minimum-data filtering before cloud transmission
  mcp/
    server.ts                Private authenticated HTTP MCP transport
```

Desktop IPC and headless REST both call `AIService`. Provider adapters implement
`AIProvider` and emit the same `AIEvent` stream. Provider history remains isolated;
failed or cancelled exchanges do not become completed follow-up context.

Groq executes requested functions through `ScopedCloudTools` locally. OpenAI
reaches the same executor through the private MCP server and its managed tunnel.
The authoritative read-only queries and tool schemas remain in `src/expert/`.
The Ollama adapter preserves that subsystem's existing orchestration and review
validation. Database/storage and importer code are outside provider adapters.

For another provider, add its protocol adapter under `providers/<provider>/`.
Wire its explicit provider ID through contracts, service selection, configuration
and the shared Expert UI/adapters. Reuse the scoped tool executor and secure
store where applicable; keep provider-specific wire protocols and privacy
controls in the adapter. Add synthetic/mocked provider coverage following
`tests/groq.test.ts` and `tests/ai.test.ts`. A folder alone does not register a
provider; unimplemented providers are not advertised in the UI.

See [OSCAR-AI.md](../../OSCAR-AI.md) and [GROQ.md](../../GROQ.md) at the repository
root for deployment, setup, privacy and live-validation limitations.
