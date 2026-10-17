# OSCAR Expert MCP

Groq uses backend-managed function calling against the identical read-only tool
registry. `ScopedCloudTools` shares the private MCP adapter's date/profile checks,
data minimization and budgets. This path does not open a new MCP listener or use
the OpenAI tunnel. See [Groq integration](GROQ.md).

OSCAR AI additionally manages an authenticated **private HTTP transport** around
the same read-only registry for OpenAI Secure MCP Tunnel. This is separate from
the stdio adapter below. Its loopback listener is not the public REST API: active
requests require a tunnel credential plus a short-lived per-analysis token and
date/profile scope. See [OSCAR AI](OSCAR-AI.md) for setup, privacy, runtime
provisioning and shutdown. The external stdio host's privacy remains its own
responsibility.

The internal Expert orchestrator calls `ExpertTools` directly. The separate
MCP adapter exposes that exact registry and implementation to external clients;
it does not repeat SQL/domain calculations or sit in the internal review path.
The implementation uses the stable split TypeScript SDK v2 packages, locked to
2.3.1 at implementation time. See [official SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
and [stdio transport](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html).

## Start and diagnose

Install root dependencies and build first:

```powershell
npm install
npm run build
npm run mcp:check -- --database .\data\oscar-next.sqlite --profile 1 --machine 42
npm run mcp -- --database .\data\oscar-next.sqlite --profile 1 --machine 42
```

Use actual IDs from your selected OSCAR profile/machine. `--check` validates the
existing database/schema/scope and lists tools on stderr without starting the
transport. `--help` lists options. No model/Ollama is required for MCP: the host
supplies its own AI. The host owns process startup/shutdown; the Expert UI does
not claim to enable or monitor that external process. No HTTP transport or port
is implemented in this version.

Database resolution is `--database`, then `OSCAR_DATABASE`, then desktop default:

| OS | Default |
| --- | --- |
| Windows | `%APPDATA%\oscar-next\oscar-next.sqlite` |
| macOS | `~/Library/Application Support/oscar-next/oscar-next.sqlite` |
| Linux | `$XDG_CONFIG_HOME/oscar-next/oscar-next.sqlite`, or `~/.config/oscar-next/oscar-next.sqlite` |

For headless/custom databases, set `OSCAR_DATABASE` or `--database` explicitly
to the same file used by the app; the headless `./data` default is different.
Without `--profile`, the active app profile (or first profile) is selected.
Without `--machine`, the profile must have exactly one machine. Scope is pinned
at startup: restart the MCP process after switching profiles/machines.

An existing current-schema database is required. MCP opens it read-only and
never creates or migrates it. Open older databases in OSCAR Next first.

## Example external client configuration

Adapt the host's MCP configuration format and replace placeholders. Use Node
directly with the absolute compiled entry path so npm's banner cannot contaminate
stdio protocol output:

```json
{
  "mcpServers": {
    "oscar-expert": {
      "command": "node",
      "args": ["<absolute-project-path>/dist/src/expert/mcp.js", "--profile", "1", "--machine", "42"],
      "env": { "OSCAR_DATABASE": "<absolute-database-path>/oscar-next.sqlite" }
    }
  }
}
```

The external client must have filesystem permission to read that database.
Protocol messages use stdout exclusively; startup/error diagnostics use stderr
and do not print database paths or therapy payloads. The SDK integration test
launches this entry with a real stdio client and checks every tool against the
equivalent direct call.

## Tools, resource and prompt

Tool arguments omit profile/machine because startup pins those IDs. Every input
uses the same strict Zod schema as direct calls. Dates are `YYYY-MM-DD` therapy
dates; optional times are numeric device wall-clock milliseconds, half-open
`[startMs,endMs)`, within that noon-to-noon day.

| MCP tool | Arguments / result |
| --- | --- |
| `oscar_get_night_summary` | `date`; included-session measurements/settings, channel analysis, provenance |
| `oscar_get_events` | `date`, optional `startMs`, `endMs`, `eventTypes` channel IDs; bounded exact records |
| `oscar_get_statistics` | `startDate`, `endDate`; aggregate/nightly statistics |
| `oscar_compare_ranges` | `current` and `baseline` date ranges; aggregates, changes, used-night AHI medians |
| `oscar_get_pressure_analysis` | date/window; recorded pressure summaries and included settings |
| `oscar_get_leak_analysis` | date/window; coverage, configured threshold, recorded time above threshold |
| `oscar_get_oximetry_summary` | date/window; SpO2/pulse summaries or explicit missing coverage |
| `oscar_get_waveform_features` | date, required start/end, supported numeric `channels`; existing summaries, no arrays |

All results wrap `data`, `evidence`, and `limitations`. The same bounds and
unsupported-channel rules described in [LOCAL-AI.md](LOCAL-AI.md) apply. There
are no arbitrary SQL, file, shell, configuration-write or clinical-write tools.
The adapter clears its request cache before each call so a long-lived client
sees subsequent imports or inclusion changes. Internal reviews reuse aggregates
only within that review.

Resource `oscar://capabilities` returns the registry, read-only flag, range/window
limits and pinned scope IDs, with no patient identity. Prompt `review-night`
accepts `date` and guides an external client toward evidence-backed educational
analysis. It is guidance, not enforcement of an external model's output schema.

## Security boundary

This is a local stdio process, accessible only to its launching host. The database
is opened with SQLite read-only/query-only options; profile ownership and schema
are checked. API authentication/import defaults are unchanged. Tool annotations
declare read-only behavior, backed by code and database immutability tests.

**External MCP hosts control where returned health data goes.** Choosing a cloud
AI client can forward it outside this computer; OSCAR's internal loopback-only
provider restrictions do not control another program. Use a trusted local host
and local model to retain the intended local-only workflow. The adapter cannot
guarantee medical safety, evidence grounding or privacy of an external client.
