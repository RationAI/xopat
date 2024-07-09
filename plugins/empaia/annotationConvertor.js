EmpationAPI.integrateWithAnnotations = function (annotationsModule) {
    //todo check if registered

    annotationsModule.forceExportsProp = "npp_created";
    annotationsModule.addHandler('annotation-create', o => {
        //todo test if hiding scalebar does not affect this
        o.npp_created = VIEWER.scalebar.currentResolution();
    });

    OSDAnnotations.Convertor.register("empaia", class extends OSDAnnotations.Convertor.IConvertor {
        static title = 'Empaia Annotations';
        static description = 'Annotations Following Empaia Standard';

        constructor(annotationsModule, options) {
            super(annotationsModule, options);
            this.empaia = EmpationAPI.V3.get();
        }

        static getSuffix() {
            return '.json';
        }

        checkPreconditions() {
            if (!this.empaia?.defaultScope) {
                throw "Cannot encode annotations to 'empaia' without a valid default scope!"
            }

            const tiledImage = VIEWER.scalebar.getReferencedTiledImage();
            if (!tiledImage || !(tiledImage.source instanceof OpenSeadragon.EmpationAPIV3TileSource)) {
                throw "Cannot encode annotations to 'empaia' when the target WSI does not come from Empaia system!"
            }
        }

        static encodeFinalize(output) {
            let result = {};

            if (Array.isArray(output.objects)) {
                result.item_count = output.objects.length;
                result.items = output.objects.map(obj => typeof obj === "string" ? JSON.parse(obj) : obj);
            }

            if (Array.isArray(output.presets)) {
                result.presets = output.presets.map(obj => typeof obj === "string" ? JSON.parse(obj) : obj);
            }
            return JSON.stringify(result);
        }

        async encodePartial(annotationsGetter, presetsGetter) {
            this.checkPreconditions();

            const result = {};
            const empaiaTiledImage = VIEWER.scalebar.getReferencedTiledImage();

            //todo consider moving this iteration wrap to the parent class, just call serialization on each object
            const annotations = annotationsGetter();
            if (this.options.exportsObjects && Array.isArray(annotations)) {
                result.objects = [];
                // for each object (annotation) create new annotation element with corresponding coordinates
                for (let i = 0; i < annotations.length; i++) {
                    let obj = this.encodeSingleObject(annotations[i], empaiaTiledImage.source);
                    if (obj) result.objects.push(obj);
                }
            }

            if (this.options.exportsPresets) {
                const presets = presetsGetter();
                if (Array.isArray(presets)) {
                    //presets are not supported by empaia, we use custom object
                    result.presets = this.options.serialize ? presets.map(JSON.stringify) : presets;
                }
            }
        }

        async decode(data) {
            this.checkPreconditions();
            data = JSON.parse(data);

            return {
                objects: data.items.map(obj => this.decoders[obj.type](obj)),
                presets: data.presets
            };
        }

        encodeSingleObject(obj, tileSource) {
            if (!obj.factoryID || obj.factoryID.startsWith("_")) {
                return null;
            }

            if (Number.isInteger(obj.presetID) || (typeof obj.presetID === "string" && obj.presetID !== "")) {
                let encoded = this.encoders[obj.factoryID]?.(obj, this.context.presets.get(obj.presetID), tileSource);
                if (encoded) {
                    return this.options.serialize ? JSON.stringify(encoded) : encoded;
                }
            }
        }

        decoders = {
            //todo add support for arrows
            "arrow": (object) => ({
                id: object.id,
                factoryID: "polygon",
                type: "polygon",
                points: [object.head, object.tail]
            }),
            "rectangle": (object) => ({
                id: object.id,
                factoryID: "rect",
                type: "rect",
                width: object.width,
                height: object.height,
                left: object.upper_left[0],
                top: object.upper_left[1],
            }),
            "circle": (object) => ({
                id: object.id,
                factoryID: "ellipse",
                type: "ellipse",
                rx: object.radius,
                ry: object.radius,
                left: object.center[0] - object.rx,
                top: object.center[1] - object.ry,
            }),
            "polygon": (object) => ({
                id: object.id,
                factoryID: "polygon",
                type: "polygon",
                points: object.coordinates
            }),
            "line": (object) => ({
                id: object.id,
                factoryID: "polygon",
                type: "polygon",
                points: object.coordinates
            }),
            "point": (object) => ({
                id: object.id,
                factoryID: "point",
                type: "ellipse",
                left: object.coordinates[0],
                top: object.coordinates[1]
            }),
        }

        _encodeAsEmpaiaObject(object, preset, tileSource, props) {
            //todo encode type and try to recover? ruler, text...
            return {
                id: object.id,
                name: preset.meta.category?.value,
                description: this.context.getAnnotationDescription(object),
                creator_type: "scope",
                creator_id: this.empaia.defaultScope.id,
                reference_type: "wsi",
                reference_id: tileSource.getEmpaiaId(),
                npp_created: object.npp_created,
                ...props
            }
        }

        _encodeAsEmpaiaPolygonLike(type, object, preset, tileSource, coordsTransformer = null) {
            const factory = this.context.getAnnotationObjectFactory(object.factoryID);
            if (!factory) return null;

            // empaia supports only integer coords
            const poly = factory.toPointArray(object,
                OSDAnnotations.AnnotationObjectFactory.withArrayPoint, 0);
            //todo encode type and try to recover? ruler, text...
            return this._encodeAsEmpaiaObject(object, preset, tileSource, {
                type: type,
                coordinates: coordsTransformer ? coordsTransformer(poly) : poly
            })
        }

        encoders = {
            "rect": (object, preset, tileSource) => {
                return this._encodeAsEmpaiaObject(object, preset, tileSource, {
                    type: "rectangle",
                    upper_left: [Math.round(object.left), Math.round(object.top)],
                    width: Math.round(object.width),
                    height: Math.round(object.height),
                });
            },
            "ellipse": (object, preset, tileSource) => {
                //we have two options, we will convert to a polygon since empaia has only circle
                if (Math.abs(object.rx - object.ry) < 0.1) {
                    return this._encodeAsEmpaiaObject(object, preset, tileSource, {
                        type: "circle",
                        center: [Math.round(object.left + object.rx), Math.round(object.top + object.rx)],
                        radius: Math.round(object.rx),
                    });
                }
                return this._encodeAsEmpaiaPolygonLike("polygon", object, preset, tileSource);
            },
            "polygon": (object, preset, tileSource) => {
                return this._encodeAsEmpaiaPolygonLike("polygon", object, preset, tileSource);
            },
            // todo polygon not really nice :/
            "polyline": (object, preset, tileSource) => this._encodeAsEmpaiaPolygonLike("polygon", object, preset, tileSource),
            "point": (object, preset, tileSource) => this._encodeAsEmpaiaPolygonLike("point", object, preset, tileSource, x => x[0]),
            "text": (object, preset, tileSource) => this._encodeAsEmpaiaPolygonLike("point", object, preset, tileSource, x => x[0]),
            "ruler": (object, preset, tileSource) => this._encodeAsEmpaiaPolygonLike("line", object, preset, tileSource),
        };
    });
}
