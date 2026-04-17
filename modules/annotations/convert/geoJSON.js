OSDAnnotations.Convertor.register("geo-json", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'GeoJSON Annotations';
    static description = 'Annotations in GeoJSON format.';

    static getSuffix() {
        return 'xo.geo.json';
    }

    static includeAllAnnotationProps = false;

    //linear ring has the first and last vertex equal, geojson uses arrays
    _asGEOJsonFeature(object, type="Polygon", deleteProps=[], asLinearRing=false) {
        const factory = this.context.module.getAnnotationObjectFactory(object.factoryID);
        const poly = factory?.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withArrayPoint, fabric.Object.NUM_FRACTION_DIGITS)
        if (poly?.length > 0) {
            if (asLinearRing) { //linear ring

                if (object.factoryID === "multipolygon") {
                    poly.forEach(ring => ring.push(ring[0]));
                } else {
                    poly.push(poly[0]);
                }
            }
            const props = factory.copyNecessaryProperties(object);
            for (let p of deleteProps) delete props[p];
            return {
                geometry: {
                    type: type,
                    coordinates: poly
                },
                properties: props
            }
        }
        //failure
        return {
            geometry: {
                type: "Point",
                coordinates: []
            },
            properties: {}
        }
    }

    //we use objects for points, we do not repeat the last point for closed items
    _toNativeRing(list, isClosed=true) {
        if (isClosed) list.splice(-1, 1);
        return list.map(o => ({x: o[0], y: o[1]}));
    }

    _getAsNativeObject(imported, geometryConvertor=()=>{}) {
        const result = imported.properties;
        geometryConvertor(result, imported.geometry.coordinates);
        return result;
    }

    //encode all supported factory types
    //todo support default object by export strategy
    encoders = {
        "rect": (object, preset) => {
            const res = this._asGEOJsonFeature(object, preset, "Polygon", [], true);
            res.geometry.coordinates = [res.geometry.coordinates]; //has to be nested, the first array is the outer linear ring
            return res;
        },
        "ellipse": (object, preset) => {
            const res = this._asGEOJsonFeature(object, preset, "Polygon", [], true);
            res.geometry.coordinates = [res.geometry.coordinates]; //has to be nested, the first array is the outer linear ring
            return res;
        },
        "polygon": (object) => {
            const res = this._asGEOJsonFeature(object, "Polygon", ["points"], true);
            res.geometry.coordinates = [res.geometry.coordinates]; //has to be nested, the first array is the outer linear ring
            return res;
        },
        "multipolygon": (object) => {
            const res = this._asGEOJsonFeature(object, "Polygon", ["points"], true);
            return res;
        },
        "polyline": (object) => this._asGEOJsonFeature(object, "LineString", ["points"], false),
        "point": (object) => {
            object = this._asGEOJsonFeature(object, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
            return object;
        },
        "text": (object) => {
            object = this._asGEOJsonFeature(object, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
            return object;
        },
        "ruler": (object) => {
            const factory = this.context.module.getAnnotationObjectFactory(object.factoryID);
            const converter = OSDAnnotations.AnnotationObjectFactory.withArrayPoint;
            return {
                geometry: {
                    type: "LineString",
                    coordinates: factory?.toPointArray(object, converter, fabric.Object.NUM_FRACTION_DIGITS)
                },
                properties: factory.copyNecessaryProperties(object, [], true)
            };
        },
    };

    //decode all supported factory types if factoryID present
    //todo support default object by export strategy
    nativeDecoders = {
        "rect": (object) => this._getAsNativeObject(object),
        "ellipse": (object) => this._getAsNativeObject(object),
        "polygon": (object) => this._getAsNativeObject(object,
            (object, geometry) => object.points = this._toNativeRing(geometry[0] || [])),
        "multipolygon": (object) => this._getAsNativeObject(object,
            (object, geometry) => object.points = geometry.map(ring => this._toNativeRing(ring))),
        "polyline": (object) => this._getAsNativeObject(object,
            (object, geometry) => object.points = this._toNativeRing(geometry, false)),
        "point": (object) => this._getAsNativeObject(object, (object, geometry) => {
            //todo not necessary? left/top are already probably present in props
            object.left = geometry[0];
            object.top = geometry[1];
            return object;
        }),
        "text": (object) => this._getAsNativeObject(object, (object, geometry) => {
            //todo not necessary? left/top are already probably present in props
            object.left = geometry[0];
            object.top = geometry[1];
            return object;
        }),
        "ruler": (object) => this._getAsNativeObject(object),
    };

    // todo support unpacking like qupath does
    _decodeMulti(object, type) {
        let result = {};
        //for now we do not make use of Multi* so this has to be external GeoJSON
        result.objects = object.coordinates.map(g => this.decoders[type]({ coordinates: g, type: type }));
        result.factoryID = "group";
        result.type = "group";
        return result;
    }

    //decode all unsupported geometries
    decoders = {
        Point: (object) => {
            let props = {};
            props.factoryID = "point";
            props.type = "ellipse";
            props.left = object.coordinates[0];
            props.top = object.coordinates[1];
            return props;
        },
        MultiPoint: (object) => this._decodeMulti(object, "Point"),
        LineString: (object) => {
            let props = {};
            props.factoryID = "polyline";
            props.type = "polyline";
            props.points = this._toNativeRing(object.coordinates, false);
            return props;
        },
        MultiLineString: (object) => this._decodeMulti(object, "LineString"),
        Polygon: (object) => {
            let props = {};
            const rings = object.coordinates.map(ring => this._toNativeRing(ring));

            if (rings.length > 1) {
                //polygon with holes
                props.factoryID = "multipolygon";
                props.type = "path";
                props.points = rings;
            } else {
                props.factoryID = "polygon";
                props.type = "polygon";
                props.points = rings[0];
            }
            return props;
        },
        MultiPolygon: (object) => this._decodeMulti(object, "Polygon"), //multiple polygons
        GeometryCollection: (object) => {
            let result = {};
            //for now we do not make use of Multi* so this has to be external GeoJSON
            result.objects = object.geometries.map(g => this.decoders[g.type]?.(g)).filter(x => x);
            result.factoryID = "group";
            result.type = "group";
            return result;
        },
    }

    static encodeFinalize(output) {
        let result = {
            type: "FeatureCollection",
            features: []
        };
        let list = result.features;

        if (Array.isArray(output.objects)) {
            for (let obj of output.objects) {
                const data = typeof obj === "string" ? JSON.parse(obj) : obj;
                list.push(data);
            }
        }

        if (Array.isArray(output.presets)) {
            for (let obj of output.presets) {
                const data = typeof obj === "string" ? JSON.parse(obj) : obj;
                list.push(data);
            }
        }
        return JSON.stringify(result);
    }

    async encodePartial(annotationsGetter, presetsGetter) {
        const result = {};
        if (this.options.exportsObjects) {
            const annotations = annotationsGetter();
            if (Array.isArray(annotations)) {
                result.objects = [];
                // for each object (annotation) create new annotation element with coresponding coordinates
                for (let obj of annotations) {
                    if (!obj.factoryID || obj.factoryID.startsWith("_")) {
                        continue;
                    }

                    // noinspection JSUnresolvedVariable
                    if (Number.isInteger(obj.presetID) || (typeof obj.presetID === "string" && obj.presetID !== "")) {
                        let encoded = this.encoders[obj.factoryID]?.(obj);
                        if (encoded) {
                            encoded.type = "Feature";
                            result.objects.push(this.options.serialize ? JSON.stringify(encoded) : encoded);
                        }
                    }
                }
            }
        }

        if (this.options.exportsPresets) {
            const presets = presetsGetter();
            if (Array.isArray(presets)) {
                result.presets = presets.map(p => this.options.serialize ? JSON.stringify({
                    type: "Feature",
                    geometry: null,
                    properties: p
                }) : {
                    type: "Feature",
                    geometry: null,
                    properties: p
                });
            }
        }
        return result;
    }

    async decode(data) {
        data = JSON.parse(data);

        const parseFeature = function (object, presets, annotations) {
            if (object.geometry === null && object.properties.presetID) {
                //null features not part of our preset API ignored
                const preset = object.properties;
                presets[preset.presetID] = preset;
            } else {
                // todo try to detect & map onto existing presets in the system
                let result;
                const type = object.properties["factoryID"] || object.properties["type"];
                if (type) result = this.nativeDecoders[type]?.(object);
                if (!result) {
                    //not a native object, parse as well as possible
                    result = this.decoders[object.geometry.type]?.(object.geometry);
                    if (result) $.extend(result, object.properties); //attach properties for partial compatibility
                }

                if (result) {
                    annotations.push(result);
                } //todo else notify?
            }
        }.bind(this);

        const presets = {}, annotations = [];

        if (data.type === "FeatureCollection") {
            data.features.forEach(f => parseFeature(f, presets, annotations));
        } else if (data.type === "Feature") {
            parseFeature(data, presets, annotations);
        } else {
            const o = this.decoders[data.type]?.(data);
            if (!o) throw "Unsupported global GEOJson Text Type " + data.type;
            annotations.push(o);
        }

        return {
             objects: annotations,
             presets: Object.values(presets)
        };
    }
});
