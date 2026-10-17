# Groq in OSCAR Expert

Groq is an opt-in cloud provider in the shared **Analysis → Expert** screen.
Daily, Trend, Compare, Ask Anything, follow-ups, streaming and Stop use the same
controls as the other providers. Local Ollama remains the default. Switching
providers starts a new conversation; the backend rejects cross-provider history.

## Setup

1. Create a Groq API key in your Groq account.
2. Open **Settings → AI** and select **Groq** to show its settings.
3. Selecting Groq enables it automatically. Enter the separate Groq API key. Click **Refresh
   models** to save the key and load active model IDs from Groq. Choose a chat
   model that supports function calling. Listing alone does not verify model
   permissions or tool support. The initial editable model ID is
   `llama-3.3-70b-versatile`; availability/limits depend on the account. It may
   be unavailable, so refresh models rather than assuming the default works.
4. Click **Test Groq Connection**. It saves the current model/key first, then
   sends a small synthetic function-calling inference request without therapy data. Normal
   account usage/rate limits apply. A successful test verifies authentication,
   access to that model and basic function calling; it is not clinical validation.
5. Open **Expert**, select a therapy date or explicit ranges
   and start an analysis. Follow-ups
   inherit the analysis periods. **Stop** cancels the active upstream request.

No OpenAI account, tunnel ID, tunnel runtime, public MCP URL, router change,
inbound firewall rule or port forwarding is needed for Groq. The backend makes
outbound HTTPS requests to the fixed `api.groq.com` endpoint. The MCP tools and
clinical database remain private. Model inference and necessary measurements are
processed by Groq in the cloud.

## Credentials and account privacy

Groq's key is separate from OpenAI's API and tunnel credentials. Configuration
is stored atomically in `<database>.groq.json`, outside the clinical schema.
Desktop uses the same OS-encrypted secret codec as OpenAI. Settings responses
contain `apiKeyConfigured` and never the original key. A blank key preserves it;
enter a replacement or select removal and Save. The renderer clears entry state
only after a successful save and displays a configured flag. A failed save keeps
the entered key for retry; no existing key is ever returned. No key is put in localStorage, prompts, logs or diagnostic
bundles. Configuration and temporary files are ignored by Git.

Headless keys remain in backend memory only and require re-entry after backend
restart. The UI identifies this mode. Shutdown clears backend memory credentials.
Remote browser configuration uses the existing API bearer/origin protections;
use an authenticated HTTPS deployment for network access as described in the
existing deployment guides.

Groq Chat Completions documents `store` as unsupported, so this provider does
not send that OpenAI-specific parameter. OpenAI Responses requests still
explicitly use `store:false`; that implementation is unchanged. OSCAR does not
invoke Groq persistence features such as batch jobs, fine-tuning or LoRAs, or
opt traffic into voluntary training/data sharing. Conversation state is maintained
locally rather than using provider conversation/response IDs.

Review your Groq organization's **Data Controls**. OSCAR cannot verify retention,
sharing or Zero Data Retention settings and does not claim ZDR is enabled. Groq
documents potential reliability/abuse-monitoring retention and account controls
separately from ordinary inference behavior. See [Groq's data documentation](https://console.groq.com/docs/your-data).

## Backend flow and limits

`Expert → existing preload/REST adapter → AIService → GroqProvider → Groq`.

The provider seeds the selected night/range/comparison with a minimized OSCAR
aggregate, then supplies only the eight existing read-only tools as function
definitions. When Groq requests additional data, OSCAR validates the tool and
arguments and executes it locally. Results use the authoritative `ExpertTools`
implementation shared with MCP; no separate data-access or clinical algorithm is
introduced. Groq does not directly connect to OSCAR's database or MCP listener.

`ScopedCloudTools` is shared by Groq and the private OpenAI MCP adapter. It
enforces profile/machine ownership, selected date periods, strict tool schemas,
bounded windows/events, read-only access and identity filtering. It rejects
arbitrary SQL, unknown/write tools and dates in the gap between comparison
periods. Tool names, arguments and results are never accepted as authority to
expand scope. Every invocation uses the existing read-only query layer.

Limits include 12 total tool calls (including the initial aggregate), at most
two identical calls, 120,000 characters per existing tool result and 180,000
cumulative result characters. All selected ranges retain the 90-day maximum.
Each model round is limited to 4,096 completion tokens, 16,000 argument characters
per tool call and a bounded stream; total visible answer text is capped at 64,000
characters. The shared service retains its 180-second deadline and bounded,
ephemeral conversation/job limits. Seed data, previous context and tool results
exclude unnecessary identity, filesystem paths, raw waveforms and unrelated dates.
User question text is sent as entered; avoid including identifying details in it.

Only registered function tools are supplied. Built-in browsing/code execution
and remote MCP are not enabled. `include_reasoning:false` is sent and reasoning
fields/provider metadata are not forwarded to the UI. Streamed tool argument
fragments are reconstructed and validated on the backend; clients receive only
OSCAR status/text/completion/error events. Truncation, malformed tool calls,
provider failures and interruptions produce incomplete/failed results. Failed
or cancelled turns never become completed follow-up context; no provider fallback
is attempted. Cancellation aborts inference and closes the stream without
stopping unrelated provider services.

## Troubleshooting and validation

- **Credential/permission rejected:** replace the Groq key and check account access.
- **Model unavailable or compatibility failed:** click Refresh models, choose
  a supported chat model from the returned list and rerun the synthetic
  connection test. The selected model is saved before testing. An unavailable
  model does not mean that saving the API key failed.
- **Rate/usage limit:** check Groq limits/billing and retry later; OSCAR does not
  retry indefinitely or switch providers automatically.
- **Request too large (HTTP 413):** shorten a 90-day trend to 30 or 7 days,
  or start a new conversation to remove previous context. OSCAR keeps your
  selected range intact; model/account request limits can be lower than the
  application's 90-day range limit.
- **Processing failure (HTTP 422):** Groq could not process the request or
  generated tool call. Retry or choose another tool-capable model.
- **Service/gateway failure (HTTP 500/502/503/504):** retry later; HTTP 504 may
  also benefit from a shorter trend. Capacity failures show HTTP 498. Errors
  include their HTTP status without exposing the provider response body.
- **Tool request rejected:** verify exact selected dates, missing coverage and
  range/window limits. The model cannot broaden the selected periods.
- **Partial answer or timeout:** the answer is incomplete. Shorten the range or
  choose a suitable model before retrying.

Automated tests use synthetic therapy fixtures and mocked Groq responses; no
paid API requests or real therapy uploads are made. Live Groq permissions, model
behavior, latency, rate limits, retention settings and Windows UI/keychain
acceptance remain real-machine checks. See [recorded validation](OSCAR-AI-VALIDATION.md).

Implementation follows the official [local tool calling guide](https://console.groq.com/docs/tool-use/local-tool-calling)
and [API reference](https://console.groq.com/docs/api-reference). HTTP failure
classification follows [Groq's error documentation](https://console.groq.com/docs/errors).
