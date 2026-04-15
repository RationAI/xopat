(function () {
    const PARAM_ENUMS = {
        theme: ["auto", "light", "dark_dimmed", "dark"],
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
            return { anyOf: type.split("|").map(part => schemaFromTsType(part.trim())) };
        }
        if (type.includes("OpenSeadragon.TileSource")) {
            return { description: "Runtime-only OpenSeadragon.TileSource instance; not serializable through session JSON." };
        }
        return {};
    }

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

        return {
            ...schema,
            type: Array.isArray(schema.type) ? schema.type.concat("null") : [schema.type].filter(Boolean).concat("null"),
            default: null
        };
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

    function normalizeShaderDocsCollection(shaderModel) {
        const shaders = shaderModel?.shaders;
        if (Array.isArray(shaders)) {
            return shaders.filter(entry => entry && typeof entry === "object");
        }
        if (shaders && typeof shaders === "object") {
            return Object.values(shaders).filter(entry => entry && typeof entry === "object");
        }
        return [];
    }

    function sanitizeShaderCatalogEntry(entry) {
        const type = typeof entry?.type === "string" ? entry.type : undefined;
        if (!type) return null;

        const result = {
            type,
            name: typeof entry?.name === "string" ? entry.name : type
        };

        if (Array.isArray(entry?.inputs)) {
            result.inputs = entry.inputs.map(input => {
                const sanitizedInput = {};
                if (Number.isInteger(input?.index)) sanitizedInput.index = input.index;
                if (Array.isArray(input?.acceptedChannelCounts)) sanitizedInput.acceptedChannelCounts = input.acceptedChannelCounts;
                if (typeof input?.description === "string") sanitizedInput.description = input.description;
                return sanitizedInput;
            });
        }

        if (entry?.parameters && typeof entry.parameters === "object") {
            result.parameters = stripClassDocs(entry.parameters);
        } else if (entry?.params && typeof entry.params === "object") {
            result.parameters = stripClassDocs(entry.params);
        } else if (Array.isArray(entry?.controls)) {
            result.parameters = stripClassDocs(entry.controls);
        }

        return result;
    }

    function stripClassDocs(value) {
        if (Array.isArray(value)) {
            return value.map(item => stripClassDocs(item));
        }
        if (!value || typeof value !== "object") {
            return value;
        }

        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            if (key === "classDocs") continue;
            result[key] = stripClassDocs(entry);
        }
        return result;
    }

    function buildShaderCatalog(shaderModel) {
        const byType = {};
        for (const shader of normalizeShaderDocsCollection(shaderModel)) {
            const sanitized = sanitizeShaderCatalogEntry(shader);
            if (sanitized) {
                byType[sanitized.type] = sanitized;
            }
        }
        return byType;
    }

    function buildShaderLayerBaseSchema(shaderCatalog, { requireDataReferences = false, allowGroupType = true } = {}) {
        const shaderTypes = Object.keys(shaderCatalog || {});
        const allowedTypes = allowGroupType ? shaderTypes.concat("group") : shaderTypes;
        const properties = {
            id: { type: "string" },
            type: { type: "string", enum: allowedTypes },
            name: { type: "string" },
            visible: { anyOf: [{ type: "integer", enum: [0, 1] }, { type: "boolean" }] },
            fixed: { type: "boolean" },
            dataReferences: { type: "array", items: { type: "integer", minimum: 0 } },
            params: {
                type: "object",
                additionalProperties: true,
                description: "Shader parameter values authored in the viewer session."
            },
            cache: {
                type: "object",
                additionalProperties: true,
                description: "Optional viewer snapshot/cache payload persisted with the session."
            }
        };
        const required = ["type"];
        if (requireDataReferences) {
            required.push("dataReferences");
        }

        return {
            type: "object",
            properties,
            required,
            additionalProperties: true
        };
    }

    function buildPluginSchemas(plugins) {
        const properties = {};
        for (const [pluginId, pluginRecord] of Object.entries(plugins || {})) {
            const defaults = pluginRecord?.defaults || {};
            const nestedProperties = {};
            for (const [key, value] of Object.entries(defaults)) {
                nestedProperties[key] = inferSchemaFromDefault(value, key);
            }
            properties[pluginId] = {
                type: "object",
                title: pluginRecord?.meta?.name || pluginId,
                description: pluginRecord?.meta?.description || "",
                properties: nestedProperties,
                default: defaults,
                additionalProperties: true
            };
        }
        return properties;
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
        const shaderModel = configurator?.compileDocsModel ? configurator.compileDocsModel() : null;
        const shaderCatalog = buildShaderCatalog(shaderModel);
        const backgroundLayerBaseSchema = buildShaderLayerBaseSchema(shaderCatalog, { requireDataReferences: false, allowGroupType: false });
        const visualizationLayerBaseSchema = buildShaderLayerBaseSchema(shaderCatalog, { requireDataReferences: true, allowGroupType: false });

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
            },
            BackgroundShaderLayer: backgroundLayerBaseSchema,
            BackgroundShaderGroup: {
                allOf: [
                    {
                        ...backgroundLayerBaseSchema,
                        properties: {
                            ...backgroundLayerBaseSchema.properties,
                            type: { const: "group" }
                        },
                        required: ["type"]
                    },
                    {
                        type: "object",
                        properties: {
                            shaders: {
                                type: "object",
                                additionalProperties: { $ref: "#/$defs/BackgroundShaderGroupOrLayer" }
                            },
                            order: { type: "array", items: { type: "string" } }
                        }
                    }
                ]
            },
            VisualizationShaderLayer: visualizationLayerBaseSchema,
            VisualizationShaderGroup: {
                allOf: [
                    {
                        ...visualizationLayerBaseSchema,
                        properties: {
                            ...visualizationLayerBaseSchema.properties,
                            type: { const: "group" }
                        },
                        required: ["type"]
                    },
                    {
                        type: "object",
                        properties: {
                            shaders: {
                                type: "object",
                                additionalProperties: { $ref: "#/$defs/VisualizationShaderGroupOrLayer" }
                            },
                            order: { type: "array", items: { type: "string" } }
                        }
                    }
                ]
            }
        };
        defs.BackgroundShaderGroupOrLayer = {
            anyOf: [{ $ref: "#/$defs/BackgroundShaderLayer" }, { $ref: "#/$defs/BackgroundShaderGroup" }]
        };
        defs.VisualizationShaderGroupOrLayer = {
            anyOf: [{ $ref: "#/$defs/VisualizationShaderLayer" }, { $ref: "#/$defs/VisualizationShaderGroup" }]
        };

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
            description: "Deployment-aware viewer session schema assembled from config.json defaults, server plugin records, viewer session types, parse-input handling, and viewer-side shader support metadata.",
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
                    type: "object",
                    properties: buildPluginSchemas(payload?.plugins || {}),
                    additionalProperties: false,
                    default: {}
                }
            },
            additionalProperties: false,
            anyOf: [
                {
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
            backgroundSchema["x-defaultProtocol"] = payload?.clientDefaults?.image_group_protocol ?? null;
            backgroundSchema["x-defaultServer"] = payload?.clientDefaults?.image_group_server ?? null;
            visualizationSchema["x-defaultProtocol"] = payload?.clientDefaults?.data_group_protocol ?? null;
            visualizationSchema["x-defaultServer"] = payload?.clientDefaults?.data_group_server ?? null;

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
                tiledImages: "Not part of authored session input. Computed by app.ts before passing shader config to the renderer."
            };
            schema["x-shaderCatalog"] = shaderCatalog;
            schema["x-deployment"] = {
                viewer: payload?.viewer || {},
                pluginIds: Object.keys(payload?.plugins || {})
            };
        }

        return schema;
    }

    window.XOpatScheme = { buildSchema };
})();
