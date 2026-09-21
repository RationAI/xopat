# User roles & capabilities

A lightweight, **client-side** authorization layer for xOpat. Plugins and modules declare *capabilities* (named gates they want to be opt-in togglable), the deployment defines *roles* that grant or deny those capabilities, and a *rights-resolver* plugin decides which roles the current user has.

> **This is UI gating, not authorization.** The viewer is meant to be embedded in a larger system that performs real authorization. The browser holds the role state, the client decides which buttons render, and the embedding backend remains the single source of truth for whether an operation is allowed. Anything sent over the wire to a server should be verified by that server independently of what the client claims.

The full API lives on `window.XOpatUser` (the existing identity singleton — no new global). Pure logic — capability registry, role resolution algorithm — lives in `src/classes/user-roles-core.ts` and is intentionally side-effect-free so the same code can be reused server-side if a deployment ever wants opt-in RPC enforcement.

---

## Mental model

```
  ┌───────────────────────┐    ┌──────────────────────┐
  │  Plugins / modules    │    │  Deployment env      │
  │                       │    │                      │
  │  capabilities[]       │    │  core.roles: {       │
  │  io.capabilities[]    │    │    default: [...],   │
  │                       │    │    definitions: {…}  │
  └──────────┬────────────┘    │  }                   │
             │                 └──────────┬───────────┘
             ▼                            ▼
       capability registry         role catalog
             └───────────┬───────────────┘
                         ▼
                ┌──────────────────────┐
                │  XOpatUser           │   ◄── resolved per current
                │  • currentRoles()    │       assigned roles
                │  • can(capId)        │
                └────────┬─────────────┘
                         │
                ┌────────┴─────────┐
       events: roles-changed   capabilities-changed
```

Three pillars:

1. **Capability** — a named gate, e.g. `annotations.crud:annotation.delete`. Declared by the plugin/module that exposes the action, with a default (`allow` or `deny`).
2. **Role** — a deployment-defined set of capability grants and denies, optionally inheriting from other roles. Lives entirely in env config.
3. **Assignment** — the list of roles currently in effect for the user. Bootstrapped from `core.roles.default`; can be replaced at runtime by any rights-resolver plugin (see below).

---

## Authoring side: declaring capabilities

There are two sources of rights-capabilities for any owner.

### Explicit, via top-level `capabilities[]` in `include.json`

For gates that aren't tied to a typed IO resource — UI affordances, side panels, custom actions.

```jsonc
{
  "id": "annotations",
  "capabilities": [
    { "id": "annotations.ui.toolbar",       "default": "allow", "label": "Show annotations toolbar" },
    { "id": "annotations.export-as-svg",    "default": "deny",  "label": "Export annotations as SVG" }
  ]
}
```

Rules:

- The `id` **must** start with the owner's `id` followed by `.` or `:`. A malformed entry is dropped with a `console.error` — and a dropped declaration is not harmless: `can()` answers `true` for ids it never saw (so role config naming another deployment's capability cannot lock the UI), which means every `this.can("<id>")` guarding that feature becomes permanently open and no role config can close it.
- `default` is either `"allow"` or `"deny"`. It is required by the registry, but `include.json` entries that omit it are defaulted to `"allow"` before they reach it (`loader.ts`), so in practice only programmatic `declareCapability` calls can trip this check.
- `label` / `description` are optional and will surface in any future admin UI; they do not affect behaviour.

### Auto-derived from `io.capabilities[]`

For every IO capability the owner already declares (see [`IO_PIPELINE.md`](IO_PIPELINE.md)), the rights system **automatically** registers matching rights-capabilities **and** installs a pre-CRUD guard so refusals never reach the owner's `validate` or `apply`. **No extra config is required** — adopting authorization for IO-mediated actions is opt-out, not opt-in.

Derivation table:

| IO capability declaration                                       | Auto-derived rights-capability IDs                                                                         | Default | Guard?                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ id: "crud:annotation", kind: "crud" }` on owner `annotations` | `annotations.crud:annotation.create`, `.read`, `.update`, `.delete`                                       | `allow` | One `pre-create` / `pre-read` / `pre-update` / `pre-delete` guard each, registered with `priority: 10000` so the role check wins over **any other guard** — a domain guard cannot mask a denial with its own message. (Note the owner's `def.validate` still runs first of all, ahead of the whole guard phase; keep validators permissive if you care about which message a denied user sees.) |
| `{ id: "bundle-export", kind: "bundle" }`                       | `annotations.bundle-export`                                                                                | `allow` | A `pre-export` guard, `resource: "*"` (bundle contexts carry no `resourceName`). It runs before the owner's `exportBundle` hook is called at all, so a denied export never produces a payload — and never reaches the `file-download` fallback either.                       |
| `{ id: "bundle-import", kind: "bundle" }`                       | `annotations.bundle-import`                                                                                | `allow` | A `pre-import` guard, same shape. Covers both a sink restore and a payload the user supplied by hand.                                                                                                                                                                        |
| any other `bundle-*` (e.g. `bundle-submit`)                     | `<owner>.<capability-id>`                                                                                  | `allow` | Same rule: `pre-import` when the id contains `import`, `pre-export` otherwise.                                                                                                                                                                                               |
| `{ id: "kv:cache", kind: "kv" }` (and other `kv:*`)             | — none —                                                                                                   | —       | KV is transparent infrastructure; silently denying it would break the app. **Not auto-derived.** Plugins that genuinely want to gate kv access can declare an explicit capability and call `XOpatUser.instance().can(...)` themselves.                                       |

> **This is why sinks contain no authorization code.** Every gate is mounted in
> the pipeline, ahead of every destination. An operator denying
> `annotations.bundle-export` stops the payload reaching github, mlflow, an
> embedding host and a local file alike — without any of them being changed, or
> even knowing a rule exists. A permission check written inside a sink would be a
> second policy that config can neither see nor override; don't write one.

Opt-out or customize per IO capability with the `rights` field:

```jsonc
{ "id": "crud:annotation", "kind": "crud", "rights": false }   // skip entirely

{ "id": "crud:annotation", "kind": "crud",
  "rights": {
    "default":    "deny",               // override the allow default
    "directions": ["create", "delete"], // only derive these (skip update / read)
    "label":      "Annotation write"    // label propagated to all derived caps
  }
}
```

---

## Deployment side: defining roles

Roles live entirely in env config (e.g. `env/env.default.json`) under `core.roles`. Plugins ship no role defaults — operators retain full control.

```jsonc
{
  "core": {
    "roles": {
      "default": ["viewer"],
      "definitions": {
        "viewer": {
          "label": "Read-only viewer",
          "extends": [],
          "deny":  ["annotations.crud:annotation.*"],
          "grant": []
        },
        "editor": {
          "extends": ["viewer"],
          "grant":   ["annotations.crud:annotation.create",
                      "annotations.crud:annotation.update",
                      "annotations.crud:annotation.delete"]
        },
        "admin": {
          "extends": ["editor"],
          "grant":   ["*"]
        }
      }
    }
  }
}
```

- `default` — applied automatically at boot and whenever the user logs out / `clearRoles()` is called.
- `extends` — parent role ids, resolved depth-first with cycles broken. Parents apply *before* children, so a child's grant overrides a parent's deny.
- `grant` / `deny` — capability ids or wildcard patterns:
  - `annotations.*` matches any cap starting with `annotations.`
  - `*.delete` matches any cap ending with `.delete`
  - `*` matches every cap.
- Order matters: deny first, then grant within a single role; later roles override earlier ones in the assignment array. There is no "deny wins" magic — operators get a CSS-cascade-style layer model.

Unknown capability ids in role config are logged at `console.debug` and ignored (the referenced plugin may not be installed in this deployment).

---

## Assigning roles from the identity provider

Add a `claims` block to `core.roles` and core does the rest — no plugin, no code.
It subscribes to login and credential updates for the named context, reads the
claim out of the token, maps its values to role ids, and calls `assignRoles`.

```jsonc
"roles": {
  "default": ["guest"],
  "claims": {
    "claim": "groups",          // claim carrying the group list. Default "roles".
    "contextId": "core",        // whose token to read. Default "core".
    "map": {                    // IdP group name → xOpat role ids
      "pathologists": ["pathologist"],
      "researchers":  ["researcher"],
      "admins":       ["researcher", "admin"]
    },
    "unmapped": "ignore",       // or "passthrough": use the value as a role id
    "fallback": []              // roles when the claim is absent or maps to nothing
  },
  "definitions": { /* … */ }
}
```

Broker-agnostic: the same block works under SAML, OIDC, or anything else that
mints a token, because it reads the claim rather than the provider. Tolerant of
the shapes real IdPs emit — a string, an array of strings, or one
space-separated string. A group `map` does not mention grants **nothing** by
default; a malformed token yields the fallback rather than an exception on the
login path.

`test/env/saml.json` is a complete worked example, and
`test/fixtures/keycloak/` is an identity provider you can run in one command to
try it. `test/suites/e2e/saml-roles.test.mjs` asserts the whole chain.

> **Security note.** The client decodes the token payload **without verifying the
> signature**. That is sound here and only here: these roles gate UI, and the
> browser's role state was never authoritative (see the note at the top). The
> same token is verified independently server-side by the `saml` / `oidc` proxy
> and RPC verifiers before it authorizes anything, so forging a claim buys a user
> some buttons, not access.

### Doing it yourself instead

If a deployment needs logic a mapping table cannot express, any plugin or module
can decide roles — there is no registration ceremony. Listen to whatever signal
you care about and call `assignRoles()`:

```ts
const user = XOpatUser.instance();
user.addHandler('login', async () => {
    user.assignRoles(await myBackend.rolesFor(user.id));
});
```

Two resolvers assigning independently is "last call wins" — a deployment
misconfiguration, not a system behaviour to rely on. Pick one.

Precedence summary:

| Situation                                                       | Effective roles                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Page load, no `core.roles.default`, no resolver                 | `[]` — every capability falls back to its declared default.                           |
| Page load, `core.roles.default = ["viewer"]`, no resolver       | `["viewer"]` — deployment default applies.                                            |
| Page load → login fires → `claims` maps the token to `["editor"]` | `["editor"]` (the claim mapping overrides).                                          |
| Login fires but neither `claims` nor a resolver is configured    | Deployment default still stands.                                                      |
| `logout` fires                                                   | Reverts to `core.roles.default`.                                                      |
| Resolver calls `clearRoles()`                                   | Reverts to `core.roles.default`.                                                      |

Two resolvers calling `assignRoles` independently → "last call wins". That's a deployment misconfiguration, not a system bug; pick one resolver per deployment.

Note `assignRoles` short-circuits when the result is unchanged, so a token
refresh re-running the mapping costs nothing and raises no events.

---

## Consuming side: checking capabilities

### From plugin / module code

Every `XOpatPlugin` / `XOpatModule` inherits two sugar methods on top of the base API:

```ts
// One-shot check
if (this.can('annotations.export-as-svg')) {
    showSvgExportButton();
}

// Reactive subscription — handler fires with current value immediately,
// and again whenever the effective value changes. Returns a disposer.
const dispose = this.onCapabilityChange('annotations.crud:annotation.delete', enabled => {
    deleteBtn.classList.toggle('hidden', !enabled);
});
```

Unknown capability ids default to **allow** — declaring a capability is the opt-in; not declaring it should never accidentally lock the UI.

### From any code (the singleton API)

```ts
const user = XOpatUser.instance();

user.can('annotations.crud:annotation.delete');
user.cannot('annotations.crud:annotation.delete');
user.currentRoles();

user.assignRoles(['editor']);
user.addRole('admin');
user.removeRole('editor');
user.clearRoles();

XOpatUser.declareCapability({ id: 'mine.gate', default: 'allow', declaredBy: 'mine' });
XOpatUser.listCapabilities();
XOpatUser.describeCapability('mine.gate');
XOpatUser.listRoles();
XOpatUser.describeRole('editor');
```

Events on `XOpatUser.instance()`:

| Event                   | Payload                                                | Fires when                                                                  |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `roles-changed`         | `{ roles: string[], previous: string[] }`              | `assignRoles` / `addRole` / `removeRole` / `clearRoles` produced a diff.    |
| `capabilities-changed`  | `{ changed: string[] }`                                | The effective `can()` answer flipped for at least one capability.           |
| `capability-declared`   | `{ id, declaredBy }`                                   | A plugin / module registered a new capability (typically at load time).    |

---

## IO pipeline integration in detail

When the loader sees an `io.capabilities[]` entry that doesn't opt out via `rights: false`, it:

1. Declares the matching rights-capability/-capabilities on `XOpatUser` (default `"allow"` unless overridden).
2. Registers an `IO_PIPELINE.registerGuard` per pre-phase, with `priority: 10000` and `ownerId: "rights:<owner>"`. The handler refuses synchronously with `{ code: "W_PERM_DENIED", userMessage: $.t('user.roles.refused', ...) }` when the user lacks the capability.

The priority is intentionally above the typical user-registered guard range, so the role check short-circuits *before* domain validation runs. A denied user sees the role-refusal toast, never a misleading "validation failed".

The six phases and where the pipeline runs them:

| Phase | Runs before | Guard `resource` |
| --- | --- | --- |
| `pre-create` / `pre-update` / `pre-delete` | the owner's local commit, in `IOResource` | the resource name |
| `pre-read` | any sink `read`, in `dispatch`; and `queryStream` | the resource name |
| `pre-export` | the owner's `exportBundle` hook | `"*"` |
| `pre-import` | the owner's `importBundle` hook, on both the sink-restore and user-supplied paths | `"*"` |

Two details that matter:

- **Bundle contexts carry no `resourceName`**, so only a `resource: "*"` guard
  can match them. That is what the rights layer registers.
- **`direction: "*"` still means CRUD writes only.** It predates these phases;
  widening it would turn every existing domain guard into a veto over exports
  and reads it was never written to judge. Name the new phases explicitly.

A refused `pre-read` yields an **empty stream** rather than a throw: every caller
is a hydration `for await` that treats "nothing" as a valid answer, and the
refusal has already been surfaced. A `W_PERM_DENIED` refusal is toasted **once**
per (roles, owner, capability, direction, route): the verdict is deterministic,
so a denied read on a panel that re-queries on every pan would otherwise be a
stream of identical dialogs. A role change re-arms it.

### A refusal says what it refused

`user.roles.refused` names the capability:
*"You do not have permission to perform this action. (Run scripts)"*. Every
refusal site already passed the id into the interpolation; the string used to
drop it, which made a closed gate undiagnosable from the symptom — the message
was identical whichever of the four sites produced it.

Resolve the name through **`XOpatUser.capabilityLabel(id)`**, never
`describeCapability(id)?.label`, in a message or a UI:

```
"Annotation — delete"          label + direction (CRUD-derived)
"Run scripts"                  label alone
"annotations.bundle-export"    the id, when nobody declared a label
```

The direction matters because one `io.capabilities` entry derives **four**
capabilities that all inherit its single label — `"Annotation"` names the read
gate and the delete gate equally badly. `CapabilityDescriptor.direction` carries
it as data so the label is composed and translated at render, not baked in
during element load.

### The `deny: ["*"]` + `extends` trap

Roles flatten **parents first** (`flattenRoles`), and deny-then-grant applies
*within* a role, not across roles. So a base role with `deny: ["*"]` reaches
every descendant, and **a capability declared later is denied for every role
until it is re-granted**.

That is not hypothetical. In `env/parts/roles/dev-all.json`, `pathologist`
extends a `deny: ["*"]` guest and re-granted three of the four core
capabilities; the missing `core.scripting.run` silently killed the entire LLM
workflow, because `ScriptingManager.executeScript` gates on it before running a
line. Deny-by-default is still the right posture — pair it with the labelled
message above, so the next omission announces itself.

### Who asked? (`ctx.trigger`)

**A refusal for work the user did not request is an event, not a dialog.** Four
owners hydrate at boot; under a restrictive role that used to mean four
"You do not have permission…" dialogs before the user had touched anything —
reporting failures they did not cause and could not act on.

Every dispatch therefore carries `ctx.trigger`:

| value | meaning | on refusal |
| --- | --- | --- |
| `"user"` (**default**) | a gesture, a menu action, a file the user picked | `io:refused` **+ the notifier** (a dialog) |
| `"system"` | the pipeline's own bookkeeping | `io:refused` + a `core.io` log line |

**Loud by default, deliberately.** A call site that forgets to declare itself
over-warns — annoying, noticed, fixed. A default of silence would let a real
refusal disappear, which nobody notices at all.

Exactly four call sites are automatic, and each says so at the site:
`initIO`'s per-element restore and `forceDataImportInitialization` (both
`src/loader.ts`), and the post-open restore plus the vacated-slide flush
(`src/classes/app/viewer-open-pipeline.ts`). Everything else — CRUD writes, a
user-picked `importBundle`, `UTILITIES.export` / `save`, `this.io.flush()` —
keeps interrupting, as it should.

Silencing must not lose the fact, so a `"system"` refusal is logged through
`APPLICATION_CONTEXT.log("core.io").warn(...)`, and the `flushBundleExport`
policy skip logs too — its user-driven counterpart is reported by the
aggregating caller, but an automatic flush has none (`viewer-open-pipeline`
discards the results).

What replaces the dialogs as the user's explanation is the **Roles panel**: an
always-visible "Not available to you" list, grouped by feature. See *UI surface*
below.

---

## Two routes

Every bundle dispatch carries `ctx.route`, and the two values are **separate
questions with separate answers**:

| Route | What it is | Who decides |
| --- | --- | --- |
| `"sink"` (default) | a bound destination from `ENV.client.io.bindings` — `post-data`, `session-memory`, a remote store | the owner's own capability (`annotations.bundle-export`, …) |
| `"local"` | the local-file escape hatch: the `file-download` last resort, the `file-upload` sink, `IO_PIPELINE.importBundle` with a user-picked payload | the single core capability `core.io.local-file` |

Why the split exists: one capability checked *before a destination was chosen*
could not express either of the two things operators actually want to say.

```jsonc
"researcher": { "deny": ["annotations.bundle-export"] }
//   -> bound sinks blocked (post-data included, so out of export.html)
//   -> the user can still download their own copy

"kiosk": { "deny": ["core.io.local-file", "core.export.file", "core.export.url"] }
//   -> nothing leaves the browser, whichever plugins are loaded
```

A sink declares what it *is* with `IOSink.route`; that wins over the batch's
route, so binding `file-download` explicitly does not launder a
`core.io.local-file` denial.

> **Migration.** This deliberately *weakens* the shipped `researcher` role in
> `env/parts/roles/guest-pathologist-researcher.json`: a researcher that
> previously could not obtain annotations at all can now download a local copy.
> A deployment that meant "no exfiltration" must add `core.io.local-file` to its
> deny list.

### The fallback, and what may suppress it

The last-resort `file-download` runs when nothing was stored, the local route is
open, and **no sink refused on policy grounds**. That last clause is the fix for
a real bypass: the condition used to key off how many sinks were *bound* rather
than how many actually ran, so a sink answering "you may not write here" handed
the user the full payload as a download and the refusal meant nothing.

A sink signals the difference from `accepts()`:

```js
accepts: (ctx) => ({ accept: false, reason: "upstream refused: not your project", policy: true })
//                                                                      ^ suppresses the local rescue
accepts: (ctx) => ({ accept: false, reason: "this sink only stores DICOM SR" })
//                                          shape mismatch — the local copy is the right rescue
```

A bare `accepts: false` counts as a shape decline, so a sink cannot suppress the
rescue by accident. Note this is **not** a licence to put authorization in a
sink (`src/IO_SINK_AUTHORING.md` §0) — it is for sinks whose *upstream* refused.

---

## Core capabilities

Core has no `include.json`, so the actions it performs itself are declared in
`src/classes/app/core-capabilities.ts`. All default `allow`; all are inert until
a role names them.

| id | choke point |
| --- | --- |
| `core.io.local-file` | the `route: "local"` guard, mounted on `pre-export` / `pre-import` |
| `core.export.file` | `UTILITIES.export()` — the `export.html` session document |
| `core.export.url` | `copyUrlToClipboard()` and `syncSessionToUrl()` |
| `core.scripting.run` | `ScriptingManager.executeScript` — any script text, whoever authored it |

Deliberately **not** added: `core.slide.download`. `plugins/slide-info` already
declares `slide-info.download-slide`; a second id for the same action is two
gates an operator has to keep in sync.

**Out of scope, stated rather than discovered:**

- **The AI stack is ungated.** `modules/vercel-ai-chat-sdk`,
  `modules/pathology-foundation` and every `chat-*` plugin declare **no**
  capabilities, so `can()` answers `true` for any id naming them and a role
  config cannot touch them. `core.scripting.run` is the only thing between a
  role and the assistant. That covers the security-relevant half — the assistant
  reaches the viewer only through a script, so it cannot *change* anything
  without it — but leaves "this role may not use the AI at all" inexpressible,
  and with it any per-role control over LLM spend. Closing it means declaring
  something like `chat.use` on the SDK module and gating the panel on it.
  Deferred, not overlooked.
- `kv:*` is never gated (`loader.ts` skips it; `io-kv-handle.ts` has no guard
  path). It is transparent infrastructure — `AppCache`, `AppCookies`,
  `this.data` — and denying it would break the app rather than restrict it. Note
  that `kv:data` reaches `export.html` through the `post-data` driver, so
  `core.export.file` is what covers that document as a whole.
- The scene itself (`serializeAppConfig` — viz, viewports, background
  references) is config rather than payload and carries no capability. The two
  ways it leaves the app, the file and the URL, are gated above.

---

## UI surface

Today the AppBar's right-side user tab title is rendered as `${name} · ${roleLabels.join(", ")}` when at least one role is assigned (see `ui/services/appBar.mjs`). The component subscribes to `roles-changed` so the title stays in sync without a page reload.

The **Roles** row in that user tab (`src/classes/app/auth-user-menu.ts`) opens
`ui/classes/components/userRolesPanel.mjs` in a modal. For a normal user it is
the read-only chip list plus, when anything is denied, a **"Not available to
you"** section grouping the denied capabilities by the feature that declared
them. That section is what makes restriction discoverable now that automatic
refusals no longer announce themselves; it renders nothing at all when nothing
is denied, which is the common case. In developer mode
(`APPLICATION_CONTEXT.getOption("debugMode")`) it adds two things:

- a **role switcher** — one checkbox per role in `core.roles.definitions`, plus
  reset-to-default. This is how a deployment's role config is exercised without
  an identity provider in the loop (`npm run up:dev -- roles-dev`). It is not an
  authorization boundary — client roles gate UI, never access — so it costs
  nothing a devtools console could not already do; it is hidden in production
  because a "change my role" control invites exactly that misreading.
- the **effective permission table** — every declared capability, its verdict,
  and the role *and pattern* that decided it, from
  `XOpatUser.instance().explainCapabilities()`. Ids nobody declared are absent
  by construction: `can()` answers `true` for those, and listing them as
  "allowed" would imply a gate that does not exist.

---

## Server-side enforcement

The browser decodes the JWT **without verifying the signature**, so a client
role is UI gating and nothing else. The server holds the same token already
verified (`normalizePrincipalUser` parks the whole claim set on
`ctx.user.claims`), so the same rules resolved there *are* an access decision.

`server/node/roles.js` does that. It does **not** reimplement the cascade: it
transforms `src/classes/user-roles-core.ts` (dependency-free precisely for this)
to CommonJS in memory and calls into it, with
`test/suites/unit/server-roles-parity.test.mjs` pinning that the two sides agree.

Declare the gate on the method policy:

```js
export const policy = {
    deleteEverything: {
        auth: { public: false, requireSession: true },
        capabilities: ["myPlugin.crud:thing.delete"],
        capabilitiesMode: "all",     // or "any"; default "all"
    },
};
```

Enforced in `server-runtime.js` after authentication (a capability is a
statement about a *known* caller, and answering "forbidden" to an anonymous
request would enumerate methods) and before the concurrency gate, so a refused
call costs no slot. Refusal is `403 RPC_CAP_DENIED`.

For decisions that depend on the *record* rather than the method, use
`XOPAT_SERVER.resolveRoles(ctx)` / `XOPAT_SERVER.can(ctx, id)` inside the
handler.

**Two deliberate asymmetries with the client:**

1. **Fail closed on identity.** A method that declares capabilities and receives
   no verified identity is refused. A method that declares nothing is untouched
   — which is what makes this safe to add to a running deployment.
2. **No capability registry.** Declarations live in `include.json` and are
   loaded by the browser. The server judges the id the method named, seeded with
   the same `allow` default, and lets the role cascade decide — so a deployment
   that says nothing about an id still allows it, the same answer the client
   gives.

Real authorization for the *data* still belongs in the embedding backend; this
gates the viewer's own RPC surface.

---

## Verification

Automated:

```bash
npm test -- --project=unit --grep "user-roles-claims|io-rights-phases|io-export-routes|server-roles-parity"
npm test -- --project=synthetic --grep "export-unrestricted"
```

- `test/suites/unit/user-roles-claims.test.mjs` — claim shapes → role ids, and
  that an unmapped group grants nothing.
- `test/suites/unit/io-rights-phases.test.mjs` — each pre-phase actually stops
  the work (not merely reports a refusal the caller ignores), a route-blind
  guard denies everything, and `"*"` does not widen onto the new phases.
- `test/suites/unit/io-export-routes.test.mjs` — the two routes are independent,
  a policy decline suppresses the local fallback and a shape decline does not,
  an explicitly bound `file-download` still answers to the local verdict, and an
  automatic (`trigger: "system"`) refusal is logged while the *same* refusal
  under the default trigger still interrupts.
- `test/suites/unit/capability-labels.test.mjs` — a refusal names what it
  refused: CRUD siblings do not read identically, a labelled capability reads as
  its label, an unlabelled one degrades to its id, and the sentence itself still
  interpolates one.
- `test/suites/unit/server-roles-parity.test.mjs` — the server and the browser
  reach the same verdict from the same config, plus the two places the server
  deliberately differs.
- `test/suites/e2e/export-unrestricted.test.mjs` — the regression that matters
  most: with no `core.roles` block, nothing is denied, no owner is refused, and
  the session document is still produced with its content intact.

### Exercising it by hand

```bash
npm run up:dev -- roles-dev
```

`env/parts/roles/dev-all.json` defines five roles over every capability the
shipped elements declare — `guest`, `pathologist`, `researcher`, `admin`, and
`no-local` (the local-file knob on its own) — with no identity provider. Switch
between them in the user tab → **Roles**, and read the effective-permission
table to see which role and which pattern produced each verdict.

Against a real identity provider:

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yaml up -d
npm test -- --project=saml
```

`test/suites/e2e/saml-roles.test.mjs` logs in two Keycloak users with different
groups and asserts the whole chain — group → SAML attribute → token claim →
`core.roles.claims` → `assignRoles` → capabilities → pipeline refusal. Without
the container it skips with instructions. See
[`test/fixtures/keycloak/README.md`](../test/fixtures/keycloak/README.md).

Manual smoke:

1. With no `core.roles` configured, the viewer behaves byte-identically to before (auto-derived caps default to allow; the user tab shows `${name}` without any suffix).
2. Add `annotations.ui.toolbar` to `modules/annotations/include.json`. Define a `viewer` role denying it. From devtools: `XOpatUser.instance().assignRoles(['viewer'])` — confirm the toolbar hides reactively. Flip to `editor` — confirm it returns. No page reload.
3. With `viewer` denying `annotations.crud:annotation.delete`, draw an annotation and attempt to delete. Expected: a "You do not have permission…" toast appears, the item stays on canvas, `io:refused` fires on `VIEWER_MANAGER` with `code: "W_PERM_DENIED"`, and the role guard runs **before** the module's own `validate`.
4. Open the user tab in the right-side AppBar; confirm `name · viewer` (or similar) renders and updates live when `assignRoles(...)` is called from devtools.
5. With `core.roles.default = ["viewer"]` and no resolver plugin, fresh-load a page; `XOpatUser.instance().currentRoles()` should be `["viewer"]` before any login event. Raise a logout; confirm roles snap back to `["viewer"]`, not `[]`.
6. Under `roles-dev`, switch to `pathologist` (denies `annotations.bundle-export`) and **Export**: `export.html` downloads without the annotations block, but a separate `annotations-<stamp>.json` arrives alongside it. Switch to `no-local` and Export again: nothing downloads at all. That pair is the route split.

---

## Where things live

| File                                            | Role                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/classes/user-roles-core.ts`                | Pure registry + resolver + `rolesFromClaims`; no DOM, no globals.                 |
| `src/classes/user.ts`                           | `XOpatUser` roles API, default bootstrap, logout revert, the claim resolver.      |
| `src/loader.ts`                                 | Walks `include.json` to declare caps + mount IO guards. Adds `can()` sugar.       |
| `src/classes/io/io-pipeline.ts`                 | Runs the six pre-phases; `guardDirectionMatches` scopes `"*"`.                    |
| `src/types/io.d.ts`                             | `IODirection` / `IOGuardDirection`; the `rights?` knob on `IOCapability`.         |
| `env/env.default.json`                          | `core.roles` block; see top-of-file comment for example.                          |
| `test/env/saml.json`                            | A complete worked deployment: SAML + `claims` + three roles.                      |
| `test/fixtures/keycloak/`                       | A one-command identity provider with two users in two groups.                     |
| `ui/services/appBar.mjs`                        | Title-suffix wiring for the user tab.                                             |
| `ui/classes/components/userRolesPanel.mjs`      | Reactive `BaseComponent` for a future user-detail popup body.                     |
| `src/locales/en.json` → `user.roles.*`          | Display strings.                                                                  |
