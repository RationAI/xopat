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

##### preset-meta-remove | ``{preset: OSDAnnotations.Preset, key: string}``

##### preset-meta-add | ``{preset: OSDAnnotations.Preset, key: string}``

##### import | ``{format: string, clear: boolean, data: object}``


Fires ``warn-user``, ``error-user`` and `warn-system` on the viewer instance.