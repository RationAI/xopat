# Questionnaire plugin

Custom questionnaire runtime **and** schema designer for xOpat v3. End users fill in a
multi-page form; authors (when permitted) open the designer to build the schema, attach
per-page viewer setups and recorder animations, and export/import the schema bundle.

Plugin id: **`questionaire`** (declared in `include.json`; also the IO owner id used for
`ENV.client.io.bindings` and the rights-capability prefix).

## Editing permission gate

Whether the **designer** ("Show designer" button + designer panel) is available is gated
on the client-side roles/capabilities layer (`src/USER_ROLES.md`), so an external authority
can allow or disallow editing per user at runtime — no reload, no code change.

| Piece | Value |
|---|---|
| Capability | `questionaire.edit` (default `allow`) |
| Declared in | `include.json` → top-level `capabilities[]` |
| Consumed in | `plugin.ts` → `pluginReady()` subscribes via `this.onCapabilityChange("questionaire.edit", …)` and folds the result into the toolbar guard (`_enableEditor && !_isExported && _canEdit`) |
| Effect of deny | "Show designer" button hides; any open designer collapses live |

Default is `allow`, so with no role config the plugin behaves exactly as before. Locking is
opt-in. (The static `enableEditor` option still applies independently — editing needs both.)

### Configuring roles (deployment)

Roles live in the deployment env (e.g. `env/env.default.json`) under `core.roles`. Example —
viewers cannot edit, editors can:

```jsonc
"core": {
  "roles": {
    "default": ["viewer"],
    "definitions": {
      "viewer": { "label": "Read-only viewer",
                  "deny":  ["questionaire.edit"] },
      "editor": { "extends": ["viewer"],
                  "grant": ["questionaire.edit"] },
      "admin":  { "extends": ["editor"], "grant": ["*"] }
    }
  }
}
```

### Assigning roles to the current user (rights-resolver)

Any plugin/module can be the "rights resolver" — it decides which roles the user holds and
calls `assignRoles`. Typically driven off the login token:

```ts
const user = XOpatUser.instance();
user.addHandler('login:core', () => {
  const groups: string[] = decodeJwt(user.getSecret('jwt', 'core'))?.groups ?? [];
  user.assignRoles(groups.includes('curators') ? ['editor'] : ['viewer']);
});
```

### Testing from devtools (no reload)

```js
XOpatUser.instance().assignRoles(['viewer']);   // designer button disappears
XOpatUser.instance().assignRoles(['editor']);   // designer button returns
XOpatUser.describeCapability('questionaire.edit'); // → { default: 'allow', declaredBy: 'questionaire', … }
```

> **UI gating only.** This controls what the browser *renders*. Real authorization belongs in
> the embedding backend; never trust the client's role claim for server-side enforcement.

## See also

- [`MIGRATION.md`](MIGRATION.md) — IO pipeline migration (schema bundle + per-answer CRUD).
- [`src/USER_ROLES.md`](../../src/USER_ROLES.md) — full roles & capabilities model.
- [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md) — persistence pipeline and sink bindings.
