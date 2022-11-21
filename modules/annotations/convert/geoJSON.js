OSDAnnotations.Convertor.GeoJSON = class {
    title = 'GeoJSON Annotations';
    description = 'Annotations in GeoJSON format.';

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.json';
    }

    static includeAllAnnotationProps = false;

    _getAsPoints(object, type="Polygon", deleteProps=[]) {
        const factory = this.context.getAnnotationObjectFactory(object.factoryID);
        const poly = factory?.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withArrayPoint)
        if (poly?.length > 0) {
            poly.push(poly[0]); //linear ring
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

    _getAsNativeObject(imported, geometryConvertor=()=>{}) {
        const result = imported.properties;
        geometryConvertor(result, imported.geometry);
        return result;
    }

    //encode all supported factory types
    //todo support default object by export strategy
    encoders = {
        "rect": (object) => this._getAsPoints(object),
        "ellipse": (object) => this._getAsPoints(object),
        "polygon": (object) => this._getAsPoints(object, "Polygon", ["points"]),
        "polyline": (object) => this._getAsPoints(object, "LineString", ["points"]),
        "text": (object) => {

        }, "ruler": (object) => {

        }, "point": (object) => {
            object = this._getAsPoints(object, "Point");
            object.geometry.coordinates = object.geometry.coordinates[0] || [];
        }
    };


    //decode all supported factory types if factoryID present
    //todo support default object by export strategy
    nativeDecoders = {
        "rect": (object) => this._getAsNativeObject(object),
        "ellipse": (object) => this._getAsNativeObject(object),
        "polygon": (object) => this._getAsNativeObject(object, (object, geometry) => {
            geometry.splice(-1, 1);
            object.points = geometry.map(o => ({x: o.x, y: o.y}));
        }),
        "polyline": (object) => this._getAsNativeObject(object, (object, geometry) => {
            geometry.splice(-1, 1);
            object.points = geometry.map(o => ({x: o.x, y: o.y}));
        }),
        "text": (object) => {

        }, "ruler": (object) => {

        }, "point": (object) => this._getAsNativeObject(object, (object, geometry) => {
            object.left = geometry[0];
            object.top = geometry[1];
        }),
    };

    //decode all unsupported geometries
    decoders = {
        Point: (object) => {},
        MultiPoint: (object) => {},
        LineString: (object) => {},
        MultiLineString: (object) => {},
        Polygon: (object) => {},
        MultiPolygon: (object) => {},
        GeometryCollection: (object) => {},
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