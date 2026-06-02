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

- The `id` **must** start with the owner's `id` followed by `.` or `:` (a malformed entry is dropped with a console warning).
- `default` is required and is either `"allow"` or `"deny"`.
- `label` / `description` are optional and will surface in any future admin UI; they do not affect behaviour.

### Auto-derived from `io.capabilities[]`

For every IO capability the owner already declares (see [`IO_PIPELINE.md`](IO_PIPELINE.md)), the rights system **automatically** registers matching rights-capabilities **and** installs a pre-CRUD guard so refusals never reach the owner's `validate` or `apply`. **No extra config is required** — adopting authorization for IO-mediated actions is opt-out, not opt-in.

Derivation table:

| IO capability declaration                                       | Auto-derived rights-capability IDs                                                                         | Default | Guard?                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ id: "crud:annotation", kind: "crud" }` on owner `annotations` | `annotations.crud:annotation.create`, `.read`, `.update`, `.delete`                                       | `allow` | One `pre-create` / `pre-update` / `pre-delete` guard each, registered with `priority: 10000` so the role check runs **before** the owner's own validators (denied users never see a misleading "validation failed" message). `.read` is declared but has no pre-phase today. |
| `{ id: "bundle-export", kind: "bundle" }`                       | `annotations.bundle-export`                                                                                | `allow` | None auto-mounted (no bundle pre-phase in the pipeline today). The owner's `exportBundle` can consult `XOpatUser.instance().can(...)` itself.                                                                                                                                |
| `{ id: "bundle-import", kind: "bundle" }`                       | `annotations.bundle-import`                                                                                | `allow` | Same.                                                                                                                                                                                                                                                                        |
| `{ id: "kv:cache", kind: "kv" }` (and other `kv:*`)             | — none —                                                                                                   | —       | KV is transparent infrastructure; silently denying it would break the app. **Not auto-derived.** Plugins that genuinely want to gate kv access can declare an explicit capability and call `XOpatUser.instance().can(...)` themselves.                                       |

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

## Assigning roles: the rights-resolver pattern

A "rights resolver" is just any plugin or module that decides which roles the current user has. There is no registration ceremony — the resolver listens to whatever signal it cares about, then calls `assignRoles()`.

```ts
// in a plugin's pluginReady()
const user = XOpatUser.instance();

user.addHandler('login:core', async () => {
    const idToken = user.getSecret('jwt', 'core');
    const decoded = decodeJwt(idToken);
    const groups: string[] = decoded.groups ?? [];

    // Map OIDC groups → xOpat role ids.
    const roles = groups
        .map(g => MY_GROUP_TO_ROLE[g])
        .filter(Boolean);

    user.assignRoles(roles);
});
```

Precedence summary:

| Situation                                                       | Effective roles                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Page load, no `core.roles.default`, no resolver                 | `[]` — every capability falls back to its declared default.                           |
| Page load, `core.roles.default = ["viewer"]`, no resolver       | `["viewer"]` — deployment default applies.                                            |
| Page load → `login:core` fires → resolver assigns `["editor"]`  | `["editor"]` (resolver overrides).                                                    |
| `login:core` fires but no resolver is installed                 | Deployment default still stands.                                                      |
| `logout:core` fires                                             | Reverts to `core.roles.default`.                                                      |
| Resolver calls `clearRoles()`                                   | Reverts to `core.roles.default`.                                                      |

Two resolvers calling `assignRoles` independently → "last call wins". That's a deployment misconfiguration, not a system bug; pick one resolver per deployment.

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
2. For each CRUD direction (`create`, `update`, `delete`), registers an `IO_PIPELINE.registerGuard` with `priority: 10000` and `ownerId: "rights:<owner>"`. The handler refuses synchronously with `{ code: "W_PERM_DENIED", userMessage: $.t('user.roles.refused', ...) }` when the user lacks the capability.

The priority is intentionally above the typical user-registered guard range, so the role check short-circuits *before* domain validation runs. A denied user sees the role-refusal toast, never a misleading "validation failed".

`read` capabilities are declared but not guarded — the IO pipeline does not currently model a `pre-read` phase, and most reads are part of hydration (streaming queries via `IOResource.query`, on-the-fly catch-up). Owners that need to gate reads can call `XOpatUser.instance().can(...)` from inside their `read` hook or from the sink that backs it.

Bundle export/import auto-declares the capability but does not auto-mount a guard. The owner's `exportBundle`/`importBundle` hook is the right place to consult `can(...)` since bundle semantics (per-viewer, per-slide, slide-aware) are domain knowledge.

---

## UI surface

Today the AppBar's right-side user tab title is rendered as `${name} · ${roleLabels.join(", ")}` when at least one role is assigned (see `ui/services/appBar.mjs`). The component subscribes to `roles-changed` so the title stays in sync without a page reload.

A more elaborate panel — `ui/classes/components/userRolesPanel.mjs` — is shipped as a `BaseComponent` and is the intended mount point for a future user-detail popup. It renders a chip list and falls back to a "No role assigned" hint. Wire it into a future `MenuTab` body when richer user-detail UX is added.

---

## Server-side enforcement (optional, opt-in, NOT authoritative)

Not implemented in v1. The pure resolver in `src/classes/user-roles-core.ts` is intentionally framework-free so a server module can import it (or re-implement the ~30 lines verbatim — the cross-import rule still applies). If a deployment wants to add RPC method gating, the recommended extension is:

- Add `capabilities: string[]` and `capabilitiesMode: 'all' | 'any'` (default `'all'`) to the existing `methodPolicy` shape in `server/node/server-runtime.js`.
- Add `verifyRpcCapabilities(policy, req)` to `server/node/auth.js`. Read roles from the JWT claim named in `core.roles.jwtClaim` (default `"roles"`); resolve through `resolveCapabilities` from `user-roles-core`; respond 403 on miss.

This is **best-effort**. The browser holds the role state and can lie. Treat any server-side check as a defense-in-depth nicety, not a guarantee. Real authorization belongs in the embedding backend.

---

## Verification

End-to-end smoke checklist:

1. With no `core.roles` configured, the viewer behaves byte-identically to today (auto-derived caps default to allow; the user tab shows `${name}` without any suffix).
2. Add `annotations.ui.toolbar` to `modules/annotations/include.json`. Define a `viewer` role denying it. From devtools: `XOpatUser.instance().assignRoles(['viewer'])` — confirm the toolbar hides reactively. Flip to `editor` — confirm it returns. No page reload.
3. With `viewer` denying `annotations.crud:annotation.delete`, draw an annotation and attempt to delete. Expected: a "You do not have permission…" toast appears, the item stays on canvas, `io:refused` fires on `VIEWER_MANAGER` with `code: "W_PERM_DENIED"`, and the role guard runs **before** the module's own `validate`.
4. Open the user tab in the right-side AppBar; confirm `name · viewer` (or similar) renders and updates live when `assignRoles(...)` is called from devtools.
5. With `core.roles.default = ["viewer"]` and no resolver plugin, fresh-load a page; `XOpatUser.instance().currentRoles()` should be `["viewer"]` before any login event. Raise a logout; confirm roles snap back to `["viewer"]`, not `[]`.

---

## Where things live

| File                                            | Role                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/classes/user-roles-core.ts`                | Pure registry + resolver; no DOM, no globals.                                     |
| `src/classes/user.ts`                           | `XOpatUser` instance/static roles API + default bootstrap + logout revert.        |
| `src/loader.ts`                                 | Walks `include.json` to declare caps + mount IO guards. Adds `can()` sugar.       |
| `src/types/io.d.ts`                             | Extends `IOCapability` with the `rights?` knob.                                   |
| `env/env.default.json`                          | `core.roles` block; see top-of-file comment for example.                          |
| `ui/services/appBar.mjs`                        | Title-suffix wiring for the user tab.                                             |
| `ui/classes/components/userRolesPanel.mjs`      | Reactive `BaseComponent` for a future user-detail popup body.                     |
| `src/locales/en.json` → `user.roles.*`          | Display strings.                                                                  |
