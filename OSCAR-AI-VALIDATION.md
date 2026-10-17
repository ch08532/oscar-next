# OSCAR AI validation — 2026-10-17

## Expert provider merge follow-up

The separate OSCAR AI navigation entry is removed. Expert now selects Local
Ollama (default) or OpenAI above the same Daily/Trend/Compare/Ask Anything and
conversation controls. Provider settings and local evidence presentation are
reused as focused components. Local generation uses the existing validated
ExpertService, not a second data-access or model implementation.

Validation after the merge:

- `npm run verify`: **PASS**, 228 passed, 2 optional Ollama tests skipped; demo
  smoke PASS. Baseline before this follow-up: 221 passed, 2 skipped.
- `npx tsc -p apps/desktop/tsconfig.json --noEmit`: **PASS**.
- `npm --prefix apps/desktop run build`: **PASS**.
- `npm --prefix apps/desktop run build:headless`: **PASS**.
- `node scripts/update-ai-openapi.mjs`: **PASS**.

Seven new regression tests cover exact local intent/range mapping, validated
results/evidence, local cancellation/job cleanup, bounded untrusted follow-up
context, local operation without readable OpenAI settings or a tunnel, provider
history isolation, no cloud fallback, and authenticated shared API routing.
Existing OpenAI privacy, secret, tunnel, MCP and Expert regression tests pass.
No clinical schema, import semantics, endpoint restrictions or credentials were
changed. Local questions retain 2,000 characters; validated local reviews appear
after generation while progress streams. OpenAI text still streams incrementally.

Build warnings remain the recorded Zod-comment/chunk advisories. Live model/cloud
acceptance and manual Windows GUI/evidence navigation/provider-switch checks
remain pending; mocked/backend checks and builds do not certify those interactions.
The earlier implementation record below is retained for traceability.

Environment: Microsoft Windows NT 10.0.26200.0; Node v24.21.0; npm 11.19.0.
All therapy fixtures in the new tests are synthetic. OpenAI is mocked; no paid
requests, real therapy exports, source-card writes or live tunnel calls occurred.

| Command/check | Result |
| --- | --- |
| Baseline `npm install` | PASS; root audit reported 0 vulnerabilities |
| Baseline `npm --prefix apps/desktop install` | PASS; audit reported 8 moderate / 2 high findings; install-script approval notices for Electron, electron-winstaller and esbuild |
| Baseline `npm run verify` | PASS; 200 passed, 2 optional Ollama tests skipped; demo smoke PASS |
| `npm run verify` with OSCAR AI | PASS; 221 passed, 2 optional Ollama tests skipped; demo smoke PASS |
| `npx tsc -p apps/desktop/tsconfig.json --noEmit` | PASS |
| `npm --prefix apps/desktop run build` | PASS |
| `npm --prefix apps/desktop run build:headless` | PASS |
| `node scripts/update-ai-openapi.mjs` | PASS |

Renderer builds report Zod comment-annotation and >500 kB chunk advisories. No
dependency upgrades or unrelated chart/storage refactors were made for this task.

The 21 added AI tests cover mandatory `store:false` for ask/stream, model/key
handling, streamed UTF-8, cancellation/provider errors, safe settings responses,
secret encryption injection and replacement/removal, headless memory-only keys,
exact guided dates/intents/range bounds, identity filtering, tunnel verification,
health/readiness, bounded retries, manual restart, missing/tampered binaries,
real owned-child shutdown, private MCP initialization/tool discovery/annotations,
request authentication/date scope/stale-token rejection, discovery-only startup
credentials that cannot retrieve therapy data, local follow-up context,
history deletion, no-data Daily requests, bearer/origin enforcement, browser SSE
completion and disconnect cancellation. Existing preload isolation is also checked
with the additional AI methods. Tests do not establish clinical correctness of AI
interpretations or model compliance with prompts.

Fixes found during implementation: event entries must remain immutable after
cursor delivery; stale MCP credentials must not acquire the next analysis scope;
simultaneous MCP startup must share one listener; shutdown/disabled settings must
not allow later tunnel restart; an OpenAI diagnostic failure must still allow MCP
checks; the MCP authorization field carries the token while the HTTP header uses
the Bearer scheme. Regression coverage exercises these boundaries.

## Remaining real-machine acceptance

Use `WINDOWS-ACCEPTANCE-CHECKLIST.md`; its existing checks remain unclaimed.

- PENDING: Live OpenAI model/tool support, permissions, account retention/sharing
  settings and an actual Secure MCP Tunnel. No account credentials were supplied.
- PENDING: Provision and package a verified official tunnel-client release, then
  verify actual configuration, readiness, outbound HTTPS, request authorization
  forwarding, mTLS and reconnect behavior with that release.
- PENDING: Electron UI interaction, contextBridge callback streaming, OS-keychain
  encryption/decryption after restart, credential removal and installer behavior.
- PENDING: Real tunnel-client exit on normal Windows app close and installer
  restart; the owned-child test uses Node, not a tunnel-client binary.
- LIMITATION: Forced parent termination/power loss can orphan a child; no Windows
  Job Object or external service supervisor is added. No stale PID is trusted.
- LIMITATION: Headless credentials are memory-only and require re-entry after
  restart. Durable headless OS secret storage is not implemented.
- PENDING: ARM64/Raspberry Pi runtime provisioning, performance and UI acceptance.

The earlier uncommitted local Expert implementation and existing domain behavior
were preserved. No clinical schema version or importer semantics changed.

## Groq provider validation — 2026-10-17

Environment: Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0.
Dependencies were already installed during this session; no new dependency was
added for Groq. Baseline `npm run verify`: PASS, 228 passed, two optional skips,
synthetic demo smoke PASS.

| Command | Result |
| --- | --- |
| Final `npm run verify` | PASS; 240 passed, two optional Ollama skips; demo smoke PASS |
| `npx tsc -p apps/desktop/tsconfig.json --noEmit` | PASS |
| `npm --prefix apps/desktop run build` | PASS |
| `npm --prefix apps/desktop run build:headless` | PASS |
| `node scripts/update-ai-openapi.mjs` | PASS |

The 12 new Groq tests cover fragmented and sequential function calls, streamed
UTF-8/CRLF text, reasoning suppression, model compatibility probes, sanitized
failures, malformed/truncated/oversized streams, unknown/SQL/out-of-scope tools,
comparison gaps, waveform bounds, repetition and total-call limits, encrypted and
memory-only secrets, replacement/removal, provider history isolation, operation
without OpenAI settings or a tunnel, cancellation and partial-history exclusion,
authenticated REST configuration and browser SSE. Existing private MCP/OpenAI
tests pass after sharing the scoped executor and secure configuration helper.
Preload isolation coverage includes the Groq-specific methods.

Renderer builds retain Zod annotation and >500 kB chunk advisories. Fixtures and
provider responses are synthetic/mocked. No paid Groq request, real therapy
upload or source-media write occurred. Live Groq model/account permissions,
latency/rate limits, retention controls, manual Electron interaction and actual
OS-keychain restart acceptance remain PENDING. Automated results do not establish
clinical correctness. See `GROQ.md` for setup and account privacy requirements.

## AI backend folder organization — 2026-10-17

Moved protocol adapters into `providers/openai/`, `providers/groq/` and
`providers/ollama/`, with dedicated shared `configuration/`, `tools/` and `mcp/`
folders. Updated source/test imports, the OpenAPI generator and documentation.
No request schemas, persisted settings formats or provider behavior changed.
The module map is documented in `src/ai/README.md`.

Existing session dependencies were reused. Baseline and final `npm run verify`:
PASS, 240 passed, two optional skips and demo smoke PASS.
`npx tsc -p apps/desktop/tsconfig.json --noEmit`,
`npm --prefix apps/desktop run build` and
`npm --prefix apps/desktop run build:headless`: PASS. The renderer builds retain
the existing Zod annotation/chunk-size advisories. Regenerating OpenAPI passed
with the contract byte-for-byte unchanged; `git diff --check`: PASS. Removed
obsolete generated module files before verification to exercise the new paths.
No new live-provider, manual UI or clinical validation is claimed.

## Settings tabs and centralized provider configuration — 2026-10-17

Provider forms now appear only in Settings → AI. Expert retains provider
selection and analysis, with a shortcut to that tab. Settings categories are
General, Therapy & graphs, AI and Connection. Tabs have associated tab panels,
roving focus and ArrowLeft/ArrowRight/Home/End navigation. Panels mount on first
visit and remain mounted while Settings stays open, preserving unsaved edits.
Saved local enablement/model configuration enables the Expert analysis controls;
the backend still enforces local-model compatibility before generation and its
existing five-minute digest/settings-bound compatibility cache is unchanged.

Dependencies already installed in this session were reused. Baseline and
post-change `npm run verify`: PASS, 240 passed, two optional skips, demo smoke
PASS. Renderer TypeScript check and desktop/headless builds: PASS, with the
existing Zod annotation and chunk-size advisories. After updating Groq's error
messages to the new Settings location, root build and all 12 Groq tests: PASS.
`git diff --check`: PASS.

One-off in-memory esbuild/React server-render checks: PASS for four tabs, one
selected tab, appropriate category content, all three provider forms in the AI
tab and no provider forms/password inputs in Expert. These checks do not exercise
browser events or layout. Manual keyboard/focus, tab draft preservation, the
Expert shortcut and desktop/browser visual acceptance remain PENDING. No live
provider request, real therapy export or storage/schema change was made.

## Provider selection in Settings only — 2026-10-17

Settings → AI now owns the provider selector and mounts only that provider's
configuration form. Expert receives the selection from App, displays the active
provider and links to Settings without a selector. The non-secret provider ID
is saved in client localStorage; missing/invalid/unavailable storage defaults to
Local Ollama. Credentials remain managed by the backend. Provider switching
continues to use isolated analysis context and existing backend checks.

Existing session dependencies reused. Baseline and final `npm run verify`:
PASS, 240 passed, two optional skips, demo smoke PASS. Renderer TypeScript,
desktop and headless builds: PASS with existing annotation/chunk advisories.
One-off esbuild/React server-render checks passed for all three selected
providers: one selector in Settings, only the matching configuration form, no
selector in Expert, correct active provider label, stored choices, default
fallback and unavailable storage. `git diff --check`: PASS. Manual browser/
Electron interaction and reload acceptance remain pending; no live AI call or
real therapy upload was made.

## Groq save/test feedback and model discovery — 2026-10-17

User reported a disappearing API-key field and a connection failure, then
provided the actual message: "Groq model is unavailable; check the configured
model". That message comes from an upstream 404 during the model probe, rather
than the settings-save operation. The UI also cleared entered keys after failed
saves and tested only previously saved values, obscuring which operation failed.

The UI now clears the key only after a successful save, explicitly confirms the
configured flag, preserves failed entries for retry and shows progress/errors.
Test and Refresh models save the current form before using backend credentials.
Refresh reads the fixed Groq Models endpoint without inference or therapy data,
returns bounded validated active IDs and enables selection of another model.
Listing alone does not establish account permissions or function-calling support.
The existing model probe still validates the selected model; no automatic model
or provider fallback was added. Preload/REST and OpenAPI expose model discovery.

Existing dependencies reused. Baseline `npm run verify`: PASS, 240 passed, two
optional skips, demo smoke PASS. Two discovery regressions failed before the
implementation. Final `npm run verify`: PASS, 242 passed, two optional skips,
demo smoke PASS. Targeted Groq/preload tests: 15 PASS. Renderer TypeScript,
desktop/headless builds, OpenAPI generation and `git diff --check`: PASS.
Existing renderer annotation/chunk-size advisories remain.

A one-off in-memory hook/action harness passed failed-save retry, successful
key confirmation, saving latest key/model before Test, model discovery and
selecting a replacement for an unavailable model. These are mocked interactions,
not live Groq or visual acceptance. An attempted hidden Electron storage probe
produced no usable result; actual Windows keychain and live-account checks remain
PENDING. No real key was read/logged and no paid inference or therapy upload was
performed. Restart desktop to load the added main/preload methods before testing.

## Expert Markdown rendering — 2026-10-17

Root cause: streamed cloud answers contained Markdown but ExpertAnalysis placed
them in a plain paragraph. The shared ExpertMarkdown component now renders
headings, emphasis, lists, blockquotes, code and GFM tables for assistant text.
Wide tables have a labeled keyboard-focusable scrolling region. Typography and
borders use existing theme tokens. Prior messages are memoized; streamed partial
Markdown remains accepted. User text stays plain and validated local review
cards/evidence are unchanged. No provider prompts or clinical queries changed.

Security behavior: raw HTML is skipped, images render as alt text without image
requests, only HTTP(S)/anchor links remain active and external links use
noopener/noreferrer with no referrer. No raw-HTML plugin or innerHTML is used.
Synthetic regression tests cover formatting, unsafe links/HTML/images and partial
stream fragments. No real pasted therapy text was added to tests or source.

Baseline and final `npm run verify`: PASS, 242 passed, two optional skips and
demo smoke PASS. `npm --prefix apps/desktop run test:markdown`: three PASS;
tests failed before the component existed. Renderer TypeScript, desktop/headless
builds and `git diff --check`: PASS. Desktop installed react-markdown 10.1.0 and
remark-gfm 4.0.1 with lockfile updates. Initial install could not write the global
npm cache (EPERM); retry with ignored workspace `.cache/npm` succeeded. Audit
still reports 8 moderate/2 high desktop findings, matching the earlier audit;
no unrelated upgrade was attempted. Existing Zod annotation/chunk-size advisories
remain. The test Vite server disables dependency scanning to close cleanly.
Visual desktop/browser and narrow-screen acceptance remain pending; no live AI
requests or real health-data exports were made.

## Automatic provider enablement in Settings — 2026-10-17

Removed the Local Ollama, OpenAI and Groq provider enable checkboxes. When the
selected provider's settings load, a shared activation helper enables that
provider using its existing settings. Model/endpoint/tunnel settings and omitted
credentials are preserved. Already-enabled configurations are not rewritten, so
reopening them does not reset local compatibility. Pending activations are shared
across duplicate StrictMode mounts; failures are reported and retryable. UI
saves retain enabled=true. Existing backend flags/defaults, model validation,
secret storage and explicit OpenAI tunnel configuration are unchanged.

Existing dependencies reused. Baseline/final `npm run verify`: PASS, 242 passed,
two optional skips, demo smoke PASS. `npm --prefix apps/desktop run test:ui`:
six PASS (three activation and three Markdown checks). Activation tests failed
before implementation and verify selected-provider-only writes, preservation of
saved fields, omission of secret/configured flags, no rewrites, shared activation
and failure recovery. Test servers disable HMR/WebSockets to avoid port conflicts.
Renderer TypeScript, desktop/headless builds and `git diff --check`: PASS.
Existing renderer annotation/chunk advisories remain. Manual desktop/browser
selection acceptance remains pending; no real therapy data or live AI request
was used, and selection does not perform inference.

## Groq 90-day trend error classification — 2026-10-17

User reported a 90-day Trend failure with "Groq service is unavailable". The
integration mapped all unrecognized failure statuses, including HTTP 413 and
422, to that same outage message and discarded the numeric status. The actual
original upstream status cannot be recovered from that message; an oversized
request is plausible but not confirmed. No live reproduction was attempted.

Errors now include the HTTP status and distinct actions for request size,
processing, credentials, model access, dependencies, capacity/rate limits and
server/gateway failures. Provider bodies are still discarded and never echoed.
No automatic retries, range truncation, provider fallback or clinical query
changes were added. A synthetic 90-day trend test checks exact authorized dates,
90 calendar days, a later-round HTTP 503 after partial text, failure state,
exclusion of the incomplete turn from follow-up context and unchanged scope.

Existing dependencies reused. Baseline `npm run verify`: PASS, 242 passed, two
optional skips, smoke PASS. Both new regressions failed before the fix. Final
`npm run verify`: PASS, 244 passed, two optional skips, smoke PASS. All 16 Groq
tests and `git diff --check`: PASS. No renderer/API schema changed. The user's
actual model/account limits and the underlying 90-day failure remain unverified;
the next failure will identify its HTTP status. No keys, real therapy payloads
or live paid inference were accessed.

## Fixed Expert criteria, scrolling conversation and bottom composer — 2026-10-17

Expert now occupies the available workspace viewport. The compact provider
summary and analysis criteria sit above an independently scrolling conversation;
the message box, New Conversation, Clear Conversation and Clear All AI History
actions sit below it. Criteria can scroll within their fixed panel on compact
screens. Questions retain right-aligned bubbles, answers retain Markdown and
local evidence cards. Other application views retain their existing scrolling.

ExpertComposer routes Enter through normal form submission. Shift+Enter inserts
a newline; IME composition/confirmation, repeated key events and unavailable,
blank, starting or busy input do not send. The parent retains its synchronous
duplicate-submission guard. Moved conversation actions retain their existing
callbacks; their buttons cannot submit the form. Clearing an active conversation
still cancels its backend job.

Existing dependencies reused. Baseline/post-composer `npm run verify`: PASS,
244 passed, two optional skips, smoke PASS. Final UI tests: ten PASS, including
four new composer keyboard/action tests. Renderer TypeScript, final desktop and
headless builds and `git diff --check`: PASS. Existing Zod annotation/chunk-size
advisories remain.

One-off synthetic Chrome layout fixtures use actual Expert components and built
CSS. Checks passed at requested window sizes 1440×900 (Daily/Compare, dark),
800×700 (Daily, light) and 390×844 (Compare, dark): output scrolls, criteria and
composer positions remain fixed, composer stays in the visible viewport and
conversation space remains usable. Chrome's effective content viewports were
748/548/692 px high. Initial checks exposed inherited align-items:start and
insufficient small-screen conversation space; both were corrected. The browser
probe initially failed under the agent sandbox GPU restrictions; isolated offline
fixture runs used browser test-only no-sandbox flags. Application Electron
sandbox settings were not changed. An ignored synthetic screenshot was inspected.
Manual interaction in the running Electron application remains pending. No live
AI calls, real therapy exports or clinical semantics changes were made.
