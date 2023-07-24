OSDAnnotations.Convertor.GeoJSON = class {
    title = 'quPath Annotations';
    description = 'Annotations for quPath (GeoJSON format).';
    offset = undefined;

    static getFileName(context) {
        return 'qu_annotations_' + UTILITIES.todayISO() + '.geojson';
    }

    //todo check polyline enabled, else show warn
    static includeAllAnnotationProps = false;

    //linear ring has the first and last vertex equal, geojson uses arrays, we only for now support arrays of points,
    //no arrays of arrays of points
    _asGEOJsonFeature(object, preset, type="Polygon", deleteProps=[], asLinearRing=false) {

        //https://stackoverflow.com/questions/25831276/turn-array-hex-colors-into-array-rgb-colors
        function hexToRgb(hex) {
            var res = hex.match(/[a-f0-9]{2}/gi);
            return res && res.length === 3 ? res.map(v => parseInt(v, 16)) : null;
        }

        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        let poly = factory?.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
        if (poly?.length > 0) {
            const offset = this.offset;
            if (offset) poly = poly.map(o => ([o[0]-offset.x, o[1]-offset.y]));
            if (asLinearRing) poly.push(poly[0]); //linear ring
            const props = {
                "objectType": "annotation",
                "classification": {
                    "name": preset.meta.category.value,
                    "color": hexToRgb(preset.color)
                }
            };

            //qupath ellipse flag
            if (factory.id === "ellipse") props.isEllipse = true;
            //allow only hex colors
            if (object.fill && preset.color != object.fill && object.fill[0] == "#") props.color = hexToRgb(object.fill);
            if (object.meta?.category && preset.meta.category.value != object.meta.category) props.name = object.meta.category;

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
        const offset = this.offset;
        if (isClosed) list.splice(-1, 1);

        if (offset) return list.map(o => ({x: o[0]+offset.x, y: o[1]+offset.y}));
        return list.map(o => ({x: o[0], y: o[1]}));
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
        "polygon": (object, preset) => {
            const res = this._asGEOJsonFeature(object, preset, "Polygon", ["points"], true);
            res.geometry.coordinates = [res.geometry.coordinates]; //has to be nested, the first array is the outer linear ring
            return res;
        },
        "polyline": (object, preset) => this._asGEOJsonFeature(object, preset, "LineString", ["points"], true),
        "point": (object, preset) => {
            object = this._asGEOJsonFeature(object, preset, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
            return object;
        },
        "text": (object, preset) => {
            object = this._asGEOJsonFeature(object, preset, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
            return object;
        },
        "ruler": (object, preset) => {
            const factory = this.context.getAnnotationObjectFactory(object.factoryID);
            const converter = OSDAnnotations.AnnotationObjectFactory.withArrayPoint;
            const line = object.objects[0];
            //todo bounding box should be exported as well so that coords are not negative without sense
            //todo reimport is imprecise

            //todo preset data
            return {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        converter(line.x1, line.y1),
                        converter(line.x2, line.y2),
                    ]
                },
                properties: factory.copyNecessaryProperties(object, [], true)
            };
        },
    };

    _decodeMulti(object, type) {
        let result = new fabric.Group(object.coordinates.map(g => this.decoders[type]({ coordinates: g, type: type })))
        result.objects = result._objects; //hack, import works without underscore
        result.factoryID = "group";
        return result;
    }

    //decode all unsupported geometries
    decoders = {
        Point: (object) => {
            let factory = OSDAnnotations.instance().getAnnotationObjectFactory("point");
            return factory.create({x: object.coordinates[0], y: object.coordinates[1]}, {});
        },
        MultiPoint: (object) => this._decodeMulti(object, "Point"),
        LineString: (object) => {
            let factory = OSDAnnotations.instance().getAnnotationObjectFactory("polyline");
            return factory.create(this._toNativeRing(object.coordinates, false), {});
        },
        MultiLineString: (object) => this._decodeMulti(object, "LineString"),
        Polygon: (object) => {
            let factory = OSDAnnotations.instance().getAnnotationObjectFactory("polygon");
            return factory.create(this._toNativeRing(object.coordinates[0] || []), {});
        },
        MultiPolygon: (object) => this._decodeMulti(object, "Polygon"),
        GeometryCollection: (object) => {
            let result = new fabric.Group(object.geometries.map(g => this.decoders[g.type]?.(g)).filter(x => x))
            result.factoryID = "group";
            result.objects = result._objects; //hack, import works without underscore
            return result;
        },
    }

    async encode(annotationsGetter, presetsGetter, annotationsModule, options) {
        this.offset = options.bioFormatsOffset;

        this.context = annotationsModule;

        const annotations = annotationsGetter();
        const presets = presetsGetter();

        let output = {
            type: "FeatureCollection",
            features: []
        };
        let list = output.features;

        // for each object (annotation) create new annotation element with coresponding coordinates
        for (let i = 0; i < annotations.length; i++) {
            let obj = annotations[i];
            if (!obj.factoryID || obj.factoryID.startsWith("_")) {
                continue;
            }

            // noinspection JSUnresolvedVariable
            if (Number.isInteger(obj.presetID) || (typeof obj.presetID === "string" && obj.presetID !== "")) {
                let encoded = this.encoders[obj.factoryID]?.(obj, presets.find(p => p.presetID == obj.presetID));
                if (encoded) {
                    encoded.type = "Feature";
                    list.push(encoded);
                }
            }
        }

        return JSON.stringify(output);
    }

    async decode(data, annotationsModule, options) {
        this.offset = options.bioFormatsOffset;

        data = JSON.parse(data);

        function asHexColor(arr) {
            return "#" + arr.map(x => x.toString(16).padStart(2, '0')).join('');
        }

        const parseFeature = function (object, presets, annotations) {
            if (object.geometry === null) {
                throw "Invalid feature! ";
            }

            let result = this.decoders[object.geometry.type]?.(object.geometry);
            //if (result) $.extend(result, object.properties); //attach properties for partial compatibility

            if (result) {
                if (object.properties?.classification) {
                    const p = object.properties.classification;
                    presets[p.name] = {
                        color: asHexColor(p.color),
                        factoryID: "polygon",
                        presetID: p.name,
                        meta: {
                            category: {
                                name: 'Category',
                                value: p.name
                            }
                        }
                    }
                    result.presetID = p.name;
                }
                if (object.properties?.name) {
                    result.meta = {};
                    result.meta.category = object.properties.name;
                }
                if (Array.isArray(object.properties?.color)) {
                    result.fill = asHexColor(object.properties.color);
                }
                annotations.push(result);
            } else {
                throw "Could not import!";
            }
        }.bind(this);

        const presets = {}, annotations = [];

        if (Array.isArray(data)) {
            //feature list
            data.forEach(f => parseFeature(f, presets, annotations));
        } else if (data.type === "FeatureCollection") {
            //feature collection (object)
            data.features.forEach(f => parseFeature(f, presets, annotations));
        } else if (data.type === "Feature") {
            //single feature
            parseFeature(data, presets, annotations);
        } else {
            throw "Unsupported quPath GEOJson Type " + data.type;
        }

        return {
             objects: annotations,
             presets: Object.values(presets)
        };
    }
}

OSDAnnotations.Convertor.register("qu-path", OSDAnnotations.Convertor.GeoJSON);
