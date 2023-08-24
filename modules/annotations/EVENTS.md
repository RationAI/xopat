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

Fires ``warn-user``, ``error-user`` and `warn-system` on the viewer instance.
