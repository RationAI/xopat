(function () {
    const PARAM_ENUMS = {
        theme: ["auto", "light", "dark"],
        webGlPreferredVersion: ["1.0", "2.0"]
    };

    function parseInterfaceFields(source, interfaceName) {
        const pattern = new RegExp(`interface\\s+${interfaceName}\\s*(?:extends\\s+[^{]+)?\\{([\\s\\S]*?)\\n\\}`, "m");
        const match = source.match(pattern);
        if (!match) return {};

        const fields = {};
        const body = match[1];
        const fieldPattern = /^\s*([A-Za-z0-9_]+)\??:\s*([^;]+);/gm;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(body)) !== null) {
            fields[fieldMatch[1]] = {
                optional: !fieldMatch[0].includes(`${fieldMatch[1]}:`),
                type: fieldMatch[2].trim()
            };
        }
        return fields;
    }

    function parseTypeFields(source, typeName) {
        const pattern = new RegExp(`type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
        const match = source.match(pattern);
        if (!match) return {};

        const fields = {};
        const body = match[1];
        const fieldPattern = /^\s*([A-Za-z0-9_]+)\??:\s*([^;]+);/gm;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(body)) !== null) {
            fields[fieldMatch[1]] = {
                optional: !fieldMatch[0].includes(`${fieldMatch[1]}:`),
                type: fieldMatch[2].trim()
            };
        }
        return fields;
    }

    function inferSchemaFromDefault(value, key = "") {
        if (PARAM_ENUMS[key]) {
            return { type: "string", enum: PARAM_ENUMS[key], default: value };
        }
        if (value === null) return { default: null };
        if (Array.isArray(value)) {
            return {
                type: "array",
                default: value,
                items: value.length > 0 ? inferSchemaFromDefault(value[0]) : {}
            };
        }

        switch (typeof value) {
            case "boolean":
                return { type: "boolean", default: value };
            case "number":
                return { type: Number.isInteger(value) ? "integer" : "number", default: value };
            case "string":
                return { type: "string", default: value };
            case "object": {
                const properties = {};
                for (const [childKey, childValue] of Object.entries(value)) {
                    properties[childKey] = inferSchemaFromDefault(childValue, childKey);
                }
                return { type: "object", default: value, properties, additionalProperties: true };
            }
            default:
                return {};
        }
    }

    function schemaFromTsType(tsType) {
        const type = String(tsType || "").trim();
        if (!type || type === "any" || type === "unknown") return {};
        if (type === "null") return { type: "null" };
        if (type === "string") return { type: "string" };
        if (type === "number") return { type: "number" };
        if (type === "boolean") return { type: "boolean" };
        if (type === "DataID") return { $ref: "#/$defs/DataID" };
        if (type === "DataSpecification") return { $ref: "#/$defs/DataSpecification" };
        if (type === "SlideSourceOptions") return { $ref: "#/$defs/SlideSourceOptions" };
        if (type === "ViewportSetup") return { $ref: "#/$defs/ViewportSetup" };
        if (type === "ViewportSetup[]") return { type: "array", items: { $ref: "#/$defs/ViewportSetup" } };
        if (type === "VisualizationShaderGroupOrLayer") return { $ref: "#/$defs/VisualizationShaderGroupOrLayer" };
        if (type === "VisualizationShaderGroupOrLayer[]") return { type: "array", items: { $ref: "#/$defs/VisualizationShaderGroupOrLayer" } };
        if (type === "number[]") return { type: "array", items: { type: "number" } };
        if (type === "string[]") return { type: "array", items: { type: "string" } };
        if (type === "{ x: number; y: number }") {
            return {
                type: "object",
                properties: {
                    x: { type: "number" },
                    y: { type: "number" }
                },
                additionalProperties: false
            };
        }
        if (type.startsWith("Record<string,")) {
            return { type: "object", additionalProperties: { $ref: "#/$defs/VisualizationShaderGroupOrLayer" } };
        }
        if (type.includes("|")) {
            const branches = type.split("|").map(part => schemaFromTsType(part.trim()));
            // Collapse a `string|null` style union into the compact `type: [...]` form when
            // every branch is a single primitive type. Keeps the published schema readable.
            const allSimple = branches.every(branch =>
                branch && typeof branch.type === "string" && Object.keys(branch).length === 1);
            if (allSimple) {
                return { type: branches.map(b => b.type) };
            }
            return { anyOf: branches };
        }
        if (type.includes("OpenSeadragon.TileSource")) {
            return { description: "Runtime-only OpenSeadragon.TileSource instance; not serializable through session JSON." };
        }
        return {};
    }

    /**
     * Take a base schema and a default value and return a copy with the default attached and
     * `null` accepted when the default is null. Prefers the compact `type: ["X","null"]` form
     * over `anyOf: [..., {type:"null"}]` whenever the base schema is just a single type — keeps
     * the published schema readable.
     */
    function mergeSchemaWithDefault(schema, defaultValue) {
        if (defaultValue === undefined) {
            return schema;
        }
        if (defaultValue !== null) {
            return { ...schema, default: defaultValue };
        }

        if (!schema || Object.keys(schema).length === 0) {
            return { type: "null", default: null };
        }

        if (schema.type === "null") {
            return { ...schema, default: null };
        }

        // Compact: `type: "string"` + null default → `type: ["string", "null"]`.
        if (typeof schema.type === "string") {
            return { ...schema, type: [schema.type, "null"], default: null };
        }
        if (Array.isArray(schema.type)) {
            return {
                ...schema,
                type: schema.type.includes("null") ? schema.type : schema.type.concat("null"),
                default: null
            };
        }

        // Existing `anyOf` form: append a null branch only if not already there.
        if (Array.isArray(schema.anyOf)) {
            const hasNull = schema.anyOf.some(item => item?.type === "null");
            return {
                ...schema,
                anyOf: hasNull ? schema.anyOf : schema.anyOf.concat({ type: "null" }),
                default: null
            };
        }

        if (schema.$ref) {
            return {
                anyOf: [schema, { type: "null" }],
                default: null
            };
        }

        return { ...schema, default: null };
    }

    function buildObjectSchemaFromFields(fields, overrides = {}) {
        const properties = {};
        const required = [];
        for (const [name, meta] of Object.entries(fields || {})) {
            properties[name] = overrides[name] || schemaFromTsType(meta.type);
            if (!meta.optional) required.push(name);
        }
        return { type: "object", properties, required, additionalProperties: true };
    }

    /**
     * Take a renderer-published shader layer schema (from `compileConfigSchemaModel().$defs.shaderLayers.<type>`)
     * and adapt it for use in the AUTHORED session schema:
     *   - drop `tiledImages` (runtime-only, computed by app.ts from `dataReferences`)
     *   - add `dataReferences` (session-format wiring; absent from runtime schema)
     *   - for `group`, rewire the nested `shaders.additionalProperties` to point at a session-flavored
     *     children-or-layer ref (background or visualization context)
     *
     * Returns a fresh object; the renderer schema is not mutated.
     */
    function adaptRendererLayerForSession(layerSchema, type, options) {
        const adapted = JSON.parse(JSON.stringify(layerSchema || {}));
        if (adapted.properties && typeof adapted.properties === "object") {
            delete adapted.properties.tiledImages;
            if (!adapted.properties.dataReferences) {
                adapted.properties.dataReferences = {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    description: "Indexes into the session-level `data` array. The viewer resolves these to runtime tiledImages before reaching the renderer."
                };
            }
        }
        if (type === "group" && options && typeof options.childrenRef === "string") {
            const groupShaders = adapted.properties && adapted.properties.shaders;
            if (groupShaders && typeof groupShaders === "object") {
                groupShaders.additionalProperties = { $ref: options.childrenRef };
            }
        }
        return adapted;
    }

    /**
     * Build the session-format `$defs` block that proxies the renderer's shader layer schemas.
     * One adapted entry per non-group shader (shared by both background and visualization),
     * plus two `group` flavors (one per side) so each side's recursion lands in the right
     * children-or-layer ref.
     */
    function buildSessionShaderDefs(rendererSchema) {
        const rendererShaderLayers = rendererSchema && rendererSchema.$defs && rendererSchema.$defs.shaderLayers
            ? rendererSchema.$defs.shaderLayers
            : null;
        const rendererTypedefs = rendererSchema && rendererSchema.$defs && rendererSchema.$defs.uiControlEnvelopes
            ? JSON.parse(JSON.stringify(rendererSchema.$defs.uiControlEnvelopes))
            : null;

        if (!rendererShaderLayers) {
            return { available: false };
        }

        const allTypes = Object.keys(rendererShaderLayers);
        const nonGroupTypes = allTypes.filter(t => t !== "group");
        const sessionLayerDefs = {};

        for (const type of nonGroupTypes) {
            sessionLayerDefs[`SessionShaderLayer_${type}`] = adaptRendererLayerForSession(rendererShaderLayers[type], type);
        }
        if (rendererShaderLayers.group) {
            sessionLayerDefs.SessionShaderLayer_group_background = adaptRendererLayerForSession(
                rendererShaderLayers.group,
                "group",
                { childrenRef: "#/$defs/BackgroundShaderGroupOrLayer" }
            );
            sessionLayerDefs.SessionShaderLayer_group_visualization = adaptRendererLayerForSession(
                rendererShaderLayers.group,
                "group",
                { childrenRef: "#/$defs/VisualizationShaderGroupOrLayer" }
            );
        }

        // Non-group session layers are referenced as-is from background OR-Layer.
        // Visualization OR-Layer requires `dataReferences` on every non-group layer (background
        // doesn't, since the background item itself carries `dataReference`).
        const backgroundOneOf = nonGroupTypes.map(type => ({ $ref: `#/$defs/SessionShaderLayer_${type}` }));
        const visualizationOneOf = nonGroupTypes.map(type => ({
            allOf: [
                { $ref: `#/$defs/SessionShaderLayer_${type}` },
                { required: ["dataReferences"] }
            ]
        }));
        if (rendererShaderLayers.group) {
            backgroundOneOf.push({ $ref: "#/$defs/SessionShaderLayer_group_background" });
            visualizationOneOf.push({ $ref: "#/$defs/SessionShaderLayer_group_visualization" });
        }

        return {
            available: true,
            rendererTypedefs,
            sessionLayerDefs,
            backgroundOneOf,
            visualizationOneOf
        };
    }

    function buildSchema(payload, options = {}) {
        const includeExtensions = options.includeExtensions === true || payload?.includeExtensions === true;
        const typesSource = payload?.typesSource || "";
        const configTypesSource = payload?.configTypesSource || "";
        const backgroundFields = parseInterfaceFields(typesSource, "BackgroundItem");
        const visualizationFields = parseInterfaceFields(typesSource, "VisualizationItem");
        const dataOverrideFields = parseInterfaceFields(typesSource, "DataOverride");
        const slideSourceOptionsFields = parseInterfaceFields(typesSource, "SlideSourceOptions");
        const viewportSetupFields = parseTypeFields(configTypesSource, "ViewportSetup");
        const setupFields = parseTypeFields(configTypesSource, "XOpatSetup");
        const configurator = window.OpenSeadragon?.FlexRenderer?.ShaderConfigurator;

        // The renderer's full JSON Schema (compileConfigSchemaModel) is the source of truth for
        // shader layer shape - including per-shader params, typed control envelopes, and group
        // recursion. We adapt it for the session format (drop runtime `tiledImages`, add authored
        // `dataReferences`) and embed it under our $defs. The legacy docs model is no longer
        // queried; the new schema covers everything we previously hand-rolled.
        const rendererSchema = configurator?.compileConfigSchemaModel
            ? configurator.compileConfigSchemaModel()
            : null;
        const sessionShaderDefs = buildSessionShaderDefs(rendererSchema);

        const defs = {
            DataID: {
                description: "Deployment-specific data identifier. Kept generic for now.",
                oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }]
            },
            ViewportSetup: buildObjectSchemaFromFields(viewportSetupFields),
            SlideSourceOptions: buildObjectSchemaFromFields(slideSourceOptionsFields),
            DataOverride: (() => {
                const dataOverrideSchema = buildObjectSchemaFromFields(dataOverrideFields, {
                    dataID: { $ref: "#/$defs/DataID" },
                    options: { $ref: "#/$defs/SlideSourceOptions" }
                });
                delete dataOverrideSchema.properties.tileSource;
                dataOverrideSchema.description = "Viewer-session data override. Runtime-only tileSource instances are intentionally excluded.";
                return dataOverrideSchema;
            })(),
            DataSpecification: {
                anyOf: [{ $ref: "#/$defs/DataID" }, { $ref: "#/$defs/DataOverride" }]
            }
        };

        if (sessionShaderDefs.available) {
            // Embed the renderer's typed control envelopes verbatim. The session-flavored shader
            // layer schemas reference them via `$ref: #/$defs/uiControlEnvelopes/<type>`.
            defs.uiControlEnvelopes = sessionShaderDefs.rendererTypedefs;
            // Per-shader session-flavored layer schemas (`SessionShaderLayer_<type>`).
            Object.assign(defs, sessionShaderDefs.sessionLayerDefs);
            defs.BackgroundShaderGroupOrLayer = {
                description: "One authored background shader layer. Schema is the renderer's, adapted: tiledImages stripped, dataReferences added.",
                oneOf: sessionShaderDefs.backgroundOneOf
            };
            defs.VisualizationShaderGroupOrLayer = {
                description: "One authored visualization shader layer. Same as background but every non-group layer must declare `dataReferences`.",
                oneOf: sessionShaderDefs.visualizationOneOf
            };
        } else {
            // Renderer schema unavailable (older renderer build, or schema compile failed). Fall
            // back to a permissive placeholder so sessions still validate structurally.
            defs.BackgroundShaderGroupOrLayer = {
                type: "object",
                additionalProperties: true,
                description: "Renderer schema unavailable - shader layer shape not enforced."
            };
            defs.VisualizationShaderGroupOrLayer = defs.BackgroundShaderGroupOrLayer;
        }

        const backgroundSchema = buildObjectSchemaFromFields(backgroundFields, {
            dataReference: { type: "integer", minimum: 0 },
            shaders: {
                type: "array",
                items: { $ref: "#/$defs/BackgroundShaderGroupOrLayer" },
                description: "Optional authored background shader stack. The viewer later resolves dataReferences into runtime tiledImages."
            },
            options: { $ref: "#/$defs/SlideSourceOptions" }
        });

        const visualizationSchema = buildObjectSchemaFromFields(visualizationFields, {
            shaders: {
                type: "object",
                additionalProperties: { $ref: "#/$defs/VisualizationShaderGroupOrLayer" }
            }
        });

        const paramProperties = {};
        for (const [key, meta] of Object.entries(setupFields || {})) {
            const typedSchema = PARAM_ENUMS[key]
                ? { type: "string", enum: PARAM_ENUMS[key] }
                : schemaFromTsType(meta.type);
            paramProperties[key] = mergeSchemaWithDefault(typedSchema, payload?.paramsDefaults?.[key]);
        }
        for (const [key, value] of Object.entries(payload?.paramsDefaults || {})) {
            if (!paramProperties[key]) {
                paramProperties[key] = inferSchemaFromDefault(value, key);
            }
        }

        const schema = {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            title: `${payload?.viewer?.name || "xOpat"} Session Schema`,
            description: "Deployment-aware viewer session schema assembled from config.json defaults, viewer session types, parse-input handling, and the renderer's published JSON Schema (shader layer shapes are reused verbatim, adapted for session-format data wiring).",
            type: "object",
            required: ["data"],
            properties: {
                params: {
                    type: "object",
                    properties: paramProperties,
                    additionalProperties: false,
                    default: payload?.paramsDefaults || {}
                },
                data: {
                    type: "array",
                    items: { $ref: "#/$defs/DataSpecification" }
                },
                background: {
                    type: "array",
                    items: backgroundSchema
                },
                visualizations: {
                    type: "array",
                    items: visualizationSchema
                },
                plugins: {
                    // Plugin live-session config shape is not introspectable from the host today
                    // (include.json defaults describe admin-time static metadata, not the runtime
                    // session API). We accept any plugin id mapping to any object; per-plugin
                    // validation can be wired later if plugins start publishing schema fragments.
                    type: "object",
                    description: "Map of plugin id -> per-plugin session config object. Per-plugin shape is not enforced at this layer; validation belongs to the plugin owner.",
                    additionalProperties: { type: "object", additionalProperties: true },
                    default: {}
                }
            },
            additionalProperties: false,
            anyOf: [
                {
                    description: "A session must declare at least one background OR at least one visualization. Empty sessions have nothing to render.",
                    required: ["background"],
                    properties: {
                        background: { type: "array", minItems: 1 }
                    }
                },
                {
                    required: ["visualizations"],
                    properties: {
                        visualizations: { type: "array", minItems: 1 }
                    }
                }
            ],
            $defs: defs
        };

        if (includeExtensions) {
            const slideProtocols = payload?.clientDefaults?.slide_protocols || null;
            const bgDefaultId = payload?.clientDefaults?.default_background_protocol || null;
            const vizDefaultId = payload?.clientDefaults?.default_visualization_protocol || null;
            const bgDefaultTpl = (slideProtocols && bgDefaultId) ? slideProtocols[bgDefaultId] : null;
            const vizDefaultTpl = (slideProtocols && vizDefaultId) ? slideProtocols[vizDefaultId] : null;
            // Prefer the new registry hint, fall back to legacy fields.
            backgroundSchema["x-defaultProtocol"] = bgDefaultTpl ?? payload?.clientDefaults?.image_group_protocol ?? null;
            backgroundSchema["x-defaultServer"] = bgDefaultTpl ? null : (payload?.clientDefaults?.image_group_server ?? null);
            visualizationSchema["x-defaultProtocol"] = vizDefaultTpl ?? payload?.clientDefaults?.data_group_protocol ?? null;
            visualizationSchema["x-defaultServer"] = vizDefaultTpl ? null : (payload?.clientDefaults?.data_group_server ?? null);
            // Full registry exposed for tooling that wants the list of protocol names.
            if (slideProtocols) {
                backgroundSchema["x-slideProtocols"] = slideProtocols;
                visualizationSchema["x-slideProtocols"] = slideProtocols;
            }

            schema.properties.params["x-source"] = "src/config.json#setup";
            schema.properties.data["x-source"] = "src/types/app.d.ts#DataSpecification";
            schema.properties.background["x-source"] = "src/README.md + src/parse-input.js + src/app.ts + src/types/app.d.ts#BackgroundItem";
            schema.properties.visualizations["x-source"] = "src/README.md + src/parse-input.js + src/app.ts + src/types/app.d.ts#VisualizationItem";
            schema.properties.plugins["x-source"] = "server plugin records merged with deployment ENV";

            schema["x-sessionParts"] = {
                background: backgroundSchema,
                visualization: visualizationSchema
            };
            schema["x-entrypoints"] = {
                postBody: { field: "visualization" },
                query: ["visualization", "slides", "masks"],
                hash: "urlencoded visualization JSON"
            };
            schema["x-runtimeNotes"] = {
                backgroundDataReference: "Published session schema uses data indexes. The viewer may internally resolve richer runtime objects later.",
                tiledImages: "Not part of authored session input. Computed by app.ts before passing shader config to the renderer.",
                shaderLayerSource: "Shader layer schemas under $defs.SessionShaderLayer_* are derived from the renderer's compileConfigSchemaModel(). The full renderer schema is the source of truth; the session adapter only strips runtime-only fields and adds session-format wiring."
            };
            // Slim per-shader summary derived directly from the renderer schema we already embedded.
            // No second source of truth - this is purely a tooling convenience.
            if (sessionShaderDefs.available && rendererSchema && rendererSchema.$defs && rendererSchema.$defs.shaderLayers) {
                const catalog = {};
                for (const [type, layerSchema] of Object.entries(rendererSchema.$defs.shaderLayers)) {
                    catalog[type] = {
                        type,
                        name: layerSchema.title || type,
                        description: layerSchema.description || "",
                        intent: layerSchema["x-intent"] || "",
                        expects: layerSchema["x-expects"] || {}
                    };
                }
                schema["x-shaderCatalog"] = catalog;
            }
            schema["x-deployment"] = {
                viewer: payload?.viewer || {},
                pluginIds: Object.keys(payload?.plugins || {})
            };
        }

        return schema;
    }

    window.XOpatScheme = { buildSchema };
})();
