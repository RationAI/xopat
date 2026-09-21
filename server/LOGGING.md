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

- **stream** — opt-in destination OFF the box: batched NDJSON to an HTTP
  collector, to a plain file path, or both. This is the sink that answers "ship
  the logs somewhere"; everything above needs someone already on the machine (or
  scraping its stdout) to read it.

  ```jsonc
  "sinks": {
    "stream": {
      "url": "https://collector.internal/ingest",
      "headers": { "Authorization": "<% LOG_TOKEN %>" },
      "file": "/var/log/xopat/xopat.ndjson",
      "rotate": "daily",          // ".YYYY-MM-DD" before the extension; "none" to disable
      "perProcess": false,        // adds ".<pid>" — see the cluster note below
      "minLevel": "info",
      "includeSensitive": false,  // payload records leave the deployment only on purpose
      "channels": [],             // [] = everything; a list makes a purpose-built file
      "attachments": false,       // write attachment BYTES beside a file destination
      "maxAttachmentBytes": 8388608,
      "batchSize": 100, "flushIntervalMs": 2000, "queueLimit": 5000, "timeoutMs": 5000
    }
  }
  ```

  - **`channels`** filters by channel the same way `getLogs` does — a name matches
    itself and everything under it (`module.chat` matches `module.chat:llm`, and
    never `module.chatter`). This is what lets one destination hold the chat
    transcript and another hold the rest of the server.
  - **`attachments`** lets a **file** destination carry bytes that belong with a
    record — chat attachments, screenshots — into
    `<file-dir>/<basename>.files/<relative path>`, so
    `chat-transcript.ndjson` + `chat-transcript.files/` is one openable artifact.
    The line carries the reference and never the bytes. A `url` destination always
    refuses (no sidecar), an over-cap file is skipped, and both say so on the line
    (`attachment.stored: false` + a `reason`) and in the counters.

  `stream` takes one object or an **array** of them, so "ship to the collector
  AND keep a local file" is one config rather than a choice. A destination naming
  neither `url` nor `file` is dropped, because it would queue records forever
  against nothing.

  - **HTTP goes through the core SSRF guard.** A collector on a private address
    is reachable only via `XOPAT_SSRF_ALLOWED_HOSTS` / `XOPAT_SSRF_ALLOWED_CIDRS`
    — a log destination is not a reason to open a hole (see `server/README.md`).
  - **`includeSensitive` is a second decision, and defaults to false.** A
    `sensitive` record has already passed the operator gate to be *emitted*
    locally; putting it on a network is a larger question, because on real data
    it is PHI. Turning it on is exactly how a full conversation dump is shipped —
    do it deliberately, to a destination you control.
  - **Never backpressure, never lose silently.** `write` only queues; a hung
    collector costs a bounded queue and a rising `dropped` counter, never a
    stalled request. A batch that fails is dropped rather than retried, and the
    per-destination counters in `stats()` are how that becomes visible.
  - **Multi-process:** each worker streams independently and every record carries
    `pid`. One file per batch is a single `appendFile`, so records do not
    interleave mid-line — but with several workers and large payload records,
    `perProcess: true` (a file per pid) is the honest answer.

  Queued records are flushed on shutdown (`server/node/index.js`), so the records
  describing a restart are not the ones that get lost.

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

## Recipe: reconstruct a pilot session

The chat transcript says what was asked; on its own it cannot say which slide was
open, whether the viewer loaded, or whether the participant was reacting to an
error. Add the browser's own timeline to the same file:

```jsonc
"core": {
  "server": {
    "logging": {
      "channels": {
        "module.vercel-ai-chat-sdk:transcript": "trace",
        "module.vercel-ai-chat-sdk:vision": "trace",
        "client:session": "info",
        "client:console": "warn"
      },
      "allowSensitive": true,
      "redact": { "maxStringLength": 200000 },
      "client": { "ingest": true },
      "sinks": {
        "stream": [{
          "file": "/app/logs/pilot.ndjson",
          "channels": [
            "module.vercel-ai-chat-sdk:transcript",
            "module.vercel-ai-chat-sdk:vision",
            "client"
          ],
          "minLevel": "trace",
          "includeSensitive": true,
          "attachments": true
        }]
      }
    }
  },
  "client": {
    "logging": { "forward": { "enabled": true, "minLevel": "info" } }
  }
}
```

One file per day, holding both sides in timestamp order:

| From | Records |
|---|---|
| `client:session` | session started (build, deployment, viewport, agent), slides opened (`tileSourceId`, size, magnification), viewers created/destroyed, auth settled, session ended |
| `client:console` | warnings and errors the participant's browser produced |
| `module.vercel-ai-chat-sdk:transcript` | every chat message once, attachments beside it in `pilot.files/` |
| `module.vercel-ai-chat-sdk:vision` | every region a foundation model reviewed — the prompt, the findings, and **the image itself** in `pilot.files/vision/<date>/` |

### What the model looked at

A `buildOverview` run sends up to 28 off-screen renders to the vision model, and
without `:vision` the session shows its conclusions with no way to see the
pictures they came from. Each `VISION_CALL` line names the slide (`tileSourceId`),
the box (`region`, parent-global level-0 px), how closely it was read
(`deliveredMpp`), the prompt, the findings, and the file holding the pixels. A
montage lists every cell it was assembled from instead of a single box.

Local analyses — the built-in tissue mask, the in-browser segmenter — send
nothing to a server, so there is no image to keep; they appear on `client:session`
as `analysis started` with their region, which is the honest record that nothing
left the browser.

> **Volume.** A field render is up to 2 MP; as PNG that is roughly 1–4 MB, and one
> overview spends up to 28 of them, so a participant who runs a few overviews can
> produce hundreds of MB of images. `attachments: false` on the destination keeps
> every line and drops the pixels; `maxAttachmentBytes` skips the oversized ones
> and says so on the line.

**How to group one participant's sitting.** Every client record carries
`clientSession` (`cs_…`, one per page load, minted in the browser and re-stamped
server-side) and `principal` — a salt-free SHA-256 prefix of the caller identity.
The chat transcript is attributed to the *same* hashed principal, taken from the
chat session's owner. So:

- `clientSession` groups one browser sitting;
- `principal` joins that sitting to the conversations it produced;
- neither is a name. Map the pseudonym to a participant off-system, from your own
  list — that is the whole reason it is hashed.

`client.logging.forward.minLevel: "info"` is what lets the timeline through; the
default is `warn`, which forwards only problems. The `session` channel itself is
on by default (a dozen content-free records per sitting) — set
`client.logging.channels.session: "silent"` to turn it off.

> These files hold the conversation and the slide ids a participant worked on.
> Treat them as pilot data with a retention plan, not as ordinary logs.

## Recipe: keep the chat conversation

The one you want for "log what was said so we can debug it later". Every message
once, its attachments beside it, in local files:

```jsonc
"logging": {
  "channels": { "module.vercel-ai-chat-sdk:transcript": "trace" },
  "allowSensitive": true,
  "redact": { "maxStringLength": 200000 },
  "sinks": {
    "console": "json",
    "stream": [{
      "file": "/var/log/xopat/chat-transcript.ndjson",
      "channels": ["module.vercel-ai-chat-sdk:transcript"],
      "minLevel": "trace",
      "includeSensitive": true,
      "attachments": true
    }]
  }
}
```

You get `chat-transcript.<date>.ndjson` — one line per user message, script
result and assistant reply, in order — plus `chat-transcript.files/<sessionId>/`
holding the images. `maxStringLength` is raised because the default 8000 would
cut exactly the long script results and model replies worth reading; secret-key
redaction is unaffected and not configurable.

Three channels, three different questions — turning one up does not turn the
others up:

| Channel | Answers | Cost |
|---|---|---|
| `…:transcript` | what was said in this session | one record per message |
| `…:llm` | how this turn ran (shapes, counts, model output, verdicts) | O(1) per turn |
| `…:llm:full` | exactly what the model was sent | the whole conversation, per turn |

`…:llm:full` is the one that grows with the square of the session. Reach for it
when a prompt was assembled wrong — a missing system message, a dropped
attachment, cache-breakpoint drift — not to read a conversation.

Attachments can be refused from either end: `tuning.transcriptAttachments: false`
in the chat module's server config stops them being offered at all, and
`attachments: false` on the destination refuses them there. Either way the
message lines still name them.

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
- To send the dump **somewhere else** — a collector, or a path outside the
  storage root — add `sinks.stream` with `includeSensitive: true` and
  `minLevel: "trace"`. Without that flag a stream carries everything *except* the
  payload records, which is usually what you want and never what a conversation
  dump means.
- Secrets are still redacted by key name, and that is not configurable. Raising
  the caps widens *truncation*, never the redaction rule.
- In dev mode `allowSensitive` defaults to `true`, so the channel level alone is
  enough; outside dev it must be explicit.

> Payload records contain whatever the user typed and whatever the model was
> sent. On real data that is PHI: keep this configuration to a debugging
> deployment, and turn `allowSensitive` back off afterwards.

## Client ingest

The browser has its own broker ([`src/LOGGING.md`](../src/LOGGING.md)). With
`client.ingest`, its records are posted to `server/core/ingestClientLogs` and
re-emitted here — so what the user's tab saw reaches the same channels, the same
redaction and the same `sinks.stream` destination as everything the server saw.

```jsonc
"logging": {
  "client": {
    "ingest": true,
    "maxRecordsPerBatch": 200,
    "maxRecordBytes": 32768,
    "maxRecordsPerMinute": 2000
  },
  "channels": { "client": "info", "client:module.chat": "debug" }
}
```

This is the **only inbound path into the logs**, which decides its shape:

- **Off unless an operator turned it on.** Doing nothing leaves it closed.
- **Identity is re-stamped from the verified context.** `principal`, `requestId`,
  `pid` and `source: "client"` come from the server; anything the body claims
  about them is ignored. A client says *what* happened, never who it was (§7).
- **Capped and rate-limited** per batch, per record and per principal — a browser
  must not be able to fill a disk. Over-cap records are dropped whole rather than
  truncated: half a payload record is a misleading artifact.
- **The `sensitive` gate is applied here**, where a client cannot reach it. A
  record flagged `sensitive: true` in a request body is dropped unless the
  operator set `allowSensitive` — otherwise that flag would be a switch for
  logging patient payloads.
- **Channel levels still apply.** Records land under a `client:` prefix, so
  `channels: { "client": "warn" }` turns the whole browser side down without
  touching the server's own channels.

The response reports `accepted` / `dropped` / `oversized` / `throttled`, so a
forwarder that is silently losing records is visible from the client too.

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
