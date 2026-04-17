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

##### `preset-meta-remove` | `{ preset: OSDAnnotations.Preset, key: string }`

##### `import` | `{ owner: OSDAnnotations.FabricWrapper, options: object, clear: boolean, data: object | object[] | null }`
Raised after import completes or import input is rejected.
`data` is `null` when nothing was imported.

##### `export-partial` | `{ options: object, data: object, owner: OSDAnnotations.FabricWrapper }`

##### `export` | `{ data: string, owner: OSDAnnotations.FabricWrapper }`

##### `mode-changed` | `{ mode: OSDAnnotations.AnnotationState }`

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

##### `annotation-add-comment` | `{ object: fabric.Object, comment: AnnotationComment }`

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