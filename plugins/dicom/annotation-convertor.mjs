import DicomTools from "./dicom-query.mjs";

OSDAnnotations.Convertor.register("dicom", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'DICOM SR';
    static description = 'DICOM Structured Report (TID 1500)';
    static exportsPresets = false;
    static includeAllAnnotationProps = false;
    static getSuffix() { return '.dcm'; }

    // --- EXPORT: OSD -> DICOM ---
    async encodePartial(annotationsGetter, presetsGetter) {
        const annotations = annotationsGetter();
        if (!annotations) return { objects: [] };

        const meta = this.options.meta;
        if (!meta?.micronsX || !meta?.micronsY) throw new Error("Missing pixel spacing metadata for export");

        const objects = [];

        for (let i = 0; i < annotations.length; i++) {
            const obj = annotations[i];
            const dicomItems = this._toDicomItems(obj, meta);

            for (const dicomItem of dicomItems) {
                dicomItem.RelationshipType = "CONTAINS";
                dicomItem.ValueType = "SCOORD3D";
                dicomItem.ReferencedFrameOfReferenceUID = meta.frameOfReferenceUID;
                dicomItem.ConceptNameCodeSequence = [this._getConceptCodeForFactory(obj.factoryID)];

                let textValue = obj.text || obj.name || obj.description || "";
                if (textValue) {
                    dicomItem.TextValue = textValue.substring(0, 64);
                }
                objects.push(dicomItem);
            }
        }
        return { objects: objects, meta: meta };
    }

    // --- IMPORT: DICOM -> OSD ---
    async decode(data) {
        const dcmjs = window.dcmjs;
        if (!dcmjs) throw new Error("dcmjs not loaded");

        // Patch BEFORE reading
        this.constructor._patchDcmjsDictionary(dcmjs);

        let dataset = data;
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            const dicomData = dcmjs.data.DicomMessage.readFile(data);
            dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
        }

        const meta = this.options.meta;
        const objects = [];
        const contentSeq = dataset.ContentSequence || [];

        for (const item of contentSeq) {
            if (item.ValueType !== "SCOORD3D" || !item.GraphicData) continue;

            const conceptCode = item.ConceptNameCodeSequence?.[0]?.CodeValue;

            // Generate Fabric Object
            const fabricObj = this._createFabricObjectFromDicom(item.GraphicType, item.GraphicData, meta, conceptCode, item.TextValue);

            if (fabricObj) {
                objects.push(fabricObj);
            }
        }
        return { objects: objects, presets: [] };
    }

    // --- HELPER: Create Fabric Object from DICOM Data ---
    _createFabricObjectFromDicom(type, data, meta, conceptCode, textValue) {
        const scaleX = 1 / (meta.micronsX || 0.00025);
        const scaleY = 1 / (meta.micronsY || 0.00025);

        // 1. Convert DICOM floats to Pixel Points
        const points = [];
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i += 3) {
                const x = data[i];
                const y = data[i+1];
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    points.push({ x: x * scaleX, y: y * scaleY });
                }
            }
        }
        if (points.length === 0) return null;

        // 2. Identify Factory
        const factoryID = this._getFactoryForConceptCode(conceptCode, type);

        // FIX: Access factory via context.module
        const factory = this.context.module.getAnnotationObjectFactory(factoryID);
        if (!factory) {
            console.warn(`No factory found for ${factoryID}`);
            return null;
        }

        // 3. Reconstruct Creation Parameters
        let parameters;
        const deconvertor = (p) => ({x: p.x, y: p.y});

        try {
            if (factory.fromPointArray) {
                // Factories like Polygon, Ruler usually support this
                parameters = factory.fromPointArray(points, deconvertor);
            } else {
                // Fallback: Just pass points directly
                parameters = points;
            }
        } catch (e) {
            console.warn(`Failed to reconstruct ${factoryID}:`, e);
            return null;
        }

        // 4. Inject Text / Name into parameters BEFORE creation if possible
        if (textValue) {
            if (factoryID === "text") {
                parameters.text = textValue;
            } else if (factoryID !== "ruler") {
                parameters.name = textValue;
            }
        } else if (factoryID === "text") {
            parameters.text = "Text";
        }

        // 5. Special Handling for Text Position
        // Text factory usually expects 'x' and 'y' in parameters, but fromPointArray might return an array or object
        if (factoryID === "text" && points.length > 0) {
            if (!parameters.x) parameters.x = points[0].x;
            if (!parameters.y) parameters.y = points[0].y;
        }

        // 6. Create Fabric Object
        const options = this.context.module.presets.getCommonProperties(); // FIX: Access via module
        let fabricObj = factory.create(parameters, options);

        // 7. Post-Creation Fixups
        if (fabricObj) {
            if (textValue && factoryID !== "text") {
                fabricObj.name = textValue;
            }
            // Ensure type is valid for Fabric (factories might set internal types like 'ruler')
            if (factoryID === "ruler") {
                // Ruler factory returns a Group. Groups are valid in Fabric.
                // No change needed unless factory returns something weird.
            }
        }

        return fabricObj;
    }

    // --- HELPER: MAPPINGS ---
    _getConceptCodeForFactory(factoryID) {
        switch (factoryID) {
            case "ruler":
                return { CodeValue: "121206", CodingSchemeDesignator: "DCM", CodeMeaning: "Distance" };
            case "text":
                return { CodeValue: "121106", CodingSchemeDesignator: "DCM", CodeMeaning: "Comment" };
            default:
                return { CodeValue: "111030", CodingSchemeDesignator: "DCM", CodeMeaning: "Image Region" };
        }
    }

    _getFactoryForConceptCode(codeValue, graphicType) {
        if (codeValue === "121206") return "ruler";
        if (codeValue === "121106") return "text";
        if (graphicType === "POINT" || graphicType === "MULTIPOINT") return "point";
        if (graphicType === "POLYLINE") return "polyline";
        return "polygon";
    }

    // --- CONVERSION HELPERS ---
    _toDicomItems(obj, meta) {
        // FIX: Access via module
        const factory = this.context.module.getAnnotationObjectFactory(obj.factoryID);
        if (!factory) return [];

        const points = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withObjectPoint);
        if (!points || points.length === 0) return [];

        const pxX = Number(meta.micronsX);
        const pxY = Number(meta.micronsY);
        if (isNaN(pxX) || isNaN(pxY)) return [];

        let graphicType = "POLYGON";
        const fid = obj.factoryID;

        if (fid === "polyline" || fid === "line" || fid === "ruler") graphicType = "POLYLINE";
        else if (fid === "point" || fid === "text") graphicType = "POINT";

        const toGraphicData = (pts) => {
            const data = [];
            for(let p of pts) {
                if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                    data.push(p.x * pxX, p.y * pxY, 0.0);
                }
            }
            return data;
        };

        if (Array.isArray(points[0])) {
            const items = [];
            for (const ring of points) {
                const gData = toGraphicData(ring);
                if (gData.length > 0) items.push({ GraphicType: graphicType, GraphicData: gData });
            }
            return items;
        } else {
            const gData = toGraphicData(points);
            return gData.length > 0 ? [{ GraphicType: graphicType, GraphicData: gData }] : [];
        }
    }

    static _patchDcmjsDictionary(dcmjs) {
        const dict = dcmjs.data.DicomMetaDictionary.dictionary;
        const nameMap = dcmjs.data.DicomMetaDictionary.nameMap;
        const tags = [
            { tag: "00700022", vr: "FL", name: "GraphicData", vm: "1-n" },
            { tag: "00700023", vr: "CS", name: "GraphicType", vm: "1" },
            { tag: "0040A010", vr: "CS", name: "RelationshipType", vm: "1" },
            { tag: "0040A040", vr: "CS", name: "ValueType", vm: "1" },
            { tag: "0040A043", vr: "SQ", name: "ConceptNameCodeSequence", vm: "1" },
            { tag: "0040A160", vr: "UT", name: "TextValue", vm: "1" },
            { tag: "0040A730", vr: "SQ", name: "ContentSequence", vm: "1" },
            { tag: "00200052", vr: "UI", name: "FrameOfReferenceUID", vm: "1" },
            { tag: "00081199", vr: "SQ", name: "ReferencedSOPSequence", vm: "1" },
            { tag: "0008114A", vr: "SQ", name: "ReferencedInstanceSequence", vm: "1" },
            { tag: "00081115", vr: "SQ", name: "ReferencedSeriesSequence", vm: "1" },
            { tag: "00080100", vr: "SH", name: "CodeValue", vm: "1" },
            { tag: "00080102", vr: "SH", name: "CodingSchemeDesignator", vm: "1" },
            { tag: "00080104", vr: "LO", name: "CodeMeaning", vm: "1" }
        ];
        tags.forEach(t => { if (!dict[t.tag]) { dict[t.tag] = t; nameMap[t.name] = t; } });
    }

    static encodeFinalize(output) {
        const dcmjs = window.dcmjs;
        if (!dcmjs) throw new Error("dcmjs library not loaded");
        this._patchDcmjsDictionary(dcmjs);

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const dicomDate = `${yyyy}${mm}${dd}`;
        const dicomTime = `${hh}${min}${ss}.000`;

        const { DicomMetaDictionary, DicomDict } = dcmjs.data;
        const { objects, meta } = output;

        const dataset = {
            PatientID: meta.patient?.patientID || "ANONYMOUS",
            PatientName: meta.patient?.name || "ANONYMOUS",
            StudyInstanceUID: meta.studyUID,
            SeriesInstanceUID: DicomMetaDictionary.uid(),
            SOPInstanceUID: DicomMetaDictionary.uid(),
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.88.34",
            Modality: "SR",
            Manufacturer: "xOpat",
            SeriesDescription: "Microscopy Annotations",
            InstanceNumber: 1,
            ContentDate: dicomDate,
            ContentTime: dicomTime,
            SeriesDate: dicomDate,
            SeriesTime: dicomTime,
            ReferencedSeriesSequence: [{
                SeriesInstanceUID: meta.seriesUID,
                ReferencedInstanceSequence: []
            }],
            VerificationFlag: "UNVERIFIED",
            CompletionFlag: "COMPLETE",
            ConceptNameCodeSequence: [{
                CodeValue: "126000", CodingSchemeDesignator: "DCM", CodeMeaning: "Imaging Measurement Report"
            }],
            ContentSequence: objects
        };

        const metaInfo = {
            FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
            MediaStorageSOPClassUID: dataset.SOPClassUID,
            MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
            TransferSyntaxUID: "1.2.840.10008.1.2.1",
            ImplementationClassUID: "1.2.826.0.1.3680043.9.7356.1.1",
            ImplementationVersionName: "dcmjs-0.0",
        };

        const denormalized = DicomMetaDictionary.denaturalizeDataset(dataset);
        const dicomDict = new DicomDict(metaInfo);
        dicomDict.dict = denormalized;
        return dicomDict.write();
    }
});