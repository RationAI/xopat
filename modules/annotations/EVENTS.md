# Events in OSD Annotations

##### factory-registered | e: `{factory: OSDAnnotations.AnnotationObjectFactory}`

##### opacity-changed | ``{opacity: float}``

##### osd-interactivity-toggle

##### enabled | ``{isEnabled: boolean}``

##### layer-added 

##### layer-removed

##### annotation-create | ``{object: fabric.Object}``

##### annotation-delete | ``{object: fabric.Object}``

##### annotation-replace | ``{previous: fabric.Object, next: fabric.Object}``

##### annotation-edit | ``{object: fabric.Object}``

##### preset-delete | ``{preset: OSDAnnotations.Preset}``

##### preset-create | ``{preset: OSDAnnotations.Preset}``

##### preset-update | ``{preset: OSDAnnotations.Preset}``

##### preset-select | ``{preset: OSDAnnotations.Preset, isLeftClick:boolean}``

##### preset-meta-remove | ``{preset: OSDAnnotations.Preset, key: string}``

##### preset-meta-add | ``{preset: OSDAnnotations.Preset, key: string}``

##### import | ``{options: object, clear: boolean, data: object}``

##### export-partial | ``{options: object, data: object}``

##### export | ``{data: string}``

#### mode-changed | ``{mode: OSDAnnotatinos.AnnotationState}``

##### history-open | ``{inNewWindow: boolean, containerId: null|string}``
If history is opened in detached (new) window, the contained ID is null:
the DOM does not belong to this context. The container

##### history-swap | ``{inNewWindow: boolean}``

##### history-close | ``{inNewWindow: boolean}``

##### canvas-nonprimary-release

##### canvas-release

Fires ``warn-user``, ``error-user`` and `warn-system` on the viewer instance.
