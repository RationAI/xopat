import DicomTools from "./dicom-query.mjs";

OSDAnnotations.Convertor.register("dicom", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'DICOM SR';
    static description = 'DICOM Structured Report (TID 1500)';
    static exportsPresets = true;
    static includeAllAnnotationProps = false;
    static getSuffix() { return '.dcm'; }

    // Private concept code carrying the xOpat preset blob inside the SR
    // ContentSequence. Standard DICOM SR has no native slot for "drawing
    // presets" (color/style/factory templates) — we co-encode them as a
    // single TEXT item tagged with this private concept so we can find &
    // strip it on decode without confusing it with a real text annotation.
    // Pre-existing SR files (without this item) decode cleanly to
    // `presets: []`, preserving backwards compatibility.
    static _PRESETS_CONCEPT = {
        CodeValue: "XOPAT.PRESETS",
        CodingSchemeDesignator: "99XOPAT",
        CodeMeaning: "xOpat Annotation Presets"
    };

    // Private concept code attached as a CONTAINS child item under each
    // SCOORD3D annotation, carrying the per-annotation `presetID`. Without
    // this child, decode falls back to the default preset's id for every
    // annotation — "classes not preserved". With it, the combination of the
    // XOPAT.PRESETS blob (preset definitions) + this per-annotation pointer
    // round-trips the full class binding. Pre-existing SR files without the
    // child decode unchanged (default-preset fallback path).
    static _PRESETID_CONCEPT = {
        CodeValue: "XOPAT.PRESETID",
        CodingSchemeDesignator: "99XOPAT",
        CodeMeaning: "xOpat Per-Annotation Preset Id"
    };

    // --- EXPORT: OSD -> DICOM ---
    async encodePartial(annotationsGetter, presetsGetter) {
        // Handle input whether it's a function or the object itself
        // If it's the FabricWrapper, toObject() returns the serialized JSON structure
        const annotations = typeof annotationsGetter === 'function' ? annotationsGetter() :
            (annotationsGetter?.toObject ? annotationsGetter.toObject().objects : annotationsGetter);

        if (!annotations) return { objects: [] };

        const meta = this.options.meta;
        if (!meta?.micronsX || !meta?.micronsY) throw new Error("Missing pixel spacing metadata for export");

        const objects = [];

        for (let i = 0; i < annotations.length; i++) {
            const obj = annotations[i];

            // Generate DICOM items (handles specific geometry types)
            const dicomItems = this._toDicomItems(obj, meta);

            const presetIdValue = obj.presetID != null && obj.presetID !== "" ? String(obj.presetID) : null;

            for (const dicomItem of dicomItems) {
                dicomItem.RelationshipType = "CONTAINS";
                dicomItem.ValueType = "SCOORD3D";
                dicomItem.ReferencedFrameOfReferenceUID = meta.frameOfReferenceUID;
                dicomItem.ConceptNameCodeSequence = [this._getConceptCodeForFactory(obj.factoryID)];

                // Add text label if present
                let textValue = obj.text || obj.name || obj.description || "";
                if (textValue) {
                    dicomItem.TextValue = textValue.substring(0, 64);
                }

                // Per-annotation preset binding. See `_PRESETID_CONCEPT`.
                // The XOPAT.PRESETS blob (below) carries the preset
                // *definitions*; this child gives each annotation a stable
                // pointer back into that set, restoring class/color/factory
                // after re-import. Without this, every annotation imports
                // under the default preset and "classes are lost".
                if (presetIdValue) {
                    dicomItem.ContentSequence = (dicomItem.ContentSequence || []).concat({
                        RelationshipType: "CONTAINS",
                        ValueType: "TEXT",
                        ConceptNameCodeSequence: [this.constructor._PRESETID_CONCEPT],
                        TextValue: presetIdValue,
                    });
                }

                objects.push(dicomItem);
            }
        }

        // Co-encode presets as one TEXT ContentSequence item carrying the
        // serialised preset list. See `_PRESETS_CONCEPT` for rationale.
        //
        // The full session palette is exported (not just presets used on this
        // slide): slide hydration merges presets by id (upsert, never delete),
        // so the snapshot can only add — and a preset the user created but has
        // not yet drawn with must survive a slide switch. Accepted quirk:
        // deleting a preset from the palette only propagates to a slide's SR
        // when that slide is next saved.
        //
        // An EMPTY array is still emitted: a "supersede" SR written after the
        // user deletes all annotations must be a well-formed snapshot that
        // decodes to `{objects: [], presets: []}` (merge of [] is a no-op).
        const presets = typeof presetsGetter === 'function' ? presetsGetter() : presetsGetter;
        if (Array.isArray(presets)) {
            objects.push({
                RelationshipType: "CONTAINS",
                ValueType: "TEXT",
                ConceptNameCodeSequence: [this.constructor._PRESETS_CONCEPT],
                TextValue: JSON.stringify(presets),
            });
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
        let presets = [];
        const contentSeq = dataset.ContentSequence || [];
        const PRESETS_CODE = this.constructor._PRESETS_CONCEPT.CodeValue;

        for (const item of contentSeq) {
            // xOpat preset blob, co-encoded as a TEXT item with a private
            // concept code. Strip it from the annotation stream and feed it
            // back through the framework's preset import path (handled by
            // annotations-canvas.js::_applyImportState when `presets` is
            // non-empty on the returned payload).
            if (item.ValueType === "TEXT"
                && item.ConceptNameCodeSequence?.[0]?.CodeValue === PRESETS_CODE) {
                try {
                    const parsed = JSON.parse(item.TextValue);
                    if (Array.isArray(parsed)) presets = parsed;
                } catch (e) {
                    console.warn("[dicom] failed to parse preset blob:", e);
                }
                continue;
            }

            if (item.ValueType !== "SCOORD3D" || !item.GraphicData) continue;

            const conceptCode = item.ConceptNameCodeSequence?.[0]?.CodeValue;

            // Per-annotation preset binding (see `_PRESETID_CONCEPT` on the
            // encode side). dcmjs may surface single-item ContentSequences
            // as a plain object instead of an array — normalize.
            const PRESETID_CODE = this.constructor._PRESETID_CONCEPT.CodeValue;
            const childContentRaw = item.ContentSequence;
            const childContent = Array.isArray(childContentRaw)
                ? childContentRaw
                : (childContentRaw ? [childContentRaw] : []);
            const childPresetId = childContent.find(c =>
                c?.ValueType === "TEXT"
                && c?.ConceptNameCodeSequence?.[0]?.CodeValue === PRESETID_CODE
            )?.TextValue;

            // Generate Fabric Object
            const fabricObj = this._createFabricObjectFromDicom(
                item.GraphicType, item.GraphicData, meta, conceptCode, item.TextValue, childPresetId
            );

            if (fabricObj) {
                objects.push(fabricObj);
            }
        }
        return { objects: objects, presets: presets };
    }

    // --- HELPER: Create Fabric Object from DICOM Data ---
    _createFabricObjectFromDicom(type, data, meta, conceptCode, textValue, presetIdOverride) {
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
        const factory = this.context.module.getAnnotationObjectFactory(factoryID);
        if (!factory) {
            console.warn(`No factory found for ${factoryID}`);
            return null;
        }

        // 3. Reconstruct Creation Parameters
        let parameters;
        const deconvertor = (p) => ({x: p.x, y: p.y});

        try {
            // Text: Manually construct params to correctly set left/top
            if (factoryID === "text") {
                parameters = {
                    x: points[0].x,
                    y: points[0].y,
                    left: points[0].x,
                    top: points[0].y,
                    text: textValue || "Text"
                };
            }
            // Line: Use factory method to get [x1, y1, x2, y2]
            else if (factory.fromPointArray) {
                parameters = factory.fromPointArray(points, deconvertor);
            }
            else {
                parameters = points;
            }
        } catch (e) {
            console.warn(`Failed to reconstruct ${factoryID}:`, e);
            return null;
        }

        // 4. Inject Text / Name
        if (textValue && factoryID !== "text") {
            if (typeof parameters === 'object' && !Array.isArray(parameters)) {
                parameters.name = textValue;
            }
        }

        // 5. Create Fabric Object
        // CLONE options to prevent pollution of shared references (fixes "jump to same origin" issue).
        // Pass the default preset so `getCommonProperties` includes a `presetID` —
        // otherwise factory.create produces objects without one, and
        // updateSingleAnnotationVisuals warns when the synchronous render path
        // triggered by text/grouped factories sees them mid-import.
        const defaultPreset = this.context.module.presets.get();
        const commonProps = this.context.module.presets.getCommonProperties(defaultPreset);
        const options = $.extend(true, {}, commonProps);

        let fabricObj = factory.create(parameters, options);

        // Restore the per-annotation preset binding when the DICOM SR
        // carried it (see `_PRESETID_CONCEPT`). Falls back to the default
        // preset only when no per-annotation pointer was encoded — covers
        // pre-fix SR files and legacy imports.
        if (fabricObj) {
            if (presetIdOverride) {
                fabricObj.presetID = presetIdOverride;
            } else if (!fabricObj.presetID && defaultPreset?.presetID) {
                fabricObj.presetID = defaultPreset.presetID;
            }
        }

        // 6. Post-Creation Fixups
        if (fabricObj) {
            if (textValue && factoryID !== "text") {
                fabricObj.name = textValue;
            }
            if (fabricObj._objects) {
                // todo: avoid calling factory.create(...) above, and ensure the objects were created correctly
                //  this looks like API correction usecase - we would like to have generic create factory method
                //  that always takes same parameters and creates object for import (create should work for 'enlivened' objects already)
                fabricObj.objects = fabricObj._objects;
            }
        }

        return fabricObj;
    }

    // --- HELPER: MAPPINGS ---
    _getConceptCodeForFactory(factoryID) {
        switch (factoryID) {
            case "line":
                return { CodeValue: "121206", CodingSchemeDesignator: "DCM", CodeMeaning: "Distance" };
            case "text":
                return { CodeValue: "121106", CodingSchemeDesignator: "DCM", CodeMeaning: "Comment" };
            default:
                return { CodeValue: "111030", CodingSchemeDesignator: "DCM", CodeMeaning: "Image Region" };
        }
    }

    _getFactoryForConceptCode(codeValue, graphicType) {
        // 121206 "Distance" was exported as a ruler by older xOpat versions;
        // the retired ruler factory is replaced by `line`, same geometry.
        if (codeValue === "121206") return "line";
        if (codeValue === "121106") return "text";
        if (graphicType === "POINT" || graphicType === "MULTIPOINT") return "point";
        if (graphicType === "POLYLINE") return "polyline";
        return "polygon";
    }

    // --- CONVERSION HELPERS ---
    _toDicomItems(obj, meta) {
        const factory = this.context.module.getAnnotationObjectFactory(obj.factoryID);
        if (!factory) return [];

        let points;
        try {
            // Try standard conversion first
            points = factory.toPointArray(obj, OSDAnnotations.AnnotationObjectFactory.withObjectPoint);
        } catch (e) {
            // Ignore errors here, we'll try fallbacks
        }

        const fid = obj.factoryID;

        // [FIX] Arrow Export: Handle missing points by digging into Group children
        if ((!points || points.length === 0 || !Number.isFinite(points[0]?.x)) && fid === 'arrow') {
            const innerObjects = obj._objects || obj.objects;

            if (innerObjects && innerObjects.length > 0) {
                // Arrow is a Group [Line, marker]. We need the Line (index 0).
                const line = innerObjects[0];

                if (Number.isFinite(line.x1) && Number.isFinite(line.y1)) {
                    // Coordinates in a Fabric Group are relative to the group center.
                    // We must convert them to absolute image coordinates.

                    const gLeft = Number(obj.left) || 0;
                    const gTop = Number(obj.top) || 0;
                    const gWidth = Number(obj.width) || 0;
                    const gHeight = Number(obj.height) || 0;

                    // Calculate Group Center (assuming origin is Top/Left, which is standard for these JSON exports)
                    const centerX = gLeft + (gWidth / 2);
                    const centerY = gTop + (gHeight / 2);

                    // Add relative line coords to group center
                    const p1 = { x: centerX + line.x1, y: centerY + line.y1 };
                    const p2 = { x: centerX + line.x2, y: centerY + line.y2 };

                    points = [p1, p2];
                }
            }
        }
        // [FIX] Standard Line fallback
        else if ((!points || points.length === 0) && fid === 'line') {
            if (Number.isFinite(obj.x1) && Number.isFinite(obj.y1)) {
                points = [{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }];
            }
        }

        if (!points || points.length === 0) return [];

        const pxX = Number(meta.micronsX);
        const pxY = Number(meta.micronsY);
        if (isNaN(pxX) || isNaN(pxY)) return [];

        let graphicType = "POLYGON";
        if (fid === "polyline" || fid === "line" || fid === "arrow") graphicType = "POLYLINE";
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