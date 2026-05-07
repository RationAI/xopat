# Annotations Module — IO Migration Guide

The annotations module has been migrated to xOpat's generic IO pipeline (`window.IO_PIPELINE`, `APPLICATION_CONTEXT.io` — see [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md) for the design). This document covers what changed, why, and how to adapt existing integrations.

---

## What changed

### 1. Six pre-action events removed

The following events with the `setCancelled / isCancelled` flag protocol no longer exist:

| Removed event | Was raised by | Listeners must now register a |
|---|---|---|
| `annotation-before-create`               | `promoteHelperAnnotation`       | guard with `direction: "pre-create"` |
| `annotation-before-delete`               | `_deleteAnnotation`             | guard with `direction: "pre-delete"` |
| `annotation-before-edit`                 | `beginSelectionEdit`            | guard with `direction: "pre-update"` and `meta.kind === "edit-start"` |
| `annotation-before-preset-change`        | `changeAnnotationPreset`        | guard with `direction: "pre-update"` and `meta.kind === "preset-change"` |
| `annotation-before-replace`              | `replaceAnnotation` (real)      | guard with `direction: "pre-update"` and `meta.kind === "replace"` |
| `annotation-before-replace-doppelganger` | `replaceAnnotation` (UI swap)   | guard with `direction: "pre-update"` and `meta.kind === "replace-doppelganger"` |

Repository grep at migration time confirmed there were **zero** in-tree listeners on these events. External plugins/forks must adopt the guard API.

### 2. Public method signatures are unchanged (still synchronous)

The five user-facing mutation methods remain **synchronous**, despite routing through the IO pipeline. The pipeline's `IOResource.create / update / delete` are sync-core (see "sync core" in [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md)): validate → sync guards → local apply → history push all happen in the caller's frame; the sink dispatch is queued and runs in the background. Returned objects carry a `.settled: Promise<IOResult>` for callers that want server confirmation.

| Method | Sync return | Notes |
|---|---|---|
| `OSDAnnotations.FabricWrapper#deleteAnnotation`        | `boolean` | Opts in to `rollbackOnAsyncRefuse: true` — server reject reverts the local removal. |
| `OSDAnnotations.FabricWrapper#promoteHelperAnnotation` | `boolean` | Same — server reject reverts the local create. |
| `OSDAnnotations.FabricWrapper#replaceAnnotation`       | `boolean` | Default-off rollback (a swap is easier to live with than flicker). |
| `OSDAnnotations.FabricWrapper#changeAnnotationPreset`  | `boolean` | Default-off rollback. |
| `OSDAnnotations.FabricWrapper#beginSelectionEdit`      | `boolean` | Guard-only check (no dispatch). |

So existing call sites continue to work without `await`. Mouse-move and edit hot paths stay native (no microtask yield from the pipeline). The private `_deleteAnnotation`, `_promoteHelperAnnotation`, `_replaceAnnotation`, `_addAnnotation` keep their synchronous shapes and bypass the resource pipeline by design (cleanup paths, undo replays, bulk operations).

If you want to know whether the server accepted the change, await `.settled`:

```js
const result = fabric.deleteAnnotation(annotation);
if (!result.ok) return;             // sync guard refused
await result.settled;               // optional: wait for server confirmation
```

For 99% of UI code, the sync `result.ok` check is enough. The toast + `io:refused` event surface server outcomes asynchronously when no caller is watching.

### 3. Preset silent-factory fallback removed

`OSDAnnotations.Preset.fromJSONFriendlyObject(parsedObject, context)` no longer falls back to polygon when `factoryID` is unknown. It now `throw`s an error and surfaces a toast (`Preset uses an unsupported shape "X" and was rejected.`). The bulk preset import path (`PresetManager.import`) catches per-item and continues; one bad preset does not abort the whole import.

### 4. Manual history pushes replaced by auto-history

`promoteHelperAnnotation`, `deleteAnnotation`, `replaceAnnotation`, and `changeAnnotationPreset` previously called `APPLICATION_CONTEXT.history.push(...)` / `.pushExecuted(...)` directly. They now pass `inverseApply` to `annotationResource.create / update / delete`, and the IO pipeline pushes the history entry automatically (see "Auto-history" in [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md)). Net effect: same undo/redo behavior, but a sink bound to `crud:annotation` participates in the replay (with `meta.fromUndo / meta.fromRedo` flags sinks can opt out of via `accepts(ctx)`).

---

## How to migrate listener code

### Pattern: replacing `addHandler('annotation-before-X', …)`

**Before:**
```js
fabric.addHandler('annotation-before-delete', e => {
    if (currentUser.role !== 'admin') {
        e.setCancelled(true);
    }
});
```

**After:**
```js
IO_PIPELINE.registerGuard({
    ownerId: 'my-plugin',
    resource: 'annotation',
    direction: 'pre-delete',
    handler: () => currentUser.role === 'admin'
        ? { ok: true }
        : {
            ok: false, refused: true,
            reason: 'non-admin attempted delete',
            userMessage: 'Only admins can delete annotations.',
            code: 'W_PERM_DENIED',
          },
});
```

The pipeline shows the toast automatically (`userMessage`), emits `io:refused` on `VIEWER_MANAGER`, and the user-driven `deleteAnnotation` call returns `false` so the caller can roll back UI state.

### Pattern: filtering on `meta.kind`

`annotation-before-edit`, `annotation-before-preset-change`, `annotation-before-replace`, and `annotation-before-replace-doppelganger` all map to `direction: "pre-update"`. To replicate the original event's specificity, filter on `ctx.meta.kind`:

| Old event | `ctx.direction` | `ctx.meta.kind` |
|---|---|---|
| `annotation-before-edit`                 | `pre-update` | `"edit-start"` |
| `annotation-before-preset-change`        | `pre-update` | `"preset-change"` |
| `annotation-before-replace`              | `pre-update` | `"replace"` |
| `annotation-before-replace-doppelganger` | `pre-update` | `"replace-doppelganger"` |

```js
// e.g. veto only preset changes
IO_PIPELINE.registerGuard({
    ownerId: 'my-plugin',
    resource: 'annotation',
    direction: 'pre-update',
    handler: (ctx, patch) => {
        if (ctx.meta.kind !== 'preset-change') return { ok: true };
        // your check here
    },
});
```

To veto every flavor at once, use `direction: '*'`.

### Pattern: per-viewer scoping

The old events carried `viewer` in their payload. The new context carries `ctx.viewerId` (the OSD viewer's `uniqueId`); filter inside your handler:

```js
handler: (ctx, payload) => {
    if (ctx.viewerId !== thisViewersId) return { ok: true };
    // your check
}
```

### Pattern: confirmation dialog before delete

```js
IO_PIPELINE.registerGuard({
    ownerId: 'confirm-delete-plugin',
    resource: 'annotation',
    direction: 'pre-delete',
    handler: async (ctx) => {
        const confirmed = await Dialogs.confirm('Delete this annotation?', 'Confirm');
        return confirmed ? { ok: true }
                         : { ok: false, refused: true, reason: 'user cancelled' };
    },
});
```

### Pattern: a server-backed live-sync sink

The annotations module declares the `crud:annotation` and `crud:preset` capabilities in its `include.json`. Bind them in your app config (`ENV.client.io`):

```jsonc
"io": {
  "bindings": {
    "annotations": {
      "crud:annotation": ["my-server-sync"]
    }
  },
  "sinkOverrides": {
    "my-server-sync": { "proxy": "cerit", "baseURL": "/api/v1/annotations" }
  }
}
```

Provide a sink implementation in your module (the module composes its own defaults with `IO_PIPELINE.sinkOverrides('my-server-sync')`):

```ts
IO_PIPELINE.registerSink({
    id: 'my-server-sync',
    supports: ['crud'],
    async create(ctx, item) { /* PUT to server, return { ok: true } or refusal */ },
    async update(ctx, patch) { /* … */ },
    async delete(ctx)        { /* … */ },
});
```

Auto-history makes the server stay in lockstep with undo/redo: undoing a delete fires `create` on the server (with `ctx.meta.fromUndo === true`); redoing it fires `delete` again. To opt out of replays, add `accepts(ctx) { return !ctx.meta.fromUndo && !ctx.meta.fromRedo; }`.

---

## What did NOT change

These are preserved so existing listeners and integrations keep working:

### Post-action events (unchanged)

- `annotation-create`, `annotation-delete`, `annotation-edit`, `annotation-edit-end`
- `annotation-replace`, `annotation-replace-doppelganger`, `annotation-loaded`
- `annotation-preset-change`, `annotation-filter-change`
- `annotations-visibility-changed`, `annotation-selection-changed`
- `annotation-add-comment`, `annotation-delete-comment`, `annotation-set-private`
- All `preset-*` events (`preset-create`, `preset-delete`, `preset-update`, `preset-meta-add`, `preset-meta-remove`, `preset-select`)
- All layer events (`active-layer-changed`, `layer-selection-changed`, `layer-objects-changed`, `layer-visibility-changed`)
- Visual / IO events (`visual-property-changed`, `import`, `export`, `export-partial`)

### Subsystems (unchanged)

- The **Convertor** layer (`modules/annotations/convert/*`) — pure format encode/decode.
- The **HistoryProvider** registered via `APPLICATION_CONTEXT.history.registerProvider` — its delegate-based `canUndo / canRedo` gating still works exactly as before.
- The plugin's user-facing **export/import** buttons (`plugins/annotations/methods/io.mjs`) — they use `fabric.export()` / `fabric.import()`, both of which sit on top of the Convertor layer.
- **Bulk-import path** (`addAnnotationsBulk`, `_loadObjects`, the `importBundle` IO hook) — bulk import does NOT fire per-item CRUD. The owner's `importBundle` hook applies the whole set in one call. This avoids "bulk-fetched data immediately syncs back to the server" loops.
- The private `_deleteAnnotation`, `_promoteHelperAnnotation`, `_replaceAnnotation`, `_addAnnotation` — unchanged shape, used by undo callbacks, edit-cancel paths, and bulk delete (`deleteObject`). They bypass the resource pipeline by design.

---

## Known follow-ups

These would extend the migration further; nothing in this list blocks the existing functionality:

- **Preset CRUD wrapping**: `presets.js` `addPreset / removePreset / updatePreset` are NOT yet routed through `presetResource.create / delete / update`. Today the `presetResource.validate` runs only on bulk *import* (via `Preset.fromJSONFriendlyObject`). Wrapping the three methods would activate per-item preset CRUD when admin binds `crud:preset`, plus auto-history if `inverseApply` is supplied. The wrapping is straightforward but changes their return types (sync → `Promise`); deferring until needed.
- **freeFormTool external callers**: `freeFormTool.js` is now `async` end-to-end. Its callers from fabric mouse handlers fire-and-forget the resulting promises, which is fine for OSD event handlers (it doesn't await them).
- **objectAdvancedFactories**: `recalculate` and `translate` use `void this._context.fabric.replaceAnnotation(…)` to discard the new async promise rather than propagating async into the factory API. The local canvas swap completes one microtask after the call returns; visible behavior is unchanged. If you want guards to be able to abort factory-driven transformations, await the call instead.

---

## Quick checklist for adapting an existing plugin

1. Search for `addHandler('annotation-before-` and `addFabricHandler('annotation-before-`. For each hit, port to `IO_PIPELINE.registerGuard(...)` per the table above.
2. Search for `setCancelled(true)`. Each call site becomes `return { ok: false, refused: true, reason, userMessage }` from the guard handler.
3. If you call any of the five `async` methods listed in §2, decide whether you need to `await` the result or fire-and-forget. Mouse-event handlers can fire-and-forget; sequencing logic should `await`.
4. If your plugin imports presets with custom `factoryID`s, ensure the factories are registered before import, OR register a `pre-create` guard on the `preset` resource that rewrites unknown factory ids to a known substitute.
5. If you maintain a server-side annotation store, expose it as a sink (`IO_PIPELINE.registerSink({ id, supports: ['crud'], create, read, update, delete })`) and bind it in `ENV.client.io.bindings.annotations.crud:annotation`. Auto-history will keep the server in sync with undo/redo automatically.

---

## See also

- [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md) — full design of the IO pipeline (capabilities, sinks, bindings, guards, auto-history, KV storage).
- [`src/EVENTS.md`](../../src/EVENTS.md) — `io:refused`, `io:rejected-by-accepts`, `io:fully-refused` events.
- [`src/AGENTS.md`](../../src/AGENTS.md) — quick API reference for plugin authors.
