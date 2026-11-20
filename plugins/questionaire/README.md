# Questionnaire plugin

Custom questionnaire runtime **and** schema designer for xOpat v3. End users fill in a
multi-page form; authors (when permitted) open the designer to build the schema, attach
per-page viewer setups and recorder recordings, and export/import the questionnaire —
schema **and** answers — through the IO pipeline.

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
binding on schema load — see `normalizePageRecordings` in `schema.ts`.

## Configuration

| Knob | Channel | Meaning |
|---|---|---|
| `enableEditor` | `getOption` (session/URL — UX only) | Show the designer toggle at all. |
| `isExported` | `getOption` | Read-only exported mode (no drafts, no editing). |
| `sceneApplyMode` | **static meta** (`include.json` / `ENV.plugins.questionaire.sceneApplyMode`) | Deployment default for scene restore: `"prompt"` (default) or `"auto"`. |
| `maxFileBytes` | static meta | Per-file cap for file answers (upload **and** import). |
| `maxAnswerBytes` | static meta | Cap on one case's serialized answer map (default 8 000 000). |
| `allowedFileMime` | static meta | Allow-list of file-answer MIME types (default png/jpeg/webp/pdf/plain/csv). |
| `questionaire.edit` … `questionaire.export.answers` | capabilities (roles layer) | The actual gates — see *Permissions*. |
| `prefs.autoApplyScenes`, `prefs.autoplayRecordings` | plugin cache (per user) | Respondent preferences from the toolbar gear. |
| `draft.<slotKey>` | plugin cache (per user) | Local answer draft of one case — see *Import / export & persistence*. |

Deployment knobs deliberately ride static meta, not `getOption` — session config is
third-party controllable (AGENTS.md §3/§7).

## Import / export & persistence

Everything the plugin persists goes through the core IO pipeline
([`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md)).

### Three channels, three documents

An author moving a *form* and a respondent handing in a *filled form* are
different acts with different destinations and different rights. They used to
share one document and one capability, which made Submit and Export duplicates of
each other — and meant the author's "Export" quietly shipped every respondent's
answers inside what reads as "the form".

| Channel | Document | Driven by | Gate |
| --- | --- | --- | --- |
| **State** | `{schema, answers, activeSlot}` | the pipeline (session save/share, `Export all`) | `questionaire.bundle-export` / `-import` |
| **Submission** | `{schema: {id, title, version}, slotKey, answers, submittedAt}` | the **Submit** button | `questionaire.bundle-submit` |
| **Template** | `{schema}` | the **Save form** / **Load form** buttons | `questionaire.edit` / `questionaire.import.schema` |

The state channel keeps carrying answers on purpose: it is what a session export
writes, so stripping them would silently empty every in-progress form that
travels between machines.

The template channel is a plain local file — no IO capability, no binding
surface. Authoring a form is not a persistence channel, and routing it through
`bundle-export` is what made it ship answers.

Only the submission channel is meant to leave the browser toward a platform.
Bind it and nothing else if that is all you want stored:

```jsonc
"io": { "bindings": { "questionaire": { "bundle-submit": ["github"] } } }
```

With nothing bound, **Submit downloads the filled form** rather than silently
doing nothing.

### The state bundle

`bundle-export` / `bundle-import` carry **one** document — the schema plus every case's
answers:

```jsonc
{
  "schema":  { /* QuestionnaireSchema */ },
  "answers": {                                  // omitted when `questionaire.export.answers` is denied
    "<viewerId>::<backgroundId>": { "<fieldName>": <value>, … },
    "__global__":                 { … }
  },
  "activeSlot": "<slotKey>"
}
```

There is **no version field**: the plugin has not shipped anywhere yet, so no
back-compat shim exists. A payload the importer cannot understand is refused, not
migrated.

`bundleScope` is **`global`**, deliberately, even though answers are per-case:

- `IO_PIPELINE.importBundle(raw, {ownerUid})` — the path a session import and any host
  use — always builds an empty ctx key, so a slide-keyed export could never be restored
  from a file;
- `this.io.flush()` carries no viewer scope, so slide-keyed export would fan out into one
  sink write per (viewer, slide) instead of handing the user one document;
- `per-viewer-background` auto-flushes on slide-leave and restores on slide-enter, but this
  plugin *drives* slide changes itself (page scenes), so those restores would rewrite the
  answers mid-edit.

The clear-on-empty contract is still implemented (an empty payload for a ctx carrying a
`backgroundId` wipes exactly that slot), so switching scope later stays safe.

### Slots — one case per (viewer, slide)

Answers are keyed by **slot**: `` `${viewer.uniqueId}::${UTILITIES.currentBackgroundIdFor(viewer)}` ``
of **viewer slot 0** (`VIEWER_MANAGER.viewers[0]`), or `__global__` when no viewer/slide
resolves (headless, exported form). Slot 0 — not the focused viewer — because focus
flapping between grid viewports must never swap the form under the respondent.

The local draft lives in the **plugin cache** under `draft.<slotKey>` (previously one fixed
global `AppCache` key, so two slides overwrote each other). Drafts are validated on load
like any other import: the schema may have changed since the draft was written.

### Per-field CRUD (`crud:answer`)

Each answered field is dispatched as one item:

```ts
{ slotKey, viewerId?, backgroundId?, fieldKey, value, updatedAt }   // itemId = `${slotKey}::${fieldKey}`
```

- first write of a field is a `create`, later ones `update`s (the outbox coalesces a
  keystroke burst back into the create), so a strict-REST sink never sees a PUT to a
  resource that was never POSTed;
- **clearing** a field — including removing the last file chip or repeat row — issues a
  `delete`, so upstream copies are not orphaned;
- on submit the outbox is drained before the submission is flushed, so a sink storing
  both sees the per-field records before the submission that refers to them;
- on load (and on slide change) `query({slotKey})` pulls stored answers back in. Nothing
  bound ⇒ empty iterable ⇒ silent no-op.

### Hydration precedence

Sources are applied local draft → bundle → CRUD query, each as a **per-field upsert**, with
one rule: **a field the user touched this session is never overwritten**. The single
exception is a user-initiated import, which replaces the slot wholesale (the user asked the
file to win; a merge could not blank a field they cleared). Each slot hydrates from CRUD at
most once, re-armed when the slide changes.

### Toolbar

**Save form** / **Load form** move the blank form as a local file. They are
authoring actions, so they appear only for a role holding `questionaire.edit`
(and, for loading, `questionaire.import.schema`). Load applies the schema
directly rather than through `IO_PIPELINE.importBundle` — a template load must
only ever change the form, never apply answers riding along in the file — but the
payload is still treated as hostile: `strict` normalization refuses anything
without usable pages instead of degrading to the default form. Both a bare schema
and a `{schema}` envelope are accepted, since an author should not have to know
which of the two a file happens to be.

**Submit** is the respondent's action, on the last page. It validates **every
visible page** (not just the current one — a respondent who stepped back and
cleared a required field on page 1 could previously still submit from page 3),
lands the user on the first offending page if any, drains the answer outbox, then
flushes `bundle-submit`. Nothing bound ⇒ the filled form downloads. Bound and
refused ⇒ an error naming the reason. Bound and accepted ⇒ a confirmation.
`questionnaire-submit` fires either way, because hosts advance their own workflow
on it and a failing sink must not swallow the submission.

### Prose is markdown

Form/page/element `description`, `content` bodies, and (inline-only) labels and titles
are rendered as markdown through the [`markdown`](../../modules/markdown/README.md)
module — a declared dependency, so it is loaded with the plugin. Author HTML is not
rendered: it is stripped on normalize and the sanitizer would drop it anyway.

A markdown link may address a slide region, and the respondent clicking it navigates
the viewer there:

```
Explore **[region 3.6](#xopat-region?viewer=viewer-1&x=45911&y=131490&w=6806&h=5616)** and answer below.
```

This matters most when an assistant drives the plugin through the scripting API: it
authors the same prose it would put in a chat reply, and it now renders the same way.
The `.d.ts` in `scripting/api.ts` tells the model so.

Three places stay plain text and show markdown literally, by necessity: `<option>`
labels (an `<option>` cannot hold markup), page **tab** labels and their tooltip, and
validation messages. Locale strings are unaffected — they are text nodes by contract
(see `tRaw` in `utils.ts`).

### Hostile input

Both halves of an incoming document are treated as adversarial:

- the **schema** is normalized in *strict* mode — a payload with no usable pages throws a
  refusal instead of silently degrading to the default one-field form;
- the **answers** go through `validateAnswers` (`validation.ts`), which is fatal-vs-drop:
  a non-object payload / oversized payload / absurd key count refuses everything, while an
  unknown key, a prototype-pollution key (`__proto__`, `constructor`, `prototype`), a
  value whose shape does not match its element kind, an over-long repeat array, or a bad
  file value drops just that field and is reported as "N answer(s) … were skipped";
- **file answers** must be `data:…;base64,` URLs whose MIME is in `allowedFileMime` and
  whose decoded size fits `maxFileBytes`. `text/html`, `image/svg+xml`, XML and JavaScript
  types are refused regardless of the allow-list — a stored data URL is handed back to the
  browser, so a script-capable one is an XSS vector.

### Teardown

Core has no plugin-destroy hook, so the plugin exposes `destroy()` (also run on `pagehide`
after the final draft flush) which disposes every capability subscription, DOM listener,
timer and in-flight hydration.

## File answers

"File upload" questions embed the picked file(s) into the answer as
`{ name, size, type, dataUrl }` (an array when `multiple`), so drafts, `crud:answer`
sync, and bundle exports are self-contained. The per-file size cap is the
`maxFileBytes` static meta (deployment `ENV.plugins.questionaire.maxFileBytes`,
default 2 000 000 bytes); oversized files are rejected with a toast.

## Localization

All UI strings live in `locales/<lang>.json` under the `questionaire` namespace and are
loaded with `this.loadLocale()` (see AGENTS.md §3). `en` is the source of truth.

## Permissions

Every user-visible behaviour is gated on the client-side roles/capabilities layer
(`src/USER_ROLES.md`), so an external authority can allow or disallow it per user at
runtime — no reload, no code change. Every subscription is live: granting or revoking a
role repaints the UI immediately.

| Capability | Default | Source | Effect of deny |
|---|---|---|---|
| `questionaire.edit` | allow | declared | "Show designer" hides; Save form / Load form hide; scripting edits throw |
| `questionaire.answer` | allow | declared | Whole form renders read-only (inputs disabled, Submit disabled, Clear draft hidden) with an explanatory notice |
| `questionaire.import.schema` | allow | declared | Load form hides; an imported document's `schema` section is skipped |
| `questionaire.import.answers` | **deny** | declared | An imported document's `answers` section is skipped — pre-filling a form biases the respondent, so it is opt-in |
| `questionaire.export.answers` | allow | declared | The state bundle carries the schema only |
| `questionaire.bundle-submit` | allow | auto-derived from `io.capabilities` | **Submit is disabled**; the pipeline refuses the dispatch in `pre-export` |
| `questionaire.bundle-export` | allow | auto-derived | Session state is not written to any sink (pipeline refuses in `pre-export`) |
| `questionaire.bundle-import` | allow | auto-derived | Sink restores and session imports are refused in `pre-import` |
| `questionaire.crud:answer.{create,update,delete}` | allow | auto-derived | The pipeline's rights guard refuses the dispatch |
| `questionaire.crud:answer.read` | allow | auto-derived | Stored answers are not pulled back in (silently — hydration is not a user action) |

Every auto-derived capability is enforced **by the pipeline**, before any sink is
contacted (`src/USER_ROLES.md` → "IO pipeline integration"). The plugin's own
`can()` checks in `exportBundle` are defence in depth, not the mechanism. Note
that `can()` returns `true` for an id nobody declared — which is why the gates
above are declared in `include.json`.

Denied answering is caught at **render** time on purpose. Letting a denied user type and
having each keystroke refused by the CRUD rights guard would produce a toast storm; the
`questionaire.answer` gate disables the controls instead (with `setAnswer` refusing as
defence in depth against a stale DOM node).

Defaults keep an unconfigured deployment behaving as before, except `import.answers`,
which must be granted deliberately. (The static `enableEditor` option still applies
independently — editing needs both.)

### Configuring roles (deployment)

Roles live in the deployment env (e.g. `env/env.default.json`) under `core.roles`. Example —
viewers cannot edit, editors can:

```jsonc
"core": {
  "roles": {
    "default": ["respondent"],
    "definitions": {
      // Fills and hands in forms; cannot change them.
      "respondent": { "label": "Respondent",
                      "grant": ["questionaire.answer", "questionaire.bundle-submit",
                                "questionaire.crud:answer.*"],
                      "deny":  ["questionaire.edit", "questionaire.import.schema"] },
      // Authors forms.
      "author":     { "extends": ["respondent"],
                      "grant": ["questionaire.edit", "questionaire.import.schema"] },
      "admin":      { "extends": ["author"], "grant": ["*"] }
    }
  }
}
```

### Assigning roles to the current user

Map an identity-provider claim in the same `core.roles` block — no plugin, no code:

```jsonc
"claims": { "claim": "groups", "map": { "curators": ["author"] } }
```

`test/env/saml.json` is a complete worked deployment, with a runnable identity
provider in `test/fixtures/keycloak/`. For logic a mapping table cannot express,
any plugin can call `XOpatUser.instance().assignRoles(...)` itself — see
[`src/USER_ROLES.md`](../../src/USER_ROLES.md).

### Testing from devtools (no reload)

```js
XOpatUser.instance().assignRoles(['respondent']);  // designer + Save/Load form disappear
XOpatUser.instance().assignRoles(['author']);      // they return
XOpatUser.describeCapability('questionaire.edit');            // → { default: 'allow', declaredBy: 'questionaire', … }
XOpatUser.describeCapability('questionaire.answer');
XOpatUser.describeCapability('questionaire.crud:answer.read'); // auto-derived from io.capabilities
```

> **UI gating only.** This controls what the browser *renders*. Real authorization belongs in
> the embedding backend; never trust the client's role claim for server-side enforcement.

## See also

- [`modules/markdown/README.md`](../../modules/markdown/README.md) — prose rendering and `#xopat-region` links.
- [`src/USER_ROLES.md`](../../src/USER_ROLES.md) — full roles & capabilities model.
- [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md) — persistence pipeline and sink bindings.
