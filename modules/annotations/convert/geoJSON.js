OSDAnnotations.Convertor.GeoJSON = class {
    title = 'GeoJSON Annotations';
    description = 'Annotations in GeoJSON format.';

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.json';
    }

    encoders = {
        "rect": (object) => {}, "ellipse": (object) => {}, "polygon": (object) => {}, "polyline": (object) => {}, "text": (object) => {}, "ruler": (object) => {}, "point": (object) => {}
    };

    gDecoders = {
        Point: (object) => {},
        MultiPoint: (object) => {},
        LineString: (object) => {},
        MultiLineString: (object) => {},
        Polygon: (object) => {},
        MultiPolygon: (object) => {},
        GeometryCollection: (object) => {},
    }

    decoders = {
        FeatureCollection: (preset) => {

        },
        Feature: (preset, object) => {

        },
        //todo this.gEncoders[object.<???>.type]?.(object)
        Geometry: (object) => {

        }
    };

    encode(annotationsGetter, presetsGetter, annotationsModule) {
        //https://github.com/computationalpathologygroup/ASAP/issues/167

        const annotations = annotationsGetter();
        const presets = presetsGetter();

        let output = {
            type: "FeatureCollection",
            features: []
        };
        let list = output.features;

        const presetsIdSet = new Set();

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
                    let feature = {
                        type: "Feature",
                        geometry: encoded
                    };
                    let preset = presets[obj.presetID];
                    if (preset) {
                        feature.properties = preset.toJSONFriendlyObject();
                        presetsIdSet.add(obj.presetID);
                    }
                    list.push(feature);
                }
            }
        }

        if (Array.isArray(presets)) {
            for (let preset of presets) {
                if (!presetsIdSet.has(preset.presetID)) {
                    list.push({
                        type: "Feature",
                        //todo? geometry: "",
                        properties: preset.toJSONFriendlyObject()
                    });
                }
            }
        }
        return JSON.stringify(output);
    }

    decode(data, annotationsModule) {
        //todo

        // let xmlDoc;
        // if (window.DOMParser) {
        //     const parser = new DOMParser();
        //     xmlDoc = parser.parseFromString(data, "text/xml");
        // } else { // Internet Explorer
        //     xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
        //     xmlDoc.async = false;
        //     xmlDoc.loadXML(data);
        // }
        //
        // const presets = {}, annotations = [];
        //
        // for (const elem of xmlDoc.getElementsByTagName("Group")) {
        //     let presetId = elem.getAttribute("Name");
        //     //in case of numbers, try to parse and otherwise accept string
        //     presetId = Number.parseInt(presetId) || presetId || Date.now();
        //
        //     const meta = {};
        //     const attrs = elem.firstElementChild; //todo probably incorrect...
        //     const factoryID = attrs?.getAttribute("FactoryID") || "polygon";
        //
        //     if (attrs) {
        //         attrs.removeAttribute("FactoryID");
        //         for (let attrMetaElem of attrs.attributes) {
        //             if (attrMetaElem.nodeName.endsWith("Name")) {
        //                 const key = attrMetaElem.nodeName.substring(0, attrMetaElem.nodeName.length-4);
        //                 let ctx = meta[key] || {};
        //                 ctx.name = attrMetaElem.nodeValue;
        //                 meta[key] = ctx;
        //             } else if (attrMetaElem.nodeName.endsWith("Value")) {
        //                 const key = attrMetaElem.nodeName.substring(0, attrMetaElem.nodeName.length-5);
        //                 let ctx = meta[key] || {};
        //                 ctx.value = attrMetaElem.nodeValue; //todo parse?
        //                 meta[key] = ctx;
        //             }
        //         }
        //     }
        //
        //     if (!meta.category) {
        //         meta.category = {
        //             name: 'Category',
        //             value: presetId
        //         };
        //     }
        //
        //     presets[presetId] = {
        //         color: elem.getAttribute("Color") || "#ff0000",
        //         presetID: presetId,
        //         factoryID: factoryID,
        //         meta: meta
        //     };
        // }
        //
        // for (const elem of xmlDoc.getElementsByTagName("Annotation")) {
        //     const coords = elem.firstElementChild,
        //         pointArray = [];
        //     for (const coordElem of coords.getElementsByTagName("Coordinate")) {
        //         const index = Number.parseInt(coordElem.getAttribute("Order"));
        //         pointArray[index] = {
        //             x: Number.parseInt(coordElem.getAttribute("X")),
        //             y: Number.parseInt(coordElem.getAttribute("Y"))
        //         }
        //     }
        //
        //     const presetID = elem.getAttribute("PartOfGroup");
        //
        //     //todo support: Dot, Rectangle, Polygon, Spline, and PointSet by implementation of general annotation structure
        //     //todo attr name could be set as category custom meta
        //     annotations.push({
        //         type: "polygon",
        //         points: pointArray,
        //         presetID: presetID,
        //         factoryID: "polygon",
        //         color: elem.getAttribute("Color") || undefined
        //     });
        // }
        //
        // return {
        //     objects: annotations,
        //     presets: Object.values(presets)
        // };
    }
}

OSDAnnotations.Convertor.register("geo-json", OSDAnnotations.Convertor.GeoJSON);