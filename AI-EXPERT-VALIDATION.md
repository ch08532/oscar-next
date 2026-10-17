# OSCAR Expert validation — 2026-10-12

Environment: Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0.
The Windows edition query (`Get-CimInstance Win32_OperatingSystem`) was denied;
the recorded OS build comes from `[System.Environment]::OSVersion.VersionString`.
All therapy fixtures used for this task were synthetic. No real card or database
was copied, logged or added to source control.

## Automated results

| Check | Result |
| --- | --- |
| Baseline `npm run verify` before implementation | PASS: 168 tests and synthetic smoke |
| Root `npm run verify` after implementation | PASS: 189 tests, 188 passed, one explicitly skipped; synthetic smoke PASS |
| `npm --prefix apps/desktop run build` | PASS |
| `npm --prefix apps/desktop run build:headless` | PASS after Windows sandbox output-folder permission retry |
| Renderer `tsc --noEmit -p tsconfig.json` from `apps/desktop` | PASS |
| Real MCP SDK stdio client | PASS: startup, eight schemas/tools, resource/prompt enumeration, invalid arguments, direct-call parity, unchanged DB bytes |
| Persistent MCP refresh after session inclusion changes | PASS: next tool call sees excluded session instead of stale cached data |
| `node dist/src/expert/mcp.js --database <synthetic-db> --machine 8200 --check` | PASS: ready, read-only, selected profile/machine, eight registered tools |
| `git diff --check` | PASS |
| Actual Ollama model | NOT RUN: loopback service unavailable; explicit integration test skipped |

Root dependencies were installed using a workspace npm cache after the default
cache returned EPERM. Headless Vite initially failed replacing its existing
generated `headless-dist/assets` folder with EPERM; the same build succeeded
with an approved execution outside the sandbox. These are environment results,
not silently omitted failures. Generated artifacts and validation helpers/logs
remain ignored.

`tests/expert.test.ts` covers OSCAR parity and identity redaction; strict
profile/machine/range/window validation; half-open event records; existing
elapsed-weighted pressure/leak/oximetry/features; missing channels; excluded
sessions; split noon-to-noon dates; summary-only rates versus exact events;
personal medians and absent baselines; request caching and bounded evidence IDs.

Fake-provider orchestration tests cover zero/one/multiple tool calls, invalid
tools/arguments/scope, repeated loops/call limits, malformed JSON, fabricated
evidence, common treatment-command rejection, confidence cap, timeout and
cancellation. Native HTTP fixtures cover Ollama chat/tools/JSON probes with no
therapy context, remote-model/redirect rejection, REST auth/origin checks,
scoped job lifecycle, concurrency, failures and cancellation. Preload contract
tests cover the narrow shared UI methods. No automated test requires a model
download.

## Shared UI runtime checks

The actual headless server served the built React UI on loopback port 3218,
backed by an isolated synthetic database. An offscreen Electron browser loaded
that HTTP UI with Node integration disabled. Separately, the real Electron main
and preload loaded the desktop build using an isolated synthetic userData
directory. Checks ran sequentially against the same fixture with a synthetic
Ollama HTTP server on loopback port 11435.

Both paths passed night, trend and question review rendering, compatibility
gating, cancellation and evidence navigation. At 900×850 neither Expert page
introduced horizontal overflow; screenshots were inspected. Synthetic night
query timings were roughly 0.16–0.23 seconds on the dense fixture; fake model
responses took milliseconds. This is **not** a real-model performance result.
The final browser and desktop checks also passed a model-requested leak-tool window
(23:00–23:10), its exact Daily zoom, and preceding-period comparison. It initially
reproduced a same-date navigation race: old chart data consumed the evidence zoom
before a fresh fetch reset it. Clearing the old Daily/chart state during the
Expert transition fixed that race; evidence is applied after fresh data arrives.
Scope changes also discard pending evidence from the previous profile/machine.
Both final paths also displayed an unavailable-service compatibility result,
kept Start review disabled, and returned per-tool duration diagnostics without
therapy payloads. Cancellation displayed a clean cancelled status.

## Limits and follow-up

Ollama at `http://127.0.0.1:11434/api/tags` was unreachable. No actual local model
was installed, pulled or tested. To run the optional test after installing a
compatible downloaded model and disabling Ollama cloud features:

```powershell
$env:OSCAR_TEST_OLLAMA_MODEL = '<installed-local-model>'
npm test
```

That optional test checks real chat/tool/JSON compatibility. Also run manual
night/trend/question reviews with that model, inspect every evidence jump and
review quality, and measure RAM/generation latency before relying on model
compatibility claims. The fake HTTP tests validate the integration contract,
not a model's clinical accuracy, judgment or prompt adherence.

Physical Windows UI acceptance, an installed distributable, Raspberry Pi ARM64,
macOS/Linux desktops, large real imports, model OOM behavior and long-running
model stress have not been validated in this task. Use
[WINDOWS-ACCEPTANCE-CHECKLIST.md](WINDOWS-ACCEPTANCE-CHECKLIST.md) for real-machine
validation. No clinical validation or equivalence to OSCAR is claimed.

Implemented scope decisions: stdio MCP only; external host manages its lifecycle.
Action-status polling rather than streamed prose. Descriptive deterministic
findings reuse current calculations; no new event-cluster, pressure-ceiling,
desaturation or signed-flow/breath algorithm. Knowledge retrieval is an empty
provider with a documented future citation boundary. Range evidence opens its
first current-period Daily date. Schema/reference validation and treatment-text
filters cannot prove semantic truth or eliminate harmful model output.

See [LOCAL-AI.md](LOCAL-AI.md), [MCP.md](MCP.md) and
[AI-EXPERT-PLAN.md](AI-EXPERT-PLAN.md) for architecture and operational limits.

## Follow-up: actual Qwen compatibility (2026-10-14)

Installed `qwen3.5:4b` on local Ollama 0.40.4 was initially rejected because the
installer and provider scanned license prose for `cloud`. The license includes
`Copyright 2026 Alibaba Cloud`; remote execution metadata was absent and model
information was present. Both checks now inspect FROM declarations instead of
license prose, while preserving rejection of explicit remote metadata and missing
local weight metadata. Regression fixtures failed before and pass after the fix.

`npm run verify`: PASS, 192 passed, one optional real-model test skipped, demo
smoke PASS. The separate explicit real-model test passed:

```powershell
$env:OSCAR_TEST_OLLAMA_MODEL = 'qwen3.5:4b'
node --test --test-name-pattern 'Optional real Ollama compatibility' dist/tests/expert.test.js
```

Actual chat, tool calling and structured JSON probes passed in approximately
126 seconds using synthetic prompts only. This establishes capability on this
machine, not review quality or clinical accuracy. Actual night/trend/question
reviews, evidence navigation, manual UI behavior and GPU/performance validation
remain outstanding. See [Windows validation](WINDOWS-VALIDATION.md).

## Follow-up: request-specific review output (2026-10-14)

The reported `Review type does not match request` failure exposed an output
schema that allowed the model to choose any review type. Prompt version 2 uses
the requested type as a literal in the generation schema and repeats it in the
final instruction. The validator still rejects wrong types, unknown evidence,
and treatment-boundary violations. Public and stored schemas are unchanged.

`npm run verify`: PASS, 193 passed, two opt-in model tests skipped, synthetic
demo smoke PASS. Regression coverage failed before and passes after the fix
for night/trend/question generation constraints, with wrong-type rejection
and REST job metadata verified.

A separate actual `qwen3.5:4b` synthetic night review passed in approximately
99 seconds with context size 8192:

```powershell
$env:OSCAR_TEST_OLLAMA_REVIEW_MODEL = 'qwen3.5:4b'
node --test --test-name-pattern 'Optional real Ollama synthetic night review' dist/tests/expert.test.js
```

This exercises the complete read-only orchestrator and validates the resulting
type and evidence references. No real therapy database or identifiers were
used. Actual trend/question generation, clinical accuracy and manual UI
validation remain outstanding.

## Follow-up: malformed JSON recovery (2026-10-14)

The user reported `Invalid structured review; no result accepted`, a JSON parse
failure separate from the prior type mismatch. The original malformed response
was not inspected or logged. Prompt version 3 adds one bounded regeneration of
empty, truncated or malformed JSON using concise-output instructions. Ollama
completion metadata distinguishes output-token exhaustion from empty content;
repeated malformed JSON also gets a specific message. Invalid output is discarded,
and schema/evidence/treatment-boundary failures are not retried. Original request
scope, deadline, schema and tool limits remain enforced.

`npm run verify`: PASS, 196 passed, two opt-in model tests skipped, demo smoke
PASS. New provider/orchestrator fixtures verify all three failure categories,
one retry maximum, unchanged generation schema and exclusion of rejected text
from retry context. Native HTTP fixtures verify completion metadata handling.
The existing actual `qwen3.5:4b` synthetic night review passed with prompt v3
in approximately 51 seconds at context 8192. It produced valid JSON directly;
it did not reproduce the user's failing response or exercise live recovery.
No user therapy data was accessed. Manual UI and actual-data review remain
unverified. See [Windows validation](WINDOWS-VALIDATION.md) for commands.

## Follow-up: output size and token budget (2026-10-14)

The reported completion-limit error confirmed token exhaustion. The previous
generation schema allowed 24 long observations plus large prose/evidence lists
under a 3,000-token output budget. Prompt version 4 generates and validates a
compact subset of the unchanged public response schema: two positive findings,
two items to review, 350-character explanations, 600-character summary, two short
clinician questions, three short limitations and at most eight evidence IDs.
Structured replies have a bounded 4,096-token budget; tool-selection replies
retain 3,000 tokens. The deadline, read-only scope, single regeneration and
evidence/treatment validation remain unchanged. This reduces output pressure;
it is not a guarantee that every model will finish or provide correct analysis.

Regression tests failed before and pass after these changes for output-schema
bounds and native generation budgets. Oversized reports from a model ignoring
schema constraints are also rejected. `npm run verify`: PASS, 198 passed, two
opt-in tests skipped, demo smoke PASS. A real `qwen3.5:4b` synthetic night review
using the compact schema passed in approximately 56 seconds. A subsequent
experimental tool-selection instruction caused an invalid feature-window call;
the one-hour guard rejected it, and that prompt experiment was removed. No tool
or range validation was relaxed. No user therapy database was used.

With `OSCAR_TEST_OLLAMA_REVIEW_MODEL=qwen3.5:4b` and
`OSCAR_TEST_OLLAMA_FORCE_RETRY=1`, the real-model synthetic night test passed in
approximately 49 seconds at context 8192. It injects a token-limit error once,
then uses actual Ollama generation to produce and validate the compact review.
Natural token exhaustion and the user's failing review were not reproduced.

## Follow-up: actual full-context failure (2026-10-14)

The user's September 9 night was reproduced read-only through the configured
local Ollama service, without printing or saving therapy prompts/responses.
Saved context was 4096. Ollama returned 3,406 prompt tokens plus 690 generated
tokens and stopped with `length`; retry returned 3,477 plus 619. Both totals
equal 4096, confirming context-window exhaustion rather than the separate
4,096-token output cap. A process-only context override to 8192 for the same
night produced complete JSON and passed schema/evidence validation in about
53 seconds (5,549 prompt tokens, 935 generated). Saved settings were unchanged.

The provider now distinguishes confirmed full context using native token
counters, and the orchestrator avoids repeating generation in that same full
window. Public schemas and prompt version 4 remain unchanged. Regression failed
before and passes after; `npm run verify` passed with 200 tests and two optional
tests skipped, plus demo smoke. The UI setting must be changed to 8192, saved,
and compatibility tested. This establishes generation compatibility for that
night, not clinical accuracy; manual UI confirmation remains pending.
