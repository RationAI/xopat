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
      "queueLimit": 1000
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
- **Payloads go through `sensitive()`**, and are never pre-scrubbed or
  pre-stringified at the call site — capping and redaction are the broker's job,
  and a call site that must remember to scrub eventually forgets.
- **A logging call must never throw.** Nothing here does; keep it that way when
  extending it.
