OSDAnnotations.Convertor.AsapXml = class {
    title = 'ASAP-XML Annotations';
    description = 'ASAP-compatible XML Annotations Format';

    encode(annotations, presets, annotationsModule) {
        //https://github.com/computationalpathologygroup/ASAP/issues/167

        let doc = document.implementation.createDocument("", "", null);
        let ASAP_annot = doc.createElement("ASAP_Annotations");
        let xml_annotations = doc.createElement("Annotations");
        ASAP_annot.appendChild(xml_annotations);
        doc.appendChild(ASAP_annot);

        const presetsIdSet = new Set();

        // for each object (annotation) create new annotation element with coresponding coordinates
        for (let i = 0; i < annotations.length; i++) {
            let obj = annotations[i];
            if (!obj.factoryId || obj.factoryId.startsWith("_")) {
                continue;
            }

            const xml_annotation = doc.createElement("Annotation");
            let coordinates=[];

            let factory = annotationsModule.getAnnotationObjectFactory(obj.factoryId);
            if (factory) {
                coordinates = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withArrayPoint);
                if (!Array.isArray(coordinates)) {
                    //todo some warn
                    continue;
                }
            }
            xml_annotation.setAttribute("Type", "Polygon");

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
            xml_annotations.appendChild(xml_annotation);
        }

        if (Array.isArray(presets)) {
            let xml_groups = doc.createElement("AnnotationGroups");
            ASAP_annot.appendChild(xml_groups);

            for (let preset of presets) {
                const xml_preset = doc.createElement("Group");
                xml_preset.setAttribute("Name", preset.presetID);
                xml_preset.setAttribute("PartOfGroup", "None"); //nesting not supported
                xml_preset.setAttribute("Color", preset.color);

                const preset_attributes = doc.createElement("Attributes");
                preset_attributes.setAttribute("FactoryID", preset.factoryID);

                for (let metaKey in preset.meta) {
                    const data = preset.meta[metaKey];
                    preset_attributes.setAttribute(`${metaKey}Name`, data.name);
                    preset_attributes.setAttribute(`${metaKey}Value`, data.value);
                }

                xml_groups.appendChild(xml_preset);
                presetsIdSet.delete(preset.presetID);
            }
            //todo check for consitency presetsIdSet?
        }
        return new XMLSerializer().serializeToString(doc);
    }

    decode(data, annotationsModule) {
        let xmlDoc;
        if (window.DOMParser) {
            const parser = new DOMParser();
            xmlDoc = parser.parseFromString(data, "text/xml");
        } else { // Internet Explorer
            xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
            xmlDoc.async = false;
            xmlDoc.loadXML(data);
        }

        const presets = {}, annotations = [];

        for (const elem of xmlDoc.getElementsByTagName("Group")) {
            let presetId = elem.getAttribute("Name");
            //in case of numbers, try to parse and otherwise accept string
            presetId = Number.parseInt(presetId) || presetId || Date.now();

            const attrs = elem.childNodes[0];
            const factoryID = attrs.getAttribute("FactoryID") || "polygon";
            attrs.removeAttribute("FactoryID");
            const meta = {};
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

            presets[presetId] = {
                color: elem.getAttribute("Color") || "#ff0000",
                presetID: presetId,
                factoryID: factoryID,
                meta: meta
            };
        }


        for (const elem of xmlDoc.getElementsByTagName("Annotations")) {
            const coords = elem.childNodes[0],
                pointArray = [];
            for (const coordElem of coords.childNodes) {
                const index = Number.parseInt(coordElem.getAttribute("Order"));
                pointArray[index] = {
                    x: Number.parseInt(coordElem.getAttribute("X")),
                    y: Number.parseInt(coordElem.getAttribute("Y"))
                }
            }

            const presetID = elem.getAttribute("PartOfGroup");

            //todo support: Dot, Rectangle, Polygon, Spline, and PointSet by implementation of general annotation structure
            //todo attr name could be set as category custom meta
            annotations.push({
                type: "polygon",
                points: pointArray,
                presetID: presets[presetID],
                color: elem.getAttribute("Color") || undefined
            });
        }
    }
}

OSDAnnotations.Convertor.register("asap-xml", OSDAnnotations.Convertor.AsapXml);