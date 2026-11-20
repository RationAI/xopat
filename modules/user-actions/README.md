# user-actions

Persistent, script-backed **actions**: a saved script mounted as a top-bar button, a Tools
row, a canvas right-click item, a viewer control or a keyboard shortcut. Use it for what the
viewer does not offer as a click — "count annotations per class", "export these measurements",
"jump to the largest tumor region" — when the scripting API can already do it.

One schema, three producers:

| Producer | Where it lives | Trust | Needs approval |
|---|---|---|---|
| **Deployment** | `include.json` ⊕ `ENV.modules["user-actions"].actions` | operator (trusted) | no — read-only for users |
| **User** | Tools → *Manage actions…* editor | the user | yes, on save |
| **Assistant** | `actions` scripting namespace | the model | yes, always — the user sees the script (or a diff) |

Deployment actions make the feature **model-independent**: an operator ships prepared scripts
and every user gets the buttons, with no assistant configured at all.

## Enabling

The module is not loaded by default. Load it in the deployment ENV (or compose the demo with
`npm run up -- synthetic flags/user-actions-demo`):

```jsonc
"modules": {
  "user-actions": {
    "enabled": true,
    "permaLoad": true,
    "actions": [ /* deployment actions, see below */ ]
  }
}
```

## The action schema

```jsonc
{
  "id": "count-per-class",                 // [a-z0-9-], ≤ 48; unique
  "label": "Count by class",               // ENV may give {"en": "...", "cs": "..."}
  "description": "Annotations per preset", // optional; ENV may give a language map
  "icon": "ph-chart-bar",                  // Phosphor class
  "script": "…",                           // ENV may give an array of lines
  "placements": [
    { "surface": "quick", "pinned": true },          // top-bar quick action (pinned once)
    { "surface": "tools" },                          // Tools menu row
    { "surface": "context-menu", "when": "always" }, // or "selection"
    { "surface": "viewer-control" },                 // per-viewer control strip
    { "surface": "shortcut", "combo": "Alt+KeyC" }   // shortcut-manager combo format
  ],
  "output": "auto",       // auto | toast | window | silent
  "timeoutMs": 600000,    // default 10 min, capped by maxTimeoutMs
  "enabled": true,
  "bypassConsent": false  // DEPLOYMENT ONLY: skip host consent prompts for this action
}
```

The schema is **closed** (`schema.ts`): unknown fields are errors, at every level, for every
producer. A deployment action with errors is skipped and logged on channel
`module.user-actions`; it never breaks boot.

### Writing the script

Same language as any xOpat script (`src/SCRIPTING.md`): namespaces as globals, top-level
`await`, `return` the value to show.

- The trigger arrives in the read-only global **`input`**:
  `{ trigger, actionId, viewerId, position?, viewportPosition?, selection? }` — `position`
  (image px), `viewportPosition` and `selection` (`[{id, incrementId}]`) on context-menu runs.
- The viewer that was clicked (context menu, viewer control, shortcut) is already bound; quick
  and Tools runs use the single / active viewer.
- **The return value is the output** (`output: "auto"`): short text → notification; a flat
  object → key/value table; an array of flat objects → table; a longer string → markdown;
  anything else → JSON. Values are escaped before they become markdown and rendered through the
  `markdown` module.

Example (shipped in `env/parts/flags/user-actions-demo.json`):

```js
const presets = await annotationsRead.getPresets();
const names = Object.fromEntries(presets.map(p => [p.presetID, p.meta?.category?.value || p.presetID]));
const counts = {};
for (const a of await annotationsRead.getAnnotations()) {
  const name = names[a.presetID] || "unassigned";
  counts[name] = (counts[name] || 0) + 1;
}
return Object.keys(counts).length ? counts : "No annotations.";
```

## Assistant flow (`actions` namespace)

`scripting/api.ts` registers `actions`: `listActions`, `getAction` (script + last run errors),
`validateAction` (schema, syntax, referenced/unknown namespaces, shortcut conflicts, and a
hardcoded `setActiveViewer("…")` — refused as `fixedViewer`, since the action runs on the
clicked viewer and chat viewer ids do not exist in its context — no side
effects), `proposeAction`, `runAction`, `setActionEnabled`, `deleteAction`. Its assistant hints
tell the model to test with `run_viewer_script`, validate, then propose; to repair, read
`getAction(id)` and propose under the **same id** — the user then reviews a diff
(`SuggestionEditor`) and may decline individual changes.

`proposeAction` resolves with the user's decision (`approved` / `declined` / `invalid`). The
approval dialog is the module's own modal, so a consent-bypassing scripting context cannot skip
it. `runAction` forwards the calling conversation's sensitive-data policy into the run.

## Security model

- **Sources.** Actions are read only from deployment config (`getStaticMeta`) and the user's own
  `kv:actions` store (deployment-scoped; `local-storage` by default, re-bindable by an operator
  via `client.io.bindings`). Never from `getOption`, session bundles, URL params or POST data —
  those are third-party controllable, and an executable payload there is stored XSS.
- **Approval per revision.** A user record runs only when `approvedRevision === revision`.
  Changing the script, placements or timeout bumps the revision and drops the approval.
- **Import** (local file only) lands every action **disabled and unapproved**.
- **Execution** goes through the core sandbox (`executeScript`): `core.scripting.run` applies to
  every run, deployment actions included; namespace and action consents still prompt unless an
  operator marked the deployment action `bypassConsent`.
- **Capabilities** (UI gating): `user-actions.run`, `user-actions.author`.

## Deployment knobs (`getStaticMeta` only)

| Key | Default | |
|---|---|---|
| `actions` | `[]` | deployment actions |
| `allowUserActions` | `true` | users may create/edit/import |
| `allowAssistantAuthoring` | `true` | expose the `actions` namespace |
| `maxActions` | `50` | saved user actions |
| `maxScriptBytes` | `32768` | |
| `maxTimeoutMs` | `1800000` | cap for an action's `timeoutMs` (default 10 min) |
| `surfaces` | all five | surfaces actions may use |

## Files

`schema.ts` (validator) · `store.ts` (sources, persistence, run history) · `runner.ts`
(sandboxed execution, timeout, single-flight) · `surfaces.ts` (registry adapters) ·
`output.ts` (result presentation) · `ui/panel.ts`, `ui/approve.ts` · `scripting/api.ts`.
Tests: `test/unit` (schema, output, store) and `test/e2e` (synthetic slide + demo ENV).
