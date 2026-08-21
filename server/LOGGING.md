# Server-side logging

How core, `*.server.ts` in a plugin, and `register.server.mjs` in a module are
expected to emit diagnostics. The counterpart of
[`server/STORAGE.md`](STORAGE.md): one broker, operator-controlled, with a
destination monitoring can read.

> **The rule.** Server code does not `console.log`, and does not invent a
> per-feature `XOPAT_<THING>_DEBUG` env var. It takes a channel logger from
> `XOPAT_SERVER.log(...)` (or `ctx.log` inside an RPC) and lets the operator
> decide what is emitted, at what level, and where it goes.

---

## Quick start

```ts
// Inside an RPC method: already scoped to "<kind>.<itemId>:<method>", with the
// request id and the HASHED caller principal bound to every record.
export async function sendTurn(ctx, input) {
    ctx.log.info({ sessionId: input.sessionId }, "turn started");
    const done = ctx.log.time("upstream call");
    ...
    done({ tokens: usage.totalTokens });          // -> debug + durationMs
}

// Outside a request (boot, lazily built state):
const log = XOPAT_SERVER.log("module.my-module");
const sub = log.child("cache");                    // channel module.my-module:cache
```

Levels: `trace` `debug` `info` `warn` `error` (`silent` to turn a channel off).
Both call shapes work:

```js
log.warn("upstream refused the connection", err);
log.warn({ host, attempt }, "upstream refused the connection");   // structured fields
```

## Channels

A channel is a `:`-separated hierarchy. The effective level is the
**longest-prefix match** in `channels`, falling back to the root `level`:

```
module.vercel-ai-chat-sdk:llm:payload
module.vercel-ai-chat-sdk:llm          <- "module.vercel-ai-chat-sdk:llm": "trace" matches here
module.vercel-ai-chat-sdk
(root level)
```

Conventions:

| Channel | Emitted by |
|---|---|
| `core` | the core server process |
| `rpc`, `rpc.auth` | the RPC runtime and its auth gate |
| `server-route`, `server-route:auth:saml`, … | module-registered HTTP routes |
| `server-ext` | boot-time `register.server.*` loading |
| `console` | stray `console.*` anywhere in the process (captured, never lost) |
| `module.<id>`, `plugin.<id>` | plugin/module code, with any `:sub` you like |

`server/core/getLogChannels` lists every channel seen since boot with its
effective level — use it instead of guessing names.

## Configuration — `core.server.logging`

Defaults live in `src/config.json`; a deployment overrides them in
`env/*.json` under `core.server.logging`. The block holds **no secrets** — it
travels with the served config like the rest of `server`.

```jsonc
"server": {
  "logging": {
    "level": null,                       // null = "debug" in dev, "info" otherwise
    "channels": {
      "rpc": "warn",
      "module.vercel-ai-chat-sdk:llm": "trace"
    },
    "sinks": {
      "console": null,                   // "pretty" | "json" | false (null = pretty in dev, json otherwise)
      "buffer": 10000,                   // bounded ring, read over RPC
      "store": false                     // or {"minLevel":"info","maxEntriesPerDay":50000,"namespace":"logs"}
    },
    "redact": { "maxStringLength": 8000, "maxItems": 50, "maxDepth": 8, "extraKeys": [] },
    "allowSensitive": null,              // null = dev only
    "access": { "principals": [], "claims": {} }
  }
}
```

Levels are re-read on every core build, so a config edit applies without a
restart (the core Node server itself still needs a restart for code changes).

## Sinks

- **console** — `pretty` for humans, `json` for a log collector (one JSON object
  per line, matching what the cluster primary already emits).
- **buffer** — a bounded in-memory ring, present in **every** mode. This is what
  `server/core/getLogs` reads. Per process: with `XOPAT_WORKERS > 1` each worker
  keeps its own, which is why every record carries `pid`.
- **store** — opt-in durable sink. Records append to the storage log namespace
  `core/log:<namespace>` (default `logs`), keyed by UTC day and FIFO-trimmed at
  `maxEntriesPerDay`. Because it is a normal storage namespace, an operator
  routes it with `core.server.secure.storage` bindings — `file` for local
  retention, `tiered` (or a module-provided driver) to share it across cluster
  workers. See [`server/STORAGE.md`](STORAGE.md).

  Writes are fire-and-forget: a logging sink must never apply backpressure to a
  request. Dropped writes are counted in `stats()`, never retried.

## Redaction and sensitive payloads

Redaction happens in the formatter, not at call sites — a call site that must
remember to scrub eventually forgets. Keys matching
`api key / secret / token / password / authorization / cookie / jwt / bearer /
credential / private key` are replaced with `[redacted]`, strings are truncated
at `redact.maxStringLength`, and arrays/objects are capped in breadth and depth.

Payload-bearing diagnostics (full prompts, request bodies, tool arguments) use a
separate call:

```ts
llm.sensitive("MODEL_INPUT", { messages });
```

Such a record is emitted **only when both** hold:

1. the operator set `logging.allowSensitive: true` (defaults to dev mode only), and
2. the channel is at `trace`.

This is deliberate: in a clinical deployment those payloads are patient data.
And it is never a request-supplied switch — RPC input and session metadata are
attacker-controlled, so a per-request debug flag would let any caller turn on
conversation logging (see AGENTS.md §7).

## Recipe: a full conversation / payload dump

The replacement for the old per-feature `*_DEBUG` env dumps. Three things must
line up — the channel at `trace`, the operator opt-in, and caps wide enough that
the payload is not truncated:

```jsonc
"logging": {
  "level": null,
  "channels": {
    "rpc": "warn",
    "module.vercel-ai-chat-sdk:llm": "trace"
  },
  "allowSensitive": true,
  "redact": { "maxStringLength": 200000, "maxItems": 500, "maxDepth": 12 },
  "sinks": { "console": "pretty", "buffer": 20000, "store": { "minLevel": "trace" } }
}
```

- `sensitive` records are printed as indented JSON (the shape the old dumps had),
  so a conversation stays readable in the console.
- `sinks.store` with `minLevel: "trace"` gives a greppable NDJSON file per UTC
  day under the storage root — the practical artifact when a dump is too big to
  scroll. Without it the dump lives only in the console and the ring.
- Secrets are still redacted by key name, and that is not configurable. Raising
  the caps widens *truncation*, never the redaction rule.
- In dev mode `allowSensitive` defaults to `true`, so the channel level alone is
  enough; outside dev it must be explicit.

> Payload records contain whatever the user typed and whatever the model was
> sent. On real data that is PHI: keep this configuration to a debugging
> deployment, and turn `allowSensitive` back off afterwards.

## Reading logs at runtime

```js
// browser console, via the generated RPC client
await window.xserver.server.core.getLogs({ limit: 100, minLevel: "warn" });
await window.xserver.server.core.getLogChannels();
await window.xserver.server.core.setLogLevel({ channel: "module.my-module", level: "trace" });
```

- `getLogs(payload?)` — `{ afterId, limit, level|levels, minLevel, channel|channels, search }`.
  `server/dev/getLogs` remains as a compatibility alias.
- `getLogChannels()` — channels, effective levels, sink state and counters.
- `setLogLevel({channel, level})` — **dev only**, ephemeral, this worker only.
  In production raising a level is a config change: auditable, and applied to
  every worker.

**Access.** In dev mode the reads are open. In production the caller must match
`logging.access` — a principal in `principals`, or a claim listed in `claims` —
evaluated server-side against the verified identity, never against the request
body. An empty `access` means nobody, so a deployment that never configured it
behaves exactly as it did before.

## Monitoring

Two supported paths, pick per deployment:

1. **stdout** — `sinks.console: "json"` and let the platform (docker, journald,
   a sidecar) collect the stream. Nothing else to configure.
2. **store** — enable `sinks.store` and bind `core/log:logs` to a durable or
   shared driver. Records are structured (`ts`, `level`, `channel`, `message`,
   `fields`, `requestId`, `principal`, `pid`), so they can be shipped or queried
   directly.

`principal` is a salt-free SHA-256 prefix (`p_…`) of the caller principal — stable
enough to correlate a session's records, never the identity itself.

## Configuration, not environment

Plugin/module server code reads its knobs from the server config, not
`process.env`:

- with a request: `XOPAT_SERVER.getSecureModuleConfig(ctx, "<id>")` /
  `getSecurePluginConfig`
- without one (boot, lazily built state):
  `XOPAT_SERVER.getStaticModuleConfig("<id>")` / `getStaticPluginConfig`, which
  read the config snapshot core republishes on every core build

Author defaults ship in the element's `server.json`; deployments override in
`core.server.secure.<modules|plugins>.<id>`. The chat SDK's `tuning` block
(`modules/vercel-ai-chat-sdk/server/tuning.ts`) is the worked example — it
replaced a dozen `XOPAT_CHAT_*` variables, which now warn once and will be
removed.

Reserve raw `process.env` for genuinely process-scoped bootstrap values read
before any config exists (`XOPAT_ENV`, `XOPAT_CACHE_DIR`, `XOPAT_WORKERS`). See
[`server/ENVIRONMENT.md`](ENVIRONMENT.md).

## PHP

The PHP runtime has no RPC layer and no logging broker — everything here is
Node-only. PHP deployments keep their web-server error log. Do not add a partial
mirror; if PHP needs structured logging, it should be designed against this same
config block rather than a second mechanism.
