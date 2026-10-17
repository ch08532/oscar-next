# OSCAR AI implementation

Groq extension: add a separate secure settings store and synthetic connection test;
implement streamed Chat Completions/function-call orchestration; extract
`ScopedCloudTools` from private MCP for shared cloud scope/minimization/budgets;
wire Groq into both adapters and the existing Expert controls; update OpenAPI,
docs and mocked/synthetic regressions. No new dependencies or clinical migration.

The subsequent Expert merge uses one `ExpertAnalysis` component for both providers,
removes the duplicate sidebar entry, and adds `LocalExpertProvider` around the
existing local service. Provider conversations are isolated; local remains the UI
default. Historical implementation steps below describe the initial cloud work.

Reuse `ExpertTools` and its strict, bounded read-only registry. Keep the existing
local Expert workflow. No clinical schema migration or importer changes.

1. `src/ai/contracts.ts`, `analysis.ts`, `provider.ts`, `openai.ts`: strict
   provider-neutral requests, central intents/instructions, Responses streaming.
2. `src/ai/configuration/settings.ts`: atomic application settings; injectable OS-encrypted
   secret storage on desktop, explicitly ephemeral secrets in headless mode.
3. `src/ai/mcp/server.ts`: private authenticated HTTP MCP using the existing registry,
   request-time profile/machine/date authorization and cloud identity filtering.
4. `src/ai/providers/openai/tunnel.ts`: verified administrator-provisioned binary, outbound-only
   managed child, readiness probes, bounded retries and awaited shutdown.
5. `src/ai/service.ts`: scoped, bounded ephemeral conversations/jobs; cancellation,
   local context and provider-neutral incremental event batches.
6. Existing preload/IPC and REST adapters: typed configuration, diagnostics,
   generation/event polling, cancellation and history deletion.
7. Shared OSCAR AI screen and Settings section; exact-date guided workflows.
8. Mocked provider/tunnel and synthetic MCP/API tests; OpenAPI and setup docs.

Validation includes root verify and desktop/headless builds. Account/tunnel
credentials, a provisioned binary and real-machine acceptance are needed for
live validation; automated tests must never make paid requests.
