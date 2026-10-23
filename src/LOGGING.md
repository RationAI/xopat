# Client logging

`APPLICATION_CONTEXT.log` is the browser-side counterpart of the server's
`XOPAT_SERVER.log` ([`server/LOGGING.md`](../server/LOGGING.md)). Same model,
same level names, same call convention — so a diagnostic reads the same
wherever it was written:

```ts
const log = APPLICATION_CONTEXT.log("module.my-thing");

log.debug({ tiles: 12 }, "decoded a batch");
log.warn("the slide has no calibration; falling back to pixels");
log.error(someError);

const done = log.time("expensive-work");
// …
done({ items: 42 });                      // emits durationMs
```

**Do not `console.log` in client code.** Console output has no level, no
channel, no bound and no way out of the tab. It still works — `console.*` is
captured into the `console` channel — but a record written that way cannot be
turned down, turned up, or shipped anywhere.

## What this replaced

`server/templates/index.html` patched `console.error` / `console.warn` into an
**unbounded** `window.console.appTrace` array of interleaved strings, read once
by the crash-export page. That hook still exists — errors happen before any
bundle is parsed, and it is the only thing that can see them — but it is now a
*pre-boot* capture that hands over: when the application context is built, the
broker drains it, routes `console.*` into its `console` channel, and replaces
`console.appTrace` with a bounded view over the ring. The export page keeps
reading `console.appTrace` unchanged.

**Adoption never swallows console output.** A `console.log` is an explicit
request to print — from app code and from a developer typing into devtools
alike — so the original method is always called first, with the original
arguments (objects stay expandable in devtools, no `[console]` prefix, no
stringification). The `console` channel level decides only what reaches the ring
and the forwarder; it defaults to `info` so `console.log` lines land in the
crash export. Only `logging.console: false` stops the printing.

## Channels

```
channel ("module.<id>:sub")  ->  LEVEL   (longest-prefix match, else root)
record                       ->  SINKS   (console, bounded ring, forwarder)
```

Conventions, matching the server's:

| Channel | Who writes it |
|---|---|
| `core`, `core.<area>` | the viewer core |
| `session` | the session timeline — boot, slides opened, auth, end |
| `module.<id>`, `plugin.<id>` | a module or plugin (`:sub` for a subsystem) |
| `console` | stray `console.*`, captured |

`log("module.chat").child("llm")` logs on `module.chat:llm`. A level configured
for `module.chat` applies to every channel beneath it unless one of them is
configured explicitly.

## Configuration — `env.client.logging`

```jsonc
"client": {
  "logging": {
    "level": "warn",                       // root level; default warn
    "channels": {
      "module.vercel-ai-chat-sdk": "debug",
      "core.io": "info"
    },
    "console": true,                       // mirror records into the console
    "ring": 2000,                          // records kept in memory
    "maxStringLength": 8000,
    "allowSensitive": false,               // payload records — see below
    "forward": {
      "enabled": true,                     // send records to the server
      "minLevel": "warn",
      "includeSensitive": false,
      "batchSize": 50,
      "intervalMs": 5000,
      "queueLimit": 1000,
      "attachments": false,          // may attachment BYTES be sent
      "maxAttachmentBytes": 4194304, // per file
      "attachmentQueueBytes": 33554432
    }
  }
}
```

**This is deployment configuration, not a user preference.** It is read from
`env.client`, never from `getOption` / `APPLICATION_CONTEXT.config` — those are
session-derived and third-party-controllable (an embedding app, a URL param, an
imported peer session), so a switch that turns on payload logging or aims the
forwarder must not live there (AGENTS.md §7).

Defaults are quiet but useful: warnings and errors, in the console and the ring,
forwarded nowhere. A deployment that never configured this block behaves exactly
as it did before.

## Payload records

`log.sensitive(...)` is for content — prompts, message bodies, script results,
anything carrying what the user typed or what the model was sent:

```ts
log.sensitive("SCRIPT_RESULT", { result });
```

It is emitted only when **both** hold:

1. the deployment set `logging.allowSensitive: true`, and
2. the channel is at `trace`.

Forwarding one to the server needs a *third*, separate opt-in
(`forward.includeSensitive`), because recording a payload in the browser and
sending it across the network are different decisions. On real data these
records are PHI.

## Attachments — records whose payload is bytes

`log.attachment(...)` is the same idea one level further: a record that describes
a file, with the bytes travelling beside it.

```ts
log.attachment({
    file: "logs/sess-42/audio/window-0003.webm",
    bytes: await blob.arrayBuffer(),
    mediaType: blob.type,
    index: 3,
}, "MY_DICTATION_AUDIO");
```

The line lands like any other record — channel, level, `fields.attachment` with
`file` and `size`. The **bytes never enter the ring** (a ring holding every
recorded window would pin the whole session's audio in the tab) and never enter a
log line as base64. They are queued separately, bounded by total bytes, and
shipped one file per request through the same RPC; the server hands them to
`logger.attachment`, so a `sinks.stream` destination with `attachments: true`
writes a real file beside the NDJSON and one without says so on the line.

Attachments are **sensitive by definition**, so they inherit both payload gates
and add a third:

1. `logging.allowSensitive` + the channel at `trace` — the record exists;
2. `forward.includeSensitive` — the record may leave the browser;
3. `forward.attachments` — its **bytes** may leave the browser.

The server has to allow them too (`core.server.logging.client.attachments`,
default off, with its own `maxAttachmentBytes`). When any gate is closed the
descriptor line still lands, carrying `stored: false` and a reason — a record
pointing at a file nobody kept is the answer to "why is there no recording for
this window", and a silent drop deletes the question along with the answer.

A **delivered** file is not a kept one, so the reason comes from the server's
per-record verdict, not from the request succeeding: `attachments.stored: 0`
marks the descriptor `refused` (the deployment does not accept bytes) or
`record-oversized` (the descriptor line itself exceeded `maxRecordBytes`, which
drops the record whole and the payload with it). An attachment's own line is
trimmed to that cap before it ships — the bytes are exempt, the metadata around
them is not — and the `file`/`size`/`mediaType` pointer survives the trim
verbatim, because a truncated path makes the stored bytes unfindable.

A **413** is the one verdict the reply cannot carry: the body reader refuses the
request before the handler that answers `attachments.accepted` ever runs. The
client therefore learns the cap from the rejection itself, tightens
`maxAttachmentBytes` and refuses the rest of the queue locally. Without that, a
deployment whose body limit sits under the client's cap (`client.attachments`
off leaves the 256 kB default against a 4 MB cap) re-encodes and re-uploads every
sealed window for the whole session — patient audio on the wire, repeatedly, for
guaranteed nothing.

## Forwarding

With `forward.enabled`, records are batched and posted to the core RPC
`server/core/ingestClientLogs` through the generated RPC client — which is
`HttpClient`-backed (so it carries session/CSRF and runs in the background
request lane), never a bare `fetch` (AGENTS.md §0.3). The server then treats
them like any other record: channel levels, redaction and every sink apply, so
client records reach the same `sinks.stream` destination as server ones.

The server must also allow it (`core.server.logging.client.ingest`, default
off), and it re-stamps everything identifying — see
[`server/LOGGING.md`](../server/LOGGING.md) → *Client ingest*. A client says
**what** happened; it never says who it was.

Failure handling is deliberate: a batch that cannot be delivered is **dropped**
and counted, never retried. A forwarder that retries turns a server hiccup into
a growing client-side queue, and the records that matter are usually the ones
still arriving.

## The `session` channel — reconstructing a sitting

`classes/app/session-log.ts` puts the shape of a session on the record: boot
(version, deployment, secure mode, viewport, user agent), which slides were
opened (`tileSourceId`, dimensions, magnification), viewers created/destroyed,
auth settling, and the end of the sitting. Wired in `app.ts`, silent unless the
deployment turns the channel on.

It is deliberately **not** an interaction trail — no viewport moves, no mouse, no
per-frame anything. Those are a different question ("how did they navigate"), a
different order of volume, and they need sampling to be affordable; they belong
on their own channel if they are ever wanted.

**How a session is correlated.** Every forwarded batch carries
`APPLICATION_CONTEXT.logging.sessionId` — a `cs_…` token minted at boot, one per
page load. The server writes it onto each record as `clientSession`, next to the
hashed `principal` it derives itself. The chat transcript is attributed to the
same hashed principal (from the chat session's owner), so a file holding both
answers "what did this participant do, and what did they ask" without either side
ever writing down who they are. Matching a pseudonym to a person is done
off-system, against your own participant list.

## Reading logs in the browser

```js
APPLICATION_CONTEXT.logging.getEntries({ minLevel: "warn", limit: 100 });
APPLICATION_CONTEXT.logging.getEntries({ channel: "module.chat", search: "timeout" });
APPLICATION_CONTEXT.logging.stats();     // levels, ring occupancy, forward counters
await APPLICATION_CONTEXT.logging.flush();
```

`stats().counters` is where a silently-failing forwarder shows up
(`forwardDropped`, `forwardFailures`), and `ring.dropped` says how much the
buffer has aged out.

## Rules

- **Never `console.log` for app diagnostics** — take a channel.
- **Never invent a per-feature debug flag.** A channel at `trace` is the
  mechanism; a `debugMode`-gated `console.log` is not, and cannot be turned on
  for one subsystem in a running deployment.
- **Bytes go through `attachment()`**, never base64 inside a record. Three
  opt-ins, on both ends, and the line still says when they were refused.
- **Read the caps on BOTH ends when content matters.** A transcript survives the
  client's `maxStringLength`, then `forward.maxRecordBytes` (the client trims to what
  the server will store), then the server's `client.maxRecordBytes` and its
  `redact.maxStringLength`. The smallest wins, and the default server string cap is
  8000 — enough to make a forwarded transcript look mysteriously clipped.
- **Payloads go through `sensitive()`**, and are never pre-scrubbed or
  pre-stringified at the call site — capping and redaction are the broker's job,
  and a call site that must remember to scrub eventually forgets.
- **A logging call must never throw.** Nothing here does; keep it that way when
  extending it.
