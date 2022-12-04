OSDAnnotations.Convertor.GeoJSON = class {
    title = 'GeoJSON Annotations';
    description = 'Annotations in GeoJSON format.';

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.json';
    }

    static includeAllAnnotationProps = false;

    //linear ring has the first and last vertex equal, geojson uses arrays
    _asGEOJsonFeature(object, type="Polygon", deleteProps=[], asLinearRing=false) {
        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        const poly = factory?.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withArrayPoint)
        if (poly?.length > 0) {
            if (asLinearRing) poly.push(poly[0]); //linear ring
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

    //we use objects for points, we do not repeat the last point
    _toNativeRing(list) {
        list.splice(-1, 1);
        return list.map(o => ({x: o[0], y: o[1]}));
    }

    _getAsNativeObject(imported, geometryConvertor=()=>{}) {
        const result = imported.properties;
        geometryConvertor(result, imported.geometry);
        return result;
    }

    //encode all supported factory types
    //todo support default object by export strategy
    encoders = {
        "rect": (object) => this._asGEOJsonFeature(object),
        "ellipse": (object) => this._asGEOJsonFeature(object),
        "polygon": (object) => {
            const res = this._asGEOJsonFeature(object, "Polygon", ["points"], true);
            res.geometry.coordinates = [res.geometry.coordinates]; //has to be nested, the first array is the outer linear ring
            return res;
        },
        "polyline": (object) => this._asGEOJsonFeature(object, "LineString", ["points"]),
        "point": (object) => {
            object = this._asGEOJsonFeature(object, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
            return object;
        },
        "text": this.encoders.point,
        "ruler": (object) => {
            const factory = this.context.getAnnotationObjectFactory(object.factoryID);
            const converter = OSDAnnotations.AnnotationObjectFactory.withArrayPoint;
            const line = object[0];

            return {
                geometry: {
                    type: "LineString",
                    coordinates: [
                        converter(line.x1, line.y1),
                        converter(line.x2, line.y2),
                    ]
                },
                properties: factory.copyNecessaryProperties(object)
            };
        },
    };

    //decode all supported factory types if factoryID present
    //todo support default object by export strategy
    nativeDecoders = {
        "rect": (object) => this._getAsNativeObject(object),
        "ellipse": (object) => this._getAsNativeObject(object),
        "polygon": (object) => this._getAsNativeObject(object,
            (object, geometry) => object.points = this._toNativeRing(geometry[0] || [])), //for now we support only outer ring
        "polyline": (object) => this._getAsNativeObject(object,
            (object, geometry) => object.points = this._toNativeRing(geometry)),
        "point": (object) => this._getAsNativeObject(object, (object, geometry) => {
            //todo not necessary? left/top are already probably present in props
            object.left = geometry[0];
            object.top = geometry[1];
            return object;
        }),
        "text": this.nativeDecoders.point,
        "ruler": (object) => this._getAsNativeObject(object),
    };

    _decodeMulti(object, type) {
        let result = {};
        //for now we do not make use of Multi* so this has to be external GeoJSON
        result.objects = object.coordinates.map(g => this.decoders[type]({ coordinates: g, type: type }));
        result.factoryID = "group";
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
            props.points = this._toNativeRing(object.coordinates);
            return props;
        },
        MultiLineString: (object) => this._decodeMulti(object, "LineString"),
        Polygon: (object) => {
            let props = {};
            props.factoryID = "polygon";
            props.type = "polygon";
            props.points = this._toNativeRing(object.coordinates[0] || []); //for now we support only outer ring
            return props;
        },
        MultiPolygon: (object) => this._decodeMulti(object, "Polygon"),
        GeometryCollection: (object) => {
            let result = {};
            //for now we do not make use of Multi* so this has to be external GeoJSON
            result.objects = object.geometries.map(g => this.decoders[g.type]?.(g)).filter(x => x);
            result.factoryID = "group";
            result.type = "group";
            return result;
        },
    }

    encode(annotationsGetter, presetsGetter, annotationsModule) {
        this.context = annotationsModule;

        //https://github.com/computationalpathologygroup/ASAP/issues/167

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
                let encoded = this.encoders[obj.factoryID]?.(obj);
                if (encoded) {
                    encoded.type = "Feature";
                    list.push(encoded);
                }
            }
        }

        list.push(...presets.map(p => ({
            type: "Feature",
            geometry: null,
            properties: p
        })));
        return JSON.stringify(output);
    }

    decode(data, annotationsModule) {

        data = JSON.parse(data);

        const parseFeature = function (object, presets, annotations) {
            if (object.geometry === null && object.properties.presetID) {
                //null features not part of our preset API ignored
                const preset = object.properties;
                presets[preset.presetID] = preset;
            } else {
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
}

OSDAnnotations.Convertor.register("geo-json", OSDAnnotations.Convertor.GeoJSON);
