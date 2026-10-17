# OSCAR Expert: local and cloud analysis

Analysis → **Expert** now contains one shared Daily, Trend, Compare and Ask
Anything interface for **Local Ollama**, **OpenAI** and **Groq**. Local Ollama is selected
by default. Choose the provider explicitly in **Settings → AI**. Switching providers starts
a fresh conversation; the backend rejects attempts to reuse another provider's
conversation ID. All providers use read-only OSCAR tools and cannot change CPAP settings.

Conversation questions appear in right-aligned bubbles, with Expert answers
left-aligned below them. This shared layout supports desktop and browser,
streaming answers and structured local review/evidence cards.
Analysis criteria appear in a fixed full-width section below the main page
header, matching Therapy history in Overview and Statistics. An inline badge
shows the current provider; the gear icon opens Settings → AI and has a
"Configure AI in Settings" tooltip. Only the conversation pane scrolls through messages. The message box
stays at the bottom with a Send button matching its height; Stop is available
while an answer runs. New Conversation, Clear Conversation and Clear All AI
History are in the top criteria section. The keyboard hint appears as a tooltip
on the message box. On compact windows, long criteria
can scroll within their fixed panel so all controls remain accessible.
**Enter** sends; **Shift+Enter**
adds a new line. Confirming composed input does not send the message.

Groq and OpenAI conversation answers render Markdown headings, emphasis, lists,
code and tables. Wide tables scroll horizontally within the answer. Partial
streamed Markdown is displayed as it arrives. User messages remain plain text,
and local validated reviews retain their structured evidence layout. Embedded
HTML is ignored, images display as text without loading external resources, and
only HTTP(S) or in-page links are active.

**Groq** uses a separate API key and model, with read-only tool execution managed
by the backend. It needs no OpenAI tunnel or public MCP endpoint. See
[Groq setup, privacy and limits](GROQ.md). Its provider-specific retention controls
are distinct from OpenAI's `store:false` setting. All providers share the guided
UI, explicit date ranges, isolated local conversation context and cancellation.

Provider selection and configuration are centralized in **Settings → AI**, which
shows only the selected provider's settings. The choice is saved automatically
on this desktop/browser client; no credentials are stored with this preference.
Selecting a provider enables it automatically when its settings load; there is
no separate provider enable checkbox. Existing model, key and connection values
are preserved. Selecting a provider does not start inference or waive connection
or compatibility requirements.
Expert uses that choice and displays the active provider badge with a settings
gear shortcut.
Settings also groups appearance under **General**, device analysis and graph
preferences under **Therapy & graphs**, and deployment information under
**Connection**. Unsaved form values are preserved while switching Settings tabs.

Local Ollama uses the existing Expert settings, compatibility checks and validated
review pipeline. Open **Settings → AI**, select **Local Ollama**, choose a model and
test compatibility. No OpenAI credentials or tunnel are needed. The same guided
requests resolve to the existing night, trend, comparison and question reviews.
Results appear after structured output, evidence and treatment-boundary validation,
with the original Show evidence links and timings. Progress is reported while
the model works; incomplete local JSON is not streamed as an accepted review.
See [local setup](LOCAL-AI.md). There is no automatic cloud fallback.

## OpenAI setup in Settings → AI

1. Open **Settings → AI**, select **OpenAI**,
   and enter an OpenAI model ID. Selecting it enables OpenAI analysis. The initial
   editable value is `gpt-4.1`; availability and tool support depend on your account.
2. Enter the **OpenAI API key** used for Responses API requests.
3. Create a Secure MCP Tunnel once in OpenAI Platform. Associate it with the
   organization making your API requests, and obtain a runtime key with the
   least privilege needed to use the tunnel. Tunnel creation is external in v1.
4. Enable Secure MCP Tunnel and enter its **Tunnel ID** and separate **Tunnel
   Runtime Key**. OSCAR does not request a tunnel-management/admin key.
5. Save. With a verified runtime installed, OSCAR starts MCP and tunnel-client.
   Click **Test Everything**. Startup may take several seconds; monitored status
   refreshes automatically. All dependencies must pass for **AI Ready: Yes**.
6. Open **Expert** and start an analysis using the selected OpenAI provider.

No terminal is needed for normal desktop operation after your installer provides
the runtime. No router, NAT, UPnP, port forwarding or inbound firewall changes
are made. MCP listens only on an ephemeral `127.0.0.1` port. The tunnel initiates
outbound HTTPS to `api.openai.com:443`.

Desktop keys are encrypted using Electron `safeStorage` before atomic persistence
in `<database>.ai.json`. The OS account must support encryption; Linux's insecure
`basic_text` fallback is refused. Settings return only configured flags. Blank
password fields preserve existing keys; enter replacements or select removal and
Save. Persisted secret values are never returned to the renderer or localStorage.

**Headless limitation:** there was no existing headless OS secret store. Keys
entered through Settings stay in backend memory and must be re-entered after a
backend restart. OSCAR does not persist plaintext credentials. The UI identifies
this mode. A headless OS credential-store integration remains future work. Use
loopback access or an authenticated HTTPS deployment when entering credentials
from a remote browser; the existing HTTP listener does not provide TLS itself.

## Analyses and dates

Daily accepts one exact therapy date and identifies dates without included
therapy sessions. **Last Night** resolves to the previous local calendar date
before submission; if your browser clock/timezone differs from the CPAP wall
clock, select the intended therapy date explicitly. It never selects an arbitrary
older night when last night has no data.

Trend presets cover 7, 14, 30 or 90 inclusive calendar days ending at Last Night;
custom ranges support 1–90 days. Compare supports independent ranges, previous
equal-length periods, and this calendar month to date versus the previous full
month. Exact dates are visible and sent in structured requests. Each comparison
period is independently limited to 90 days. Missing coverage and summary-only
indices retain the existing OSCAR semantics.

Ask Anything starts with an explicit question range. Follow-ups inherit the
preceding analysis's exact authorized dates. Choose a new guided analysis or a
new conversation to change that scope. Questions needing unavailable data should
produce a limitation rather than invented measurements. AI text is educational,
may be wrong, and is not clinical validation or a diagnosis.

**Stop** aborts the provider request and revokes its MCP authorization, leaving
the tunnel running. New Conversation starts fresh UI/context; Clear Conversation
also deletes that conversation's backend state. Clear All AI History, or the
Settings history button, cancels and deletes conversations/jobs for the selected
profile/device. Other profiles/devices are unaffected.

## Architecture and privacy

See [AI backend layout](src/ai/README.md) for provider, configuration, shared tool
and MCP transport folders. Protocol adapters have separate folders under
`src/ai/providers/`; the service and contracts remain shared.

`Expert → shared ExpertAnalysis → OscarApi preload/REST → AIService → selected provider`.

OpenAI: `OpenAI Responses → Secure MCP Tunnel → private MCP → ExpertTools`.

Local Ollama: `LocalExpertProvider → existing ExpertService/orchestrator →
loopback Ollama and the same read-only ExpertTools`. The local bridge disposes
of its underlying temporary review job after delivering the validated result;
shared conversation history is held only by AIService. Historical Expert REST
endpoints remain compatible.

Prompts/intents live in `src/ai/analysis.ts`, with strict request contracts in
`src/ai/contracts.ts`. `AIProvider` exposes ask, stream, connection testing and
capabilities. OpenAI's wire protocol is isolated in `src/ai/providers/openai/provider.ts`, using
Node's fetch instead of an additional SDK dependency. LocalExpertProvider adapts
the existing validated Ollama service to the same interface. Provider selection
is explicit in requests; omitted providers inherit an existing conversation or
default to OpenAI for compatibility with older API clients. The UI always sends
its explicit choice. OpenAI configuration remains isolated from local settings.

Every Responses request explicitly sets **`store: false`**, with no toggle,
provider conversation IDs, previous response IDs or background persistence.
OSCAR does not call feedback, evaluation, fine-tuning or voluntary sharing APIs.
Account/project training-sharing settings cannot be verified here: check them
in your OpenAI account. Ordinary abuse-monitoring/account retention can still
apply. Zero Data Retention is account dependent; OSCAR does not claim it exists.

Only the existing eight read-only tools are registered. Tool metadata declares
read-only/non-destructive/closed-world behavior, and OpenAI's tool filter combines
`read_only: true` with an explicit allowlist. There is no SQL, filesystem, shell,
configuration-write or therapy-write tool. The existing stdio MCP is unchanged.

The private HTTP adapter requires both a tunnel-only credential and a fresh
per-analysis bearer token. A revoked/stale token cannot use a later request's
scope. Only the active profile/machine and selected dates are accessible. Tools
prefer aggregates, return no raw waveform arrays and enforce existing range,
event/window and result bounds. Cloud serialization removes scope/evidence IDs,
names, serials, paths and other identity fields. User-entered question text is
sent as entered; avoid including identifying information in it.

One AI operation runs per backend/database. Each generation has a 180-second
deadline, 12 MCP calls and 180,000 cumulative tool-result characters. Each tool
result retains its existing 120,000-character bound. Answers are limited to
64,000 characters and a 4,096 output-token budget. Local conversations allow 40
messages, a 64,000-character prior context and one hour of inactivity; expired
records are removed on subsequent access. There are at most 20 conversations and
40 jobs; finished jobs expire after five minutes on subsequent access. State is
memory-only, not clinical database content, and disappears on backend shutdown.
Only completed turns become follow-up context; partial/cancelled text is marked
incomplete and never reused as a completed answer. Local follow-ups add up to 12
complete previous messages within 16,000 characters as untrusted context; earlier
AI text is never treated as measurement evidence. Local questions retain the
existing 2,000-character limit. Evidence and tool-range checks still apply.

OpenAI SSE is decoded into OSCAR `status`, `text_delta`, `complete` and `error`
events, plus a `review` event for validated local results. Browser adapters use authenticated SSE; desktop uses incremental batches
over isolated preload IPC. Hidden reasoning and raw provider stream objects are
never exposed. Event cursors address immutable entries. Browser SSE disconnects
cancel active generation; desktop page/scope changes cancel via preload. If a
renderer crashes, the generation deadline still bounds cleanup.

## Runtime provisioning (release engineering / administrators)

No tunnel executable or secret is committed. OSCAR does not silently download
or execute code. Before packaging, obtain the appropriate official tunnel-client
release, verify its published provenance/checksum through your release process,
and place the executable and manifest under `runtime/tunnel-client/`. The
Electron builder copies this directory outside ASAR to `resources/tunnel-client`.
The desktop automatically locates `manifest.json` there. Source development uses
the repository runtime directory. Headless deployments set the backend-only
`OSCAR_TUNNEL_MANIFEST` to an administrator-provisioned manifest.

```json
{
  "file": "tunnel-client.exe",
  "version": "<installed semantic version>",
  "sha256": "<64 hexadecimal digits from the verified executable>"
}
```

For ARM64/Linux, use the correct executable name/platform and executable file
permissions. Keep the manifest and binary protected by deployment ownership/ACLs.
The renderer cannot choose executable paths or edit this manifest. OSCAR checks
existence, SHA-256, and `--version` before spawning without a shell. Runtime
upgrades replace both the verified executable and manifest through the deployment
process; no old release URL/version is hard-coded. **This source change does not
include a preinstalled runtime or certify a particular binary release.**

OSCAR generates a private per-run JSON/YAML configuration with secret environment
references, loopback MCP and an ephemeral loopback health listener. Runtime keys
never appear in argv/config files. Child output is discarded; raw HTTP logging
is disabled. Discovery-only headers let tunnel-client initialize/list tools
before a review starts; that credential cannot retrieve therapy measurements.
Forwarded analysis requests retain their per-request bearer authorization.
`/healthz` and `/readyz` are checked every two seconds; process
existence alone never establishes readiness. Startup has 30 seconds of grace;
three subsequent failed probes trigger recovery. Unexpected exits also trigger
recovery, capped at three retries with 2/4/8-second backoff. Manual Restart Tunnel
resets the budget. Exhausted recovery requires manual action.

For enterprise control-plane mTLS, an administrator can configure both
`CONTROL_PLANE_CLIENT_CERT` and `CONTROL_PLANE_CLIENT_KEY` as PEM file paths in
the backend environment. Both are required together. The generated runtime
configuration then uses `https://mtls.api.openai.com`. Normal Settings entry
still supplies the separate runtime API key. Certificates are not exposed to UI.

Normal desktop before-quit and API/headless shutdown await child termination and
MCP closure. OSCAR requests SIGTERM, waits up to three seconds, then SIGKILL.
On Windows, Node's process termination does not provide POSIX signal semantics.
Only OSCAR's owned child is killed: no PID file is trusted and unrelated processes
are never killed. Forced parent termination/power loss cannot guarantee cleanup;
Windows job-object supervision/crash recovery remains an acceptance limitation.

## Troubleshooting and acceptance

- Missing/invalid API key or model: replace it in Settings and Test OpenAI.
- Missing runtime credential: enter the separate key and Save.
- Missing/unverified binary: have the installer/administrator provision the
  runtime manifest; recheck integrity/version, architecture and permissions.
- Tunnel not ready: inspect health/readiness and recovery count in Advanced
  Diagnostics. Check runtime key permissions, outbound HTTPS and tunnel/account
  association. No inbound port is needed.
- MCP failure: use Test MCP Connection; it initializes and validates every
  discovered tool's annotations and names. Select a valid profile/device and
  included therapy dates before analysis.
- Streaming interruption/timeout: partial output is incomplete; shorten the
  range and retry. The tunnel continues independently of generation cancellation.

Tests use synthetic therapy fixtures and mocked OpenAI/tunnel dependencies. No
paid requests are made. Live account access, tunnel setup, packaged runtime,
OS-keychain behavior, real Electron callbacks/shutdown and ARM64 execution require
the real-machine checks in `WINDOWS-ACCEPTANCE-CHECKLIST.md`. They are not implied
by passing tests. See `OSCAR-AI-VALIDATION.md` for recorded checks.

Implementation references: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
[MCP authorization](https://developers.openai.com/api/docs/guides/tools-connectors-mcp),
[tunnel-client configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md).
