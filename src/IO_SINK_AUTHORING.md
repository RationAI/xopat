# Writing an IO sink

How to make xOpat persist to *your* platform — a LIMS, a submission store, a
repository, an internal REST API — without forking anything.

A **sink** is the destination end of the [IO pipeline](IO_PIPELINE.md). Owners
(plugins, modules, core) declare *capabilities* — "I have a bundle to export", "I
have annotations to CRUD" — and an operator *binds* those capabilities to sinks.
Neither side knows the other exists. That is the whole point: you write one
object, an operator writes one config block, and every feature that already
speaks the pipeline persists to you.

Three in-tree integrations are built exactly this way, and are the best
reference material after this page:

| Integration | Shape | Read it for |
| --- | --- | --- |
| [`modules/io-github-sink`](../modules/io-github-sink/) | bundle → a git repository | option layering, path templates, an operator-facing README |
| [`modules/io-mlflow-sink`](../modules/io-mlflow-sink/) | bundle + crud → experiment tracking | binary payloads, run/artifact mapping |
| [`modules/empaia-workbench`](../modules/empaia-workbench/) | crud + bundle → an embedding host | readiness, retry policy, `claimBinding` |
| [`src/classes/io/sinks/http-rest.ts`](classes/io/sinks/http-rest.ts) | the minimal one, 129 lines | the smallest complete sink |

---

## 0. What a sink is NOT responsible for

Read this before anything else, because getting it wrong is how integrations
grow a second, weaker copy of the platform's own rules.

**Authorization is not yours.** Do not check groups, roles, or user identity in
a sink. The pipeline runs a veto phase — `pre-export`, `pre-import`, `pre-read`,
`pre-create`, `pre-update`, `pre-delete` — *before* any sink is contacted, and
the rights layer mounts a gate on every one of them from the owner's declared
capabilities (see [`USER_ROLES.md`](USER_ROLES.md)). An operator denying
`annotations.bundle-export` to a role means your `writeBundle` is never called at
all. A per-sink permission check would be a second policy that config cannot see
and cannot override.

**Transport auth is not yours either.** Credentials belong server-side, behind an
`HttpClient` proxy alias (§4). A sink holding a token means the token is in the
browser.

**Retry policy is not yours to hand-roll.** `IO_PIPELINE.withRetry` exists (§6).

What *is* yours: knowing your platform's shape, refusing clearly when you cannot
serve a request, and round-tripping payloads byte-for-byte.

---

## 1. The contract

```ts
interface IOSink {
    id: string;
    label?: string;
    supports: IOCapabilityKind[] | IOSinkSupport;
    accepts?(ctx: IOContext): boolean | IOAcceptDecision;

    writeBundle?(ctx, payload): Promise<IOResult> | IOResult;
    readBundle?(ctx): Promise<IOResult> | IOResult;

    create?(ctx, item): Promise<IOResult> | IOResult;
    read?(ctx): Promise<IOResult> | IOResult;
    update?(ctx, patch): Promise<IOResult> | IOResult;
    delete?(ctx): Promise<IOResult> | IOResult;
    query?(ctx, params): AsyncIterable<unknown>;
}
```

Only `id` and `supports` are required — implement the methods your kinds need.
Full types in [`src/types/io.d.ts`](types/io.d.ts).

Every method returns an `IOResult`: `{ok: true, payload?}` or
`{ok: false, refused: true, reason, userMessage?, code?}`. `reason` is logged;
`userMessage` is what the user sees. Throwing is allowed — the pipeline converts
it to a `W_IO_*_THREW` refusal — but returning a refusal with a `userMessage`
is strictly better information.

A minimal sink:

```ts
IO_PIPELINE.registerSink({
    id: "acme-lims",
    label: "ACME LIMS",
    supports: { kinds: ["bundle"], owners: ["questionaire"] },
    async writeBundle(ctx, payload) {
        const client = new HttpClient({ proxy: "acme" });
        await client.request("submissions", { method: "POST", body: { payload } });
        return { ok: true };
    },
});
```

## 2. Declare what you serve — do not test for it

`supports` is read at **binding-resolution time**, before any data is at risk, so
a binding your sink cannot honour is reported at boot as `io:invalid-binding`.
An equivalent `accepts` check only fires at dispatch, and a dispatch every bound
sink declines is a data-loss event.

```ts
supports: { kinds: ["crud", "bundle"], owners: ["annotations"], resources: ["annotation"] }
```

Fields are anchored globs (`*` matches any run of characters); an absent field
means "any". Prefer this over `accepts: ctx => ctx.ownerId === "annotations"`.

## 3. Say when you are not ready

Use `accepts` for what is only knowable at runtime — a session not yet resolved,
a repository not yet selected. Return a **decision, not a bare `false`**, so the
reason reaches the user instead of "no sink accepted export":

```ts
accepts(ctx) {
    if (this.sessionId) return true;
    return {
        accept: false,
        reason: "no ACME session bound yet",
        userMessage: $.t("acme.notConnected"),
    };
}
```

**If your upstream refused rather than your sink being unready, say `policy`.**

```ts
return { accept: false, reason: "ACME rejected: not a member of this project", policy: true };
```

That flag suppresses the pipeline's last-resort local download for this
dispatch. Without it, "you may not write here" produced a `file-download` of
exactly the same bytes and the refusal was decorative. Leave it off when the
decline is about *shape* ("this sink only stores DICOM SR") — there the local
copy is the correct rescue for a misconfigured binding.

This is **not** a licence to implement permission checks (see §0): it is how a
sink reports a refusal that came from somewhere else. The deployment's own
policy belongs in the role config, where the guard layer applies it ahead of
every destination at once.

## 4. Reaching your platform

**Never `fetch` from a sink.** Use `globalThis.HttpClient`: it carries the JWT
and CSRF tokens, resolves proxy aliases, and honours `secureMode` policy.

The credential lives **server-side**, in
`core.server.secure.proxies.<alias>.headers`, expanded from an environment
variable. The browser never sees it:

```jsonc
// deployment ENV
"server": { "secure": { "proxies": {
    "acme": {
        "baseUrl": "https://lims.acme.example/api/v1/",
        "headers": { "Authorization": "Bearer <% ACME_TOKEN %>" }
    }
}}}
```

```ts
// in the sink — no baseURL: full paths are joined by the server proxy
new HttpClient({ proxy: "acme", auth: { contextId: "core", required: true } });
```

See [`HTTP_CLIENT.md`](HTTP_CLIENT.md). For a *user's own* credential rather than
a deployment one, take it from the auth broker
(`APPLICATION_CONTEXT.auth.getSecretTypes(contextId)`), never from a hardcoded
type — [`AUTH.md`](AUTH.md).

## 5. Configuration, in four layers

The pipeline never composes options for you — it exposes two slots and your
module merges them. Both carry server-delivered trust, so `baseURL`, `proxy`,
`auth` and target selection legitimately live there.

```ts
function getOptions(ctx) {
    return {
        ...HARDCODED_DEFAULTS,
        ...(moduleMeta("io-acme-sink", "sink") ?? {}),          // include.json
        ...(IO_PIPELINE.sinkOverrides("acme-lims") ?? {}),       // ENV.client.io.sinkOverrides
        ...(IO_PIPELINE.bindingConfig(ctx.ownerUid, ctx.capabilityId, "acme-lims") ?? {}),
    };
}
```

The last layer is what lets one sink id serve several destinations — an operator
gives each binding its own `config`:

```jsonc
"io": { "bindings": {
    "annotations":  { "bundle-export": [{ "sink": "acme-lims", "config": { "project": "path-1" } }] },
    "questionaire": { "bundle-submit": [{ "sink": "acme-lims", "config": { "project": "forms" } }] }
}}
```

Build storage paths with `IO_PIPELINE.formatPath` rather than string
concatenation: the template is trusted, the substituted values are not, and it
reduces each to one safe segment.

## 6. Failure, retry, and refusing well

Wrap yourself once at registration — do not retry inside your methods:

```ts
const PERMANENT = new Set(["W_PERM_DENIED", "W_IO_VALIDATION", "404", "409"]);
IO_PIPELINE.registerSink(
    IO_PIPELINE.withRetry
        ? IO_PIPELINE.withRetry(sink, {
              attempts: 3,
              retryOn: r => !r.ok && !PERMANENT.has(String(r.code ?? "")),
          })
        : sink,
);
```

Feature-test `withRetry` — it is typed optional on the pipeline. Note it passes
`query` through unwrapped, because retrying a stream would re-yield items.

Retry only what a retry can fix. A 4xx is the upstream saying no; repeating it
just delays the refusal and, for a create, risks duplicates. If your platform
supports idempotency keys, `ctx.meta.clientOpId` is stable across attempts.

## 7. The round-trip contract

Whatever `writeBundle` was given, `readBundle` must return **unchanged**. Owners
serialize their own state and many hand you an opaque string; parsing it,
re-shaping it, or pretty-printing it corrupts a payload you do not own. If you
must store structure, store your envelope *around* the payload and unwrap it on
the way back.

Bytes rather than JSON? Return an `IOBinaryPayload`
(`{bytes, contentType, fileExt}`) — sinks that can store blobs natively do so
without a base64 round-trip, and sinks that cannot are free to refuse.

An empty read is a success (`{ok: true}` with no payload), not a failure: it
means the destination worked and had nothing stored yet.

## 8. Getting bound

Two ways, and the operator always keeps the last word.

**Operator binding** (the normal case) — they add your sink to
`ENV.client.io.bindings`. Document the exact block in your module's README.

**`claimBinding`** — when your module *is* the backend of the session it created
(an embedding host), requiring a config line means one forgotten line leaves the
feature silently inert rather than degraded:

```ts
IO_PIPELINE.claimBinding("annotations", "crud:annotation", ["acme-lims"], this.uid);
```

A claim is precedence rule 2.5: it fills a hole, an explicit operator binding
still overrides it, and `disabledCapabilities` still silences it.

## 9. Checklist

- [ ] `supports` is declarative, and matches what you actually implement.
- [ ] `accepts` returns `{accept: false, reason, userMessage}`, never bare `false`.
- [ ] No `fetch`; `HttpClient` with a proxy alias, credential server-side.
- [ ] No permission checks — the pipeline gates before you are called.
- [ ] Options merged defaults → include.json → `sinkOverrides` → `bindingConfig`.
- [ ] Wrapped in `withRetry` with permanent codes excluded.
- [ ] Payload round-trips byte-for-byte; empty read is a success.
- [ ] README documents the exact `io.bindings` block an operator must write.
- [ ] Paths built with `IO_PIPELINE.formatPath`.

## See also

- [`IO_PIPELINE.md`](IO_PIPELINE.md) — capabilities, bindings, guards, outbox
- [`USER_ROLES.md`](USER_ROLES.md) — why authorization is not the sink's job
- [`HTTP_CLIENT.md`](HTTP_CLIENT.md) — proxies, auth contexts, streaming
- [`../modules/README.md`](../modules/README.md) — packaging a module
