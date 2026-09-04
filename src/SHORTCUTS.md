# Keyboard Shortcuts (`APPLICATION_CONTEXT.shortcuts`)

The **ShortcutManager** (`src/classes/app/shortcut-manager.ts`) is the single
registry + dispatcher for keyboard shortcuts. Core and modules/plugins register
their key strokes here instead of attaching raw `key-down`/`key-up` handlers.
What that buys a registrant:

- **Declared defaults** with **unique-assignment enforcement** — a combo can
  belong to at most one shortcut; conflicting defaults are suppressed
  (first registrant wins) and resurface automatically when the winner moves.
- **User remapping**, persisted per browser in `AppCache` under
  `keymap.overrides` (overrides only — changed shipped defaults reach every
  user who did not touch that shortcut).
- A row in the **Keymap panel** (fullscreen menu, next to Settings) with
  search, kbd chips, click-to-rebind and JetBrains-style conflict stealing
  (`ui/classes/components/keymapPanel.mjs`).

Dispatch listens on the viewer manager's re-raised document key events
(`VIEWER_MANAGER.raiseEvent('key-down'|'key-up', e)` with `e.focusCanvas`
stamped, see `loader.ts`), wired once from `app.ts` via
`shortcuts.attach(VIEWER_MANAGER)`.

## What does NOT belong here

**Contextual keys — Escape, Enter, Delete in dialogs/inputs/widgets — are not
remappable commands.** They depend on the context they are pressed in and stay
as fixed widget-local handlers (e.g. Escape closing dropdowns in `app.ts`,
Delete/Escape in the annotations key loop). Do not register them.

**A contextual key may drop `requiresCanvasFocus`-style gating when what it acts
on is unambiguous app state rather than a region of the screen.** Annotation
Delete is the reference case: it targets the annotation *selection*, which the
board panel drives just as much as the canvas does, so gating it on canvas hover
only meant the key died the moment the pointer left the canvas. When you do
that, the editable-target guard stops being incidental and becomes the *only*
thing standing between the user and data loss — `e.focusCanvas` was silently
doubling as a typing check (it goes null whenever an editable element is
focused, `loader.ts` `getIsViewerFocused`). Test against `INPUT`, `TEXTAREA`,
`SELECT` and `contentEditable`, falling back to `document.activeElement`; the
canonical rule is `isEditableTarget` in `shortcut-manager.ts`. Keys that carry a
side effect beyond their obvious target (annotation Escape also resets the
drawing mode) should stay scoped.

## Registering a shortcut

```js
const handle = APPLICATION_CONTEXT.shortcuts.register({
    id: "myplugin.doThing",                    // unique, namespaced
    titleKey: "myplugin:keymap.doThing",       // i18n key, resolved at render time
    // titleArgs: { shape: "Rectangle" },      // optional interpolation vars for titleKey
    //   → one key ("…: {{shape}}") covers a whole family instead of one key each
    descriptionKey: "myplugin:keymap.doThingDesc",   // optional tooltip
    categoryPath: ["keymap.cat.plugins"],      // tree path (i18n keys)
    defaultCombos: ["Alt+KeyD"],               // [] = unbound by default
    owner: this.id,                            // enables unregisterAll(owner)
    type: "press",                             // or "hold"
    trigger: "down",                           // press only; "down" (default) | "up"
    scope: { requiresCanvasFocus: false, allowInInputs: false },
    preventDefault: true,                      // default
    icon: "ph-lightning",                      // optional, icon slots only
    quickAction: true,                         // optional, opt in to invoke() — see below
    handler: ({ event, viewer, shortcutId }) => { /* ... */ },
});
// handle.unregister() — or shortcuts.unregisterAll(this.id) on teardown
```

- `type: "hold"` uses `onPress`/`onRelease` instead of `handler`. Release fires
  on the main key's key-up (modifier-insensitive), on **window blur** (so
  alt-tab never leaves a hold stuck), and when the binding is remapped away.
- `viewer` in the invocation context is the focus-derived viewer (multi-viewport
  correct) or the active viewer — prefer it over `window.VIEWER`.
- Combos that must suppress a native browser action (e.g. `Primary+KeyS`)
  MUST use `trigger: "down"` — `preventDefault()` on key-up is too late.
- Registration is idempotent by `id` (re-register replaces the spec, user
  overrides survive).

### Clickable shortcuts (`quickAction` + `invoke`)

`shortcuts.invoke(id, { viewer })` fires a shortcut programmatically — that is
what lets the app-bar quick-actions catalogue surface it as a button (see
`AppBar.Actions` in `ui/services/README.md`). It is opt-in and strict:

- requires `type: "press"`, a `handler`, and `quickAction: true`; otherwise it
  returns `false` and does nothing;
- it **bypasses `scope`** (a button click has no canvas focus) and passes
  `event: null`. **A `quickAction` handler must therefore never dereference
  `ctx.event`.** Audit that before setting the flag;
- `icon` is presentation only (`ph-*` class or image URL, used by icon
  slots). It does *not* imply `quickAction` — an icon in the Keymap panel must
  not silently make a keyboard-only handler clickable.

## Combo format

Canonical string: modifiers in fixed order, `+`-joined, one main token:

```
[Primary+][Ctrl+][Alt+][Shift+][Meta+]<Token>
"KeyH"   "Alt+KeyQ"   "Primary+Shift+KeyZ"   "ArrowUp"   "+"
```

- The main token is an **`e.code`** value (`KeyQ`, `Digit1`, `ArrowUp`, `F5`,
  `NumpadAdd`, …) — keyboard-layout- and CapsLock-insensitive.
- **Single-character tokens** (`"+"`, `"-"`) instead match **`e.key`**
  case-insensitively with Shift excluded from the modifier match — use them
  when the *produced character* matters regardless of layout/numpad (the
  core zoom keys do).
- **`Primary`** is the portable primary modifier: Ctrl on Windows/Linux,
  ⌘ on macOS. The capture widget records it automatically.

Utilities (also available on the instance): `comboFromEvent(e)`,
`comboDisplayParts(combo)`, `isValidCombo(combo)`.

## Delegated dispatch (binding-only registrations)

A registration without any callback participates in conflicts, persistence and
the Keymap panel, but the manager does **not** dispatch it — the registrant
keeps its own key loop and queries:

- `shortcuts.eventMatches(id, e)` — full effective-combo match,
- `shortcuts.eventMatchesToken(id, e)` — main-token-only match
  (hold-release semantics).

The annotations module works this way: each `AnnotationState` declares a
`defaultKeyCombo` getter, the module registers a binding-only shortcut per
mode, and the base `accepts()`/`rejects()` predicates delegate to the two
queries above — so custom modes get user-remappable keys by overriding a
single getter, while modes with bespoke `accepts()` logic keep working
(compose with `super.accepts(e)` to stay remappable).

## Modifier-only bindings (pointer gestures)

A pointer gesture that arms on a held modifier (e.g. **Ctrl/Primary + drag →
rotate the viewport**, `ViewerRotationController`) registers a **binding-only,
modifier-only** shortcut: `capture: "modifiers"`, a modifier-only default combo
(`"Primary"`, `"Ctrl"`, `"Alt+Shift"`, …), and no callback. Such combos carry
no main token, live in a separate `:mods` conflict namespace, and are **never
dispatched from a keydown** (a live key event always has a token). The gesture
registrant owns its own pointer loop and queries:

- `shortcuts.pointerModifiersMatch(id, mouseEvent)` — true when the event's
  `ctrlKey/altKey/shiftKey/metaKey` state matches the effective modifier combo.

The Keymap panel captures these by holding the modifier(s) and releasing
(`modifierComboFromEvent`), so the arming modifier is user-remappable like any
other shortcut. The gesture only fires while OSD mouse-nav is enabled (it rides
OSD's `canvas-press`/`canvas-drag` stream), so tools that grab the pointer
starve it cleanly.

## User remapping API (what the Keymap panel uses)

```js
shortcuts.list()                       // specs + effective bindings
shortcuts.getBinding(id)               // { combos, isDefault, suppressed }
shortcuts.findConflicts(combo, id?)    // conflicting shortcut ids
shortcuts.setUserBinding(id, ["Alt+KeyX"])   // or null to unbind
shortcuts.resetToDefault(id)
shortcuts.resetAllToDefaults()
```

Events (OpenSeadragon.EventSource): `shortcut-registered`,
`shortcut-unregistered`, `binding-changed`, `bindings-reset`.

## Scope gating

- `requiresCanvasFocus: true` — fires only when `e.focusCanvas` is truthy
  (suppressed while typing; viewer navigation and tool modes want this).
- `allowInInputs: true` — fires even when an INPUT/TEXTAREA/contentEditable
  is focused (rare; default is to stay quiet while the user types).

OpenSeadragon's own canvas keyboard navigation is disabled by the core
(`canvas-key` → `preventDefaultAction`, `loader.ts`), so the manager is the
single key authority for viewer navigation.
