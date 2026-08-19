# Events

`OSDAnnotations` emits a small set of module-level events.
Per-viewer annotation events are emitted on `OSDAnnotations.FabricWrapper`.

To listen to viewer-scoped events from the global module, use:

    OSDAnnotations.instance().addFabricHandler(eventName, handler)

## Global events (`OSDAnnotations`)

##### `factory-registered` | `{ factory: OSDAnnotations.AnnotationObjectFactory }`
Raised when a factory is registered at runtime.

##### `osd-interactivity-toggle`
No payload.

##### `enabled` | `{ isEnabled: boolean }`
Raised when annotation mode is enabled or disabled.

##### `annotation-board-save-request` | `{ viewer?: OpenSeadragon.Viewer }`
Raised when annotation board state should be persisted.
When emitted from a specific `FabricWrapper`, the payload contains `{ viewer }`.
When emitted from module-level keyboard handling, the payload may be omitted.

##### `author-annotation-styling-toggle` | `{ enable: boolean }`
Raised when per-author styling is enabled or disabled.

##### `free-form-tool-mode-add` | `{ isModeAdd: boolean }`
Raised when the free-form tool switches between add and subtract mode.

##### `free-form-tool-radius` | `{ radius: number }`
Raised when the free-form brush radius changes.

##### `comments-control-clicked`
No payload.
Raised when the comments control on an annotation is clicked.

##### `save-annotations` | `{ setHandled: (message: string) => void, stopPropagation: () => string | undefined }`
This event is requested by calling `requestExport()`.

A handler that performs the export should call:

    e.setHandled("your message")

to mark the request as handled.

##### `preset-create` | `{ preset: OSDAnnotations.Preset }`

##### `preset-delete` | `{ preset: OSDAnnotations.Preset }`

##### `preset-update` | `{ preset: OSDAnnotations.Preset }`

##### `preset-select` | `{ preset: OSDAnnotations.Preset | undefined, isLeftClick: boolean }`

##### `preset-meta-add` | `{ preset: OSDAnnotations.Preset, key: string }`
Custom metadata is key-addressed, and keys round-trip through export/import verbatim.
Program-owned fields should therefore pass their own stable key —
`presets.addCustomMeta(id, name, value, key)` — and read back with
`preset.getMetaValue(key)` / `preset.getMetaName(key)`. Writing an existing key updates the
field in place (no duplicate rows) and raises `preset-update` instead of `preset-meta-add`.
The key is generated only when omitted, which is the user-typed row case: the UI keeps the
returned key alive with the row it renders.

##### `preset-meta-remove` | `{ preset: OSDAnnotations.Preset, key: string }`

##### `preset-vocabulary-changed` | `{ vocabulary: object | undefined }`
Raised by `presets.setVocabulary(...)` and by its disposer. `undefined` means classes are
again unconstrained. UI that offers class creation must re-render on this: with a
vocabulary whose `allowFreeform` is false, a free-text class field is a control the user
cannot succeed with — the `crud:preset` guard refuses anything outside `vocabulary.values`.
Read `presets.unusedVocabularyEntries()` for what a picker should still offer, and create
through `presets.addVocabularyPreset(classValue)` so the preset and its class land in one
dispatch.

##### `import` | `{ owner: OSDAnnotations.FabricWrapper, options: object, clear: boolean, data: object | object[] | null }`
Raised after import completes or import input is rejected.
`data` is `null` when nothing was imported.

##### `export-partial` | `{ options: object, data: object, owner: OSDAnnotations.FabricWrapper }`

##### `export` | `{ data: string, owner: OSDAnnotations.FabricWrapper }`

##### `mode-changed` | `{ mode: OSDAnnotations.AnnotationState }`

##### `annotation-sync-failed` | `{ itemId?: string, direction: string, kind?: string, object?: fabric.Object, result: IOResult }`
A bound `crud:annotation` sink refused a write. The pipeline has already toasted it, and unless
the call opted out it has also been rolled back — this event exists so UI that *mirrors* an
annotation (the board, a plugin's list) can stop showing it as saved or in-flight. Subscribe here
rather than to raw `io:refused`, so consumers do not each re-derive which dispatches were ours.

##### `annotation-sync-reverted` | `{ itemId?: string, direction: string, kind?: string, object?: fabric.Object, result: IOResult }`
The post-commit rollback for such a refusal actually ran: the call's `inverseApply` restored the
previous state and its history entry was dropped.

---

## Viewer events (`OSDAnnotations.FabricWrapper`)
The viewer-scoped events are emitted on contextualized instance of particular
canvas that belongs to a specific viewer.

##### `annotation-loaded` | `{ viewer: OpenSeadragon.Viewer, clear: boolean, reason: 'import' | 'load-objects' }`
Raised when the annotations were imported/loaded in a bigger chunk.

##### `annotation-board-save-request` | `{ viewer: OpenSeadragon.Viewer }`

##### `active-layer-changed` | `{ layer: OSDAnnotations.Layer | undefined }`

##### `layer-selection-changed` | `{ selected: OSDAnnotations.Layer[], deselected: OSDAnnotations.Layer[] }`

##### `layer-added` | `{ layer: OSDAnnotations.Layer }`

##### `layer-removed` | `{ layer: OSDAnnotations.Layer }`

##### `layer-objects-changed` | `{ layerId: string }`
Raised after loading/import changes the object set of a layer.

##### `annotation-selection-changed` | `{ selected: fabric.Object[], deselected: fabric.Object[], fromCanvas: boolean }`

##### `annotation-before-create` | `{ object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void }`
Cancelable event raised before promoting/inserting an annotation.

##### `annotation-create` | `{ object: fabric.Object }`

##### `annotation-before-delete` | `{ object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void }`
Cancelable event raised before deleting an annotation.

##### `annotation-delete` | `{ object: fabric.Object }`

##### `annotation-before-replace` | `{ object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void }`
Cancelable event raised before replacing one full annotation with another.

##### `annotation-replace` | `{ previous: fabric.Object, next: fabric.Object, boardIndex: number | undefined }`
Raised after a full annotation replacement finishes.

#### `annotation-edit`, `annotation-before-edit`, `annotation-edit-end`
Edit lifecycle events, todo: docs.

##### `annotation-before-replace-doppelganger` | `{ object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void }`
Cancelable event raised before a temporary doppelganger swap.

##### `annotation-replace-doppelganger` | `{ previous: fabric.Object, next: fabric.Object }`
Raised for temporary swaps used during interactive editing such as free-form editing.


##### `annotation-before-preset-change` | `{ object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void }`
Cancelable event raised before changing an annotation preset.

##### `annotation-preset-change` | `{ object: fabric.Object, presetID: string, oldPresetID: string }`

##### `annotation-set-private` | `{ object: fabric.Object }`

##### `annotation-readonly-change` | `{ object: fabric.Object, readOnly: boolean }`
An annotation was marked read-only, or released. A read-only annotation may be selected,
inspected and commented on, but every `pre-update` / `pre-delete` for it is refused by the
module's own IO guard (`W_ANNOTATION_READONLY`) and it renders locked. Distinct from `private`, which controls export.
Set it with `fabric.setAnnotationReadOnly(object, value)`, or carry it in from a convertor
(`empaia-workbench` marks job-produced annotations this way).

##### `annotation-persisted` | `{ object: fabric.Object, id: string, previous?: fabric.Object, previousIncrementId?: string|number, result: IOResult }`
A bound `crud:annotation` sink stored the annotation and returned a destination-assigned id.
Raised only for a real round-trip (not for coalesced or refused ops), and it is the only place
an integration can learn the server id of an object the user just drew. `previous` is set when
a replace changed the identity the dispatch was keyed by. The id is also echoed on
`object.serverId` — deliberately *not* part of the export whitelist, since an id minted by one
deployment means nothing in another; an integration that needs it persisted registers its own
carrier property (see `module.registerPersistedProperties`).

##### `annotation-add-comment` | `{ object: fabric.Object, comment: AnnotationComment }`
Comments piggyback on the annotation object (`annotation.comments[]`). Adding/removing a comment
now dispatches through `annotationResource.update` (a `{ comments }` patch), so a bound
`crud:annotation` sink receives it in realtime and the change is undoable — raised from inside the
resource's `apply`. Both events also fire on undo/redo (add's inverse re-raises delete and vice versa).

##### `annotation-delete-comment` | `{ object: fabric.Object, commentId: string }`

##### `visual-property-changed` | `{ visuals: OSDAnnotations.CommonAnnotationVisuals }`


##### `nonprimary-release-not-handled` | `{ originalEvent: Event, pressTime: number }`
Raised when the current mode does not handle a non-primary button release.

##### `canvas-release` | `{ originalEvent: Event, pressTime: number }`
Raised when the current mode does not handle a primary-button release.

---

### `AnnotationComment`

    type AnnotationComment = {
      id: string;
      author: {
        id: string;
        name: string;
      };
      reference: string;
      content: string;
      replyTo?: string;
      createdAt: number;
      modifiedAt: number;
      removed?: boolean;
    }

---

### Notes (v2 -> v3)
- `history-select`, `history-open`, `history-swap`, `history-close` events are not supported - rely on global app history events.
- `canvas-nonprimary-release-not-handled` is replaced by `nonprimary-release-not-handled`, and `canvas-release-not-handled` not supported
- `active-layer-changed` now returns the actual `layer` object, not `{ id }`.
- `layer-selection-changed` now returns `{ selected, deselected }`, not `{ ids, isSelected }`.
- `annotation-selection-changed` now returns `{ selected, deselected, fromCanvas }`, not `{ ids, isSelected, fromCanvas }`.
- `annotation-delete-comment` currently emits `{ commentId }`, not the full comment object.