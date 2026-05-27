//ASAP XML not yet fully tested, does not render well all objects, problem with hierarchies
const ASAP_TYPE_BY_FACTORY = {
    rect: "Rectangle",
    polygon: "Polygon",
    multipolygon: "Polygon",
    ellipse: "Polygon",
    polyline: "Spline",
    line: "Spline",
    ruler: "Spline",
    point: "Dot",
    text: "Dot",
};
const ASAP_LOSSY_FACTORIES = new Set([
    "multipolygon", "ellipse", "polyline", "line", "ruler", "text"
]);

OSDAnnotations.Convertor.register("asap-xml", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'ASAP-XML Annotations';
    static description = 'ASAP-compatible XML Annotations Format';

    static getSuffix() {
        return '.xml';
    }

    static parse(string) {
        if (window.DOMParser) {
            const parser = new DOMParser();
            return parser.parseFromString(string, "text/xml");
        }
        // Internet Explorer
        let xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
        xmlDoc.async = false;
        xmlDoc.loadXML(string);
        return xmlDoc;
    }

    static encodeFinalize(output) {
        let doc = document.implementation.createDocument("", "", null);
        let ASAP_annot = doc.createElement("ASAP_Annotations");
        let xml_annotations = doc.createElement("Annotations");
        //always preset, although might be empty
        ASAP_annot.appendChild(xml_annotations);

        if (Array.isArray(output.objects)) {
            for (let obj of output.objects) {
                const xmlNode = typeof obj === "string" ? this.parse(obj) : obj;
                xml_annotations.appendChild(xmlNode);
            }
        }

        if (Array.isArray(output.presets)) {
            let xml_groups = doc.createElement("AnnotationGroups");
            for (let obj of output.presets) {
                const xmlNode = typeof obj === "string" ? this.parse(obj) : obj;
                xml_groups.appendChild(xmlNode);
            }
            ASAP_annot.appendChild(xml_groups);
        }
        doc.appendChild(ASAP_annot);
        return new XMLSerializer().serializeToString(doc);
    }

    async encodePartial(annotationsGetter, presetsGetter) {
        //https://github.com/computationalpathologygroup/ASAP/issues/167
        const annotations = annotationsGetter();
        const presets = presetsGetter();
        const result = {};

        let wasError = '';
        const lossyTypes = new Set();

        let doc = document.implementation.createDocument("", "", null);
        const presetsIdSet = new Set();

        if (this.options.exportsObjects && Array.isArray(annotations)) {
            result.objects = [];
            // for each object (annotation) create new annotation element with coresponding coordinates
            for (let i = 0; i < annotations.length; i++) {
                let obj = annotations[i];
                if (!obj.factoryID || obj.factoryID.startsWith("_")) {
                    continue;
                }

                const xml_annotation = doc.createElement("Annotation");
                let coordinates=[];

                let factory = this.context.getAnnotationObjectFactory(obj.factoryID);
                if (factory) {
                    if (factory.factoryID === "multipolygon") {
                        coordinates = this.context.polygonFactory.toPointArray({points: obj.points[0]},
                            OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
                    } else {
                        coordinates = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
                    }

                    if (!Array.isArray(coordinates)) {
                        wasError = 'Failed to export annotation ' + factory.getDescription(obj);
                        continue;
                    }
                }
                const asapType = ASAP_TYPE_BY_FACTORY[factory?.factoryID] || "Polygon";
                xml_annotation.setAttribute("Type", asapType);
                // Per-annotation factoryID (custom attribute, ASAP ignores unknown attrs).
                // Required because a preset's FactoryID is a default, but its annotations may differ.
                if (factory?.factoryID) {
                    xml_annotation.setAttribute("xopatFactoryID", factory.factoryID);
                }
                if (factory && ASAP_LOSSY_FACTORIES.has(factory.factoryID)) {
                    lossyTypes.add(factory.factoryID);
                }
                if (factory?.factoryID === "ruler") {
                    const inner = obj._objects || obj.objects;
                    const txt = inner?.[1]?.text;
                    if (txt) xml_annotation.setAttribute("Description", txt);
                }

                //todo attr name could be set from preset
                xml_annotation.setAttribute("Name", "Annotation " + i);

                // noinspection JSUnresolvedVariable
                let groupId = "None";
                if (Number.isInteger(obj.presetID) || (typeof obj.presetID === "string" && obj.presetID !== "")) {
                    groupId = obj.presetID;
                    presetsIdSet.add(groupId);
                }

                xml_annotation.setAttribute("PartOfGroup", groupId);

                //get coordinates in ASAP format
                const xml_coordinates = doc.createElement("Coordinates");
                // create new coordinate element for each coordinate
                for (let j = 0; j < coordinates.length; j++) {
                    //todo access as x/y to prevent conversion as withArrayPoint
                    let xml_coordinate = doc.createElement("Coordinate");
                    xml_coordinate.setAttribute("Order", (j).toString());
                    xml_coordinate.setAttribute("X", coordinates[j][0]);
                    xml_coordinate.setAttribute("Y", coordinates[j][1]);
                    xml_coordinates.appendChild(xml_coordinate);
                }
                xml_annotation.appendChild(xml_coordinates);

                if (this.options.serialize) {
                    result.objects.push(new XMLSerializer().serializeToString(xml_annotation));
                } else {
                    result.objects.push(xml_annotation);
                }
            }
        }

        if (this.options.exportsPresets && Array.isArray(presets)) {
            result.presets = [];

            for (let preset of presets) {
                const xml_preset = doc.createElement("Group");
                xml_preset.setAttribute("Name", preset.presetID);
                xml_preset.setAttribute("PartOfGroup", "None"); //nesting not supported
                xml_preset.setAttribute("Color", preset.color);

                //todo possibly attributes was general term and there can be plethora of elements
                const preset_attributes = doc.createElement("Attributes");
                preset_attributes.setAttribute("FactoryID", preset.factoryID);

                for (let metaKey in preset.meta) {
                    const data = preset.meta[metaKey];
                    preset_attributes.setAttribute(`${metaKey}Name`, data.name);
                    preset_attributes.setAttribute(`${metaKey}Value`, data.value);
                }

                xml_preset.appendChild(preset_attributes);

                if (this.options.serialize) {
                    result.presets.push(new XMLSerializer().serializeToString(xml_preset));
                } else {
                    result.presets.push(xml_preset);
                }
                presetsIdSet.delete(preset.presetID);
            }
            //todo check for consitency presetsIdSet?
        }

        if (lossyTypes.size) {
            const lossyMsg = `ASAP-XML is lossy for: ${[...lossyTypes].join(", ")}. `
                + `Re-import in xopat preserves class via preset FactoryID; other tools see only the geometry.`;
            wasError = wasError ? wasError + "\n" + lossyMsg : lossyMsg;
        }
        // Todo - create some unified checking mechanism that reports on export issues
        if (wasError) {
            Dialogs.show(wasError, 15000, Dialogs.MSG_WARN);
        }

        return result;
    }

    async decode(data ) {
        let xmlDoc = this.constructor.parse(data);

        const presets = {}, annotations = [];

        for (const elem of xmlDoc.getElementsByTagName("Group")) {
            let presetId = elem.getAttribute("Name");
            //in case of numbers, try to parse and otherwise accept string
            presetId = Number.parseInt(presetId) || presetId || Date.now();

            const meta = {};
            const attrs = elem.firstElementChild; //todo probably incorrect...
            const factoryID = attrs?.getAttribute("FactoryID") || "polygon";

            if (attrs) {
                attrs.removeAttribute("FactoryID");
                for (let attrMetaElem of attrs.attributes) {
                    if (attrMetaElem.nodeName.endsWith("Name")) {
                        const key = attrMetaElem.nodeName.substring(0, attrMetaElem.nodeName.length-4);
                        let ctx = meta[key] || {};
                        ctx.name = attrMetaElem.nodeValue;
                        meta[key] = ctx;
                    } else if (attrMetaElem.nodeName.endsWith("Value")) {
                        const key = attrMetaElem.nodeName.substring(0, attrMetaElem.nodeName.length-5);
                        let ctx = meta[key] || {};
                        ctx.value = attrMetaElem.nodeValue; //todo parse?
                        meta[key] = ctx;
                    }
                }
            }

            if (!meta.category) {
                meta.category = {
                    name: 'Name',
                    value: presetId
                };
            }

            presets[presetId] = {
                color: elem.getAttribute("Color") || "#ff0000",
                presetID: presetId,
                factoryID: factoryID,
                meta: meta
            };
        }

        for (const elem of xmlDoc.getElementsByTagName("Annotation")) {
            const coords = elem.firstElementChild,
                pointArray = [];
            for (const coordElem of coords.getElementsByTagName("Coordinate")) {
                const index = Number.parseInt(coordElem.getAttribute("Order"));
                pointArray[index] = {
                    x: Number.parseFloat(coordElem.getAttribute("X")),
                    y: Number.parseFloat(coordElem.getAttribute("Y"))
                }
            }

            const rawPresetID = elem.getAttribute("PartOfGroup");
            const presetID = Number.parseInt(rawPresetID) || rawPresetID;
            const preset = presets[presetID];
            // Prefer per-annotation factoryID (custom attribute) over the preset's default factoryID:
            // a preset's FactoryID is just the default; its annotations may be of other types.
            const xopatFacID = elem.getAttribute("xopatFactoryID");
            let facID = xopatFacID || preset?.factoryID || "polygon";
            // ASAP-XML drops multipolygon rings on export (only outer ring of first polygon is kept);
            // decode that single ring as a polygon to avoid Multipolygon.fromPointArray misinterpreting flat points.
            if (facID === "multipolygon") facID = "polygon";
            const factory = this.context.getAnnotationObjectFactory(facID);
            const color = elem.getAttribute("Color") || preset?.color || undefined;

            let pushed = false;
            if (factory && typeof factory.fromPointArray === "function" &&
                typeof factory.create === "function") {
                try {
                    const arrPts = pointArray.map(p => [p.x, p.y]);
                    const params = factory.fromPointArray(arrPts, ([x, y]) => ({ x, y }));
                    const opts = {
                        color,
                        presetID,
                        factoryID: facID,
                        ...(this.context.presets.getCommonProperties?.() || {}),
                    };
                    const obj = factory.create(params, opts);
                    if (facID === "ruler") {
                        const desc = elem.getAttribute("Description");
                        if (desc && obj?._objects?.[1]) obj._objects[1].set({ text: desc });
                    }
                    annotations.push(obj);
                    pushed = true;
                } catch (e) {
                    console.warn("ASAP-XML decode: factory reconstruction failed, falling back to polygon", facID, e);
                }
            }
            if (!pushed) {
                annotations.push({
                    type: "polygon",
                    points: pointArray,
                    presetID,
                    factoryID: "polygon",
                    color
                });
            }
        }

        return {
            objects: annotations,
            presets: Object.values(presets)
        };
    }
});
