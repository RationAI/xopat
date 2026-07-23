# Questionnaire plugin

Custom questionnaire runtime **and** schema designer for xOpat v3. End users fill in a
multi-page form; authors (when permitted) open the designer to build the schema, attach
per-page viewer setups and recorder recordings, and export/import the schema bundle.

Plugin id: **`questionaire`** (declared in `include.json`; also the IO owner id used for
`ENV.client.io.bindings` and the rights-capability prefix).

## Per-page viewer setup

A page can carry a captured **viewer setup** (designer → Page setup → Viewer setup):
a canonical scene snapshot taken through `APPLICATION_CONTEXT.scene.serialize({ includeViewport: true })`
— open slides per viewport slot, per-background visualization state, and per-viewer
pan/zoom/rotation. Opening the page restores it via `APPLICATION_CONTEXT.scene.deserialize`;
when the same content is already open only the viewports are re-applied (no reopen/flicker).

**Restore is consent-gated.** When the saved setup differs from what the visitor has open,
the page does **not** silently reload their slides. The resolution order is:

1. respondent preference "always apply automatically" (toolbar gear; plugin cache key
   `prefs.autoApplyScenes`) — forces `auto`;
2. the page's own **apply mode** (designer → Viewer setup → *When a visitor opens this
   page*): `auto` or `prompt`, unset = inherit;
3. the deployment default: static meta `sceneApplyMode` (`include.json` /
   `ENV.plugins.questionaire.sceneApplyMode`, default `"prompt"`).

`prompt` renders a non-blocking banner above the form ("Apply saved setup") — the form
stays usable, nothing reloads until the visitor confirms. The viewport-only fast path for
already-matching content always runs automatically (it reloads nothing).

**Pages without a captured setup leave the viewer untouched.** The legacy `xBgSpec`
("fallback background index") field is deprecated and ignored — it used to force-apply a
background on every page switch, collapsing multi-slide grids. Old schemas still
round-trip the field, it just has no effect.

## Per-page recordings

A page can bind one named **recorder recording per viewer slot** (designer → Page setup →
Page recordings). Binding **snapshots** the recording — its steps plus the audio/image
overlay assets they reference — into the page (`page.recordings[]`), so the exported
questionnaire replays standalone; respondents need no recorder state of their own. The
binding also keeps a *reference* (`recordingId`, `recordingUpdatedAt`) to the source
recording, powering the designer's staleness badge and **Refresh from recorder** button.
Unlike the old "consume" flow, the recorder is never wiped.

On page visit (after the scene applied / the prompt confirmed), each binding is upserted
into the recorder as a **transient** recording (`qn:<pageId>:<bindingId>` — visible and
scrubbable in the recorder UI, but excluded from the user's recorder persistence) and made
active on its viewer; bindings with **autoplay** start playing per viewer. The respondent
preference "Autoplay page recordings" (cache key `prefs.autoplayRecordings`) can turn
autoplay off globally.

Legacy `page.pageAnimation` (flat consumed steps) is auto-migrated to a single slot-0
binding on schema load — see `MIGRATION.md`.

## Configuration

| Knob | Channel | Meaning |
|---|---|---|
| `enableEditor` | `getOption` (session/URL — UX only) | Show the designer toggle at all. |
| `isExported` | `getOption` | Read-only exported mode (no drafts, no editing). |
| `sceneApplyMode` | **static meta** (`include.json` / `ENV.plugins.questionaire.sceneApplyMode`) | Deployment default for scene restore: `"prompt"` (default) or `"auto"`. |
| `maxFileBytes` | static meta | Per-file cap for file answers. |
| `questionaire.edit` | capability (roles layer) | The actual editing gate — see below. |
| `prefs.autoApplyScenes`, `prefs.autoplayRecordings` | plugin cache (per user) | Respondent preferences from the toolbar gear. |

Deployment knobs deliberately ride static meta, not `getOption` — session config is
third-party controllable (AGENTS.md §3/§7).

## File answers

"File upload" questions embed the picked file(s) into the answer as
`{ name, size, type, dataUrl }` (an array when `multiple`), so drafts, `crud:answer`
sync, and bundle exports are self-contained. The per-file size cap is the
`maxFileBytes` static meta (deployment `ENV.plugins.questionaire.maxFileBytes`,
default 2 000 000 bytes); oversized files are rejected with a toast.

## Localization

All UI strings live in `locales/<lang>.json` under the `questionaire` namespace and are
loaded with `this.loadLocale()` (see AGENTS.md §3). `en` is the source of truth.

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
