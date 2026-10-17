# OSCAR Expert: local AI

OSCAR Expert's shared Daily, Trend, Compare and Ask Anything interface supports
Local Ollama and OpenAI. Select **Local Ollama** (the default) for the local-only
workflow described here. OSCAR calculates measurements and a local model explains
them. Provider conversations are separate; local failures never fall back to cloud.
Reviews are educational, may be wrong, and are not diagnoses or therapy instructions.

## Setup

### Windows quick setup

From the repository root in PowerShell, run as your normal Windows account:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-local-ai.ps1
```

The script installs Ollama through Windows Package Manager (`winget`) if absent,
sets user and process `OLLAMA_NO_CLOUD=1` and `OLLAMA_HOST=127.0.0.1:11434`,
restarts Ollama from the same installation in your Windows session, and explicitly
downloads `qwen3.5:4b`. Existing Ollama chats/reviews in that session are interrupted.
It checks downloaded-weight metadata and advertised tool support. It does not
read therapy data, change OSCAR settings, or run inference. No firewall rule is
added. Internet access is needed for installation/downloads.

If an older script rejects local Qwen weights after a successful download, use
the updated script and rerun the same command. Older metadata checks mistook
"Alibaba Cloud" in the model license for cloud execution. The installer and
backend now inspect model-source declarations and explicit remote metadata;
local weight metadata remains required. Rebuild and restart OSCAR when updating
the backend (`npm run build`, then relaunch your desktop/headless deployment).
Downloaded weights are reused; deleting or redownloading them is unnecessary.

If `winget` is unavailable, install from the
[official Windows download](https://ollama.com/download/windows), then rerun.
Use a current Ollama release; an existing installation is reused, not upgraded.
If model download reports an unsupported model, update Ollama and rerun.

The [Qwen 3.5 4B listing](https://ollama.com/library/qwen3.5:4b) advertises tool
support and currently lists a roughly 4 GB download. Allow additional disk space
for Ollama and updates. As a starting hardware recommendation, use 16 GB system
RAM; actual memory use depends on context, GPU offload and other applications.
CPU operation can be slow and may exceed OSCAR's 180-second review deadline.
This is a candidate model, not a validated or clinically certified recommendation.
The earlier Gemma chat example is not the project setup recommendation: Expert
also requires tool calling and structured JSON.

In OSCAR, open **Settings → AI** and select **Local Ollama**:

1. Selecting Local Ollama enables local reviews automatically. Set **Ollama URL**
   to `http://127.0.0.1:11434`.
2. Click **Refresh models** and select `qwen3.5:4b`.
3. Start with **Context size: 8192** and click **Save settings**. This is a
   starting value, not a guarantee that long trend ranges fit. Reduce it to 4096
   only when the requested review still fits. If memory is tight, a smaller
   compatible model may be preferable to a context window too small for the
   measurements and JSON response; shorten the review range as needed.
4. Click **Test compatibility**. Reachability, local model, chat, tool calling
   and structured JSON must all pass. A downloaded model alone is not a pass.
5. Open **Expert** and try **Daily → Sleep Summary**
   with demo data before using imported therapy data.

For an optional terminal chat, use `ollama run qwen3.5:4b`. This is separate from
OSCAR; the app invokes Ollama through its backend API. Expert already requests
`think: false`, so no custom Modelfile or prompt configuration is required.

To explicitly select another downloaded local model:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-local-ai.ps1 -Model qwen3.5:9b
```

Larger models need more memory. Retest compatibility after changing models.
After reboot, open Ollama from Start if it has not started automatically. The
script starts a hidden `ollama serve` process for the current login; it does not
install a Windows Service. For headless deployments, run this on the backend
computer. A backend running as a Windows Service needs an independently managed
Ollama server under the intended account, with the same local-only environment
and access to that account's downloaded models. Per-user installs do not provision
another service account. The script refuses to reuse an already running server
that it cannot restart, because its cloud configuration is unknown.

User environment settings follow [Ollama's Windows configuration instructions](https://docs.ollama.com/faq).
To revert them, quit Ollama, remove or restore `OLLAMA_NO_CLOUD` and `OLLAMA_HOST`
under **Edit environment variables for your account**, then restart Ollama.
Remove model weights with `ollama rm qwen3.5:4b`; uninstall Ollama through Windows
Settings if no longer needed.

### Manual setup (all platforms)

1. Install [Ollama](https://docs.ollama.com/quickstart) on the computer running the
   OSCAR backend. For browser deployments this is the **headless server**, even
   when the browser is on another computer.
2. Disable Ollama cloud features using `OLLAMA_NO_CLOUD=1` in the **Ollama
   service's environment**, then restart Ollama. See
   [Ollama cloud settings](https://docs.ollama.com/cloud). A localhost endpoint
   alone does not establish that an Ollama model runs locally.
3. Install a downloaded model that fits the computer's RAM and supports tool
   calling and JSON-schema output. Use Ollama's model interface, or explicitly
   run `ollama pull <model-name>` yourself. OSCAR never installs Ollama, pulls
   models, or falls back to a cloud model automatically. No particular model is
   required or certified by this implementation.
4. Open **Settings → AI** and select **Local Ollama** to enable local reviews,
   keep `http://127.0.0.1:11434` unless using another loopback port, and click
   **Refresh models**. Select an installed model and optional context size.
5. Click **Test compatibility**. Synthetic probes check reachability, downloaded
   model metadata, normal chat, tool calling and structured JSON. No therapy
   data is used in these probes. Open **Expert** to
   start an analysis. The backend enforces compatibility before generation and
   may reuse a successful check for five minutes, bound to settings and model
   digest. Reopening Expert does not require a manual test each time.

Only HTTP root URLs using literal `127.0.0.1`, `localhost` or `[::1]` are allowed.
Redirects, credentials, arbitrary hostnames and remote URLs are rejected.
Installed cloud model names and remote-backed model metadata are rejected before
therapy context is sent. Metadata is a conservative compatibility check, not an
attestation of an untrusted daemon: use your own trusted local Ollama service.

## Reviews and evidence

- **Daily** uses the selected noon-to-noon therapy date. The initial
  context includes included-session usage, rates, settings and recorded channel
  analysis. Exact events remain distinct from summary-only STR rates.
- **Trend** accepts 7, 14, 30, 90 or custom calendar-day ranges. **Compare** selects
  two independent periods, with preceding-period presets. Aggregates and used-night
  medians come from OSCAR rather than model arithmetic.
- **Ask Anything** accepts a therapy-analysis question within the selected range,
  including follow-ups to guided reviews. The model uses the same bounded tools;
  previous dialogue is context, not authoritative measurement evidence.
- **Show evidence** opens Daily at the referenced date and, when supplied, graph
  window. Range/comparison evidence opens the first current-period day; it does
  not open every compared night or change the Overview date filter.
- **Stop** aborts active model generation. Status messages describe actions;
  hidden reasoning and partial/unvalidated reviews are never displayed.

The completed result separates positive findings, items to review, confidence,
clinician questions and limitations. Query time, model time and total time are
reported separately. Review metadata includes model name/digest, generation
time, and prompt/schema versions. **Expert diagnostics / MCP** lists the tool
registry and explains the separate externally managed MCP process.

## Privacy and persistence

Selecting Local Ollama in Settings → AI enables local reviews automatically.
Backend clients retain the explicit enabled setting. The internal path is React → preload or REST →
ExpertTools/orchestrator → loopback Ollama. There are no Internet/search tools,
cloud fallback, remote embeddings or therapy uploads. Model context excludes
profile names, machine serials, database/card paths, notes and raw waveform
arrays. Local profile/machine IDs, therapy dates and measured values are present.
Existing API bearer-auth and import permission rules still apply. An authorized
LAN browser receives its requested results from the server as with other pages;
the server's AI requests themselves stay on loopback.

Settings are application configuration in `<database-path>.expert.json`, saved
atomically alongside the database. They are not clinical records. Reviews are
in memory, expire after five minutes on subsequent access, and disappear on
backend restart. Leaving the page or changing profile/machine cancels its active
review. Refreshing/crashing the browser may leave a job running until its deadline;
completed jobs are bounded and ephemeral. Logs contain tool names, durations,
counts and success metadata, without questions, prompts, responses or payloads.
Ollama and external MCP clients have their own retention/privacy behavior.

## Limits and troubleshooting

Each backend allows one active review or compatibility test. Reviews have a
180-second total deadline, 12 tool calls including initial context, and at most
two identical calls. Each range is limited to 90 days; waveform-feature windows
to one hour and eight supported channels. Tools return at most 1,000 events and
120,000 JSON characters, with a 180,000-character cumulative tool context limit.
These are character limits, not token counts; choose a model/context size that
fits the selected range. Ollama replies are bounded to 256,000 bytes. Synchronous
SQLite/sample calculations cannot be interrupted mid-call; cancellation is
checked around them and aborts network generation.

If Ollama is unavailable, start its service and test again. If a model is absent,
install/select one locally. Failed capability checks disable review generation.
Timeouts, insufficient model memory and invalid tool/JSON/evidence responses
produce an error without displaying a trusted review or crashing the backend.
If an older build reports **Review type does not match request**, rebuild and
restart OSCAR. Prompt version 2 constrains the model's output type to the selected
night, trend or question request, rather than asking it to choose from all three.
The backend continues to reject mismatched types and invalid evidence.
For **Invalid structured review**, the model supplied malformed JSON; this is
different from a review-type mismatch. Prompt version 3 regenerates empty,
truncated or malformed JSON once with a concise-output instruction, within the
same 180-second deadline. It does not repair text, reuse invalid output, or
retry schema/evidence/treatment failures. If the second response fails, the
message distinguishes empty output, output-token exhaustion and malformed JSON.
Rebuild and restart OSCAR to use this behavior. A shorter date range may help
if the error persists; smaller context can truncate input, so it is not a
general solution to output-generation failures.
If **Model reached its output token limit** persists on an older build, rebuild
and restart OSCAR to use prompt version 4. Earlier generation schemas allowed
24 observations with long explanations while each response was capped at 3,000
tokens. Reviews now contain at most two positive findings and two items to review,
with explanations up to 350 characters, a summary up to 600 characters, two short
clinician questions and three short limitations. These generation limits are
also validated after decoding. Structured output has a bounded 4,096-token budget;
tool-selection output retains its 3,000-token budget. Neither setting guarantees
completion for every model; truncation and invalid results still fail closed.
Use context size 8192 as a starting point; context size and output-token budget
are separate. Tool scope, the 180-second review deadline and the single concise
regeneration remain unchanged. The public response shape remains compatible.
Ollama's `done_reason: length` can also mean the **context window** filled, even
when fewer tokens than the output budget were generated. The provider checks
prompt/generated token counts against an explicitly selected context size and
reports **Review context window is full** when this is confirmed. It does not
repeat generation in the same full context. Increase **Context size** (start
with 8192), **Save settings**, then **Test compatibility** before reviewing.
The September 9 failure was reproduced with context 4096 and the same night
produced validated JSON at 8192. Increasing output tokens alone does not resolve
a full context window. Native counters may be unavailable on other Ollama
versions, in which case the more general output-limit message remains.
HTTP failures give a general service/memory message; OSCAR cannot diagnose the
precise RAM requirement. Try a smaller model, shorter range or smaller context.

Missing channels/oximetry are unknown, not normal or zero. Summary-only nights
cannot establish exact event timing. Deterministic findings report measured
facts and baseline comparisons; this version does not introduce event-cluster,
pressure-ceiling, desaturation or breath-detection algorithms. Signed Flow
features are unsupported; existing pressure, respiratory, leak, pulse and SpO2
channel summaries are available. Trends do not load every raw waveform.

Schema/evidence validation establishes structure and reference existence, not
that a model's explanation is true. Interpretive confidence is capped at
moderate. Prompts and rejection of common treatment commands provide a best-effort
boundary, not a formal clinical safety guarantee. Verify measurements and discuss
therapy questions with a clinician. No tools can alter therapy or imported data.

No reference library is installed: **there are no knowledge citations or RAG
claims**. See [knowledge boundary](src/expert/knowledge/README.md),
[MCP setup](MCP.md), and [validation](AI-EXPERT-VALIDATION.md).

Provider implementation follows the official
[chat API](https://docs.ollama.com/api/chat),
[tool calling](https://docs.ollama.com/capabilities/tool-calling) and
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
