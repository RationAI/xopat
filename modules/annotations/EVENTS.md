# Events in OSD Annotations

##### factory-registered | e: `{factory: OSDAnnotations.AnnotationObjectFactory}`

##### visual-property-changed | ``{[name]: any}``
Common visual property changed.

##### osd-interactivity-toggle

##### enabled | ``{isEnabled: boolean}``

##### layer-added 

##### layer-removed

##### annotation-create | ``{object: fabric.Object}``
Fires when annotation object is created. This does not apply when
``annotation-replace`` is called - in that case, the replacement is
considered as the creation.

##### annotation-before-create | ``{object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void}``
This event is fired prior to inserting any annotation, including promotion (simple helper annotation creation is not affected).
`isCancelled` can be called to check if the deletion was already requested to be cancelled (by another plugin/module for example)
`setCancelled` can be used to request to cancel the deletion

##### annotation-delete | ``{object: fabric.Object}``

##### annotation-before-delete | ``{object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void}``
This event is fired prior to deleting any annotation.
`isCancelled` can be called to check if the deletion was already requested to be cancelled (by another plugin/module for example)
`setCancelled` can be used to request to cancel the deletion

##### annotation-replace | ``{previous: fabric.Object, next: fabric.Object}``
This event is fired when annotation is replaced, e.g. free-form-tool edit. Such edits
in fact replace annotation with a new one, although the annotation identity as perceived
by the user remains the same. This event is called only once per update, 
at the end.

##### annotation-before-replace | ``{object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void}``
This event is fired prior to replacing annotation. Same usage as `annotation-before-delete`

##### annotation-replace-doppelganger | ``{previous: fabric.Object, next: fabric.Object}``
This event is fired when annotations are replaced, but only temporarily (e.g. via free form tool).
It can be called several times during one edit action.

##### annotation-before-replace-doppelganger | ``{object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void}``
This event is fired prior to replacing doppelganger annotation. Same usage as `annotation-before-delete`

##### annotation-edit | ``{object: fabric.Object}``
This event is fired when user performs direct annotation editing.

##### annotation-before-edit | ``{object: fabric.Object, isCancelled: () => boolean, setCancelled: (cancelled: boolean) => void}``
This event is fired prior to editing annotation. Same usage as `annotation-before-delete`

##### annotation-set-private | ``{object: fabric.Object}``
This event is fired when the `private` property of an annotation changes.

##### annotation-add-comment | ``{object: fabric.Object, comment: AnnotationComment}``
This event is fired when a comment is added, one by one.
```ts
type AnnotationComment = {
  id: string;
  author: {
    id: string;
    name: string;
  };
  content: string;
  createdAt: Date;
  removed?: boolean;
}
```

##### annotation-delete-comment | ``{object: fabric.Object, commentId: string}``
This event is fired when a comment is deleted, one by one.

##### comments-control-clicked
This event is fired when user clicks the control for comments

##### author-annotation-styling-toggle | ``{enable: boolean}``
This event is fired when preference for per-author property styling changes

##### preset-delete | ``{preset: OSDAnnotations.Preset}``

##### preset-create | ``{preset: OSDAnnotations.Preset}``

##### preset-update | ``{preset: OSDAnnotations.Preset}``

##### preset-select | ``{preset: OSDAnnotations.Preset, isLeftClick:boolean}``

##### preset-meta-remove | ``{preset: OSDAnnotations.Preset, key: string}``

##### preset-meta-add | ``{preset: OSDAnnotations.Preset, key: string}``

##### annotation-preset-change | ``{object: fabric.Object, presetID: string, oldPresetID: string}``

##### annotation-before-preset-change
This event is fired prior to changing annotation preset. Same usage as `annotation-before-delete`

##### history-select | ``{incrementId: number, originalEvent: MouseEvent}``

##### import | ``{options: object, clear: boolean, data: object}``

##### export-partial | ``{options: object, data: object}``

##### export | ``{data: string}``

#### mode-changed | ``{mode: OSDAnnotatinos.AnnotationState}``

##### history-open | ``{inNewWindow: boolean, containerId: null|string}``
If history is opened in detached (new) window, the contained ID is null:
the DOM does not belong to this context. The container

##### history-swap | ``{inNewWindow: boolean}``

##### history-close | ``{inNewWindow: boolean}``

#### history-change

##### canvas-nonprimary-release-not-handled
Called when the annotation modes did not handle mouse release action.

##### canvas-release-not-handled
Called when the annotation modes did not handle mouse release action.

Fires ``warn-user``, ``error-user`` and `warn-system` on the viewer instance.
