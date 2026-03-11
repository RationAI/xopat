export type AnyFn = (...args: any[]) => any;

export type MethodKeys<T> = {
    [K in keyof T]-?: T[K] extends AnyFn ? K : never;
}[keyof T] & string;

export type ScriptApiObject = {
    readonly namespace: string;
    readonly name: string;
    readonly description: string;
};

export type NamespaceSchema<TApi extends ScriptApiObject = ScriptApiObject> = {
    __self__: boolean;
    name: string;
    description: string;
    _docs?: Partial<Record<MethodKeys<TApi>, string>>;
    params?: Partial<Record<MethodKeys<TApi>, Array<{ name: string; type: string }>>>;
    returnType?: Partial<Record<MethodKeys<TApi>, string>>;
    tsSignature?: Partial<Record<MethodKeys<TApi>, string>>;
    tsDeclaration?: Partial<Record<MethodKeys<TApi>, string>>;
    namespaceTsDeclaration?: string;
} & Partial<Record<MethodKeys<TApi>, boolean>>;

export type ScriptApiNamespace = Record<string, AnyFn>;
export type ScriptApiNamespaces = Record<string, ScriptApiNamespace>;
export type ViewerActionMap<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> = Record<string, AnyFn>;

export type NamespacesState<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> = {
    [K in keyof TNamespaces]?: NamespaceSchema<TNamespaces[K]>;
} & Record<string, NamespaceSchema>;

export type WorkerRecord = {
    worker: Worker;
    channel: MessageChannel;
};

export type ApiCallMessage = {
    type: "api-call";
    callId: string;
    namespace: string;
    method: string;
    params: any[];
};

export type ApiResponseMessage = {
    type: "api-response";
    callId: string;
    result?: unknown;
    error?: string;
};

export type WorkerInitMessage = {
    type: "init";
};

export type ApiMethodDoc<T extends AnyFn> = {
    name: string;
    description?: string;
    params: Array<{ name: string; type: string }>;
    returns: string;
    tsSignature?: string;
    tsDeclaration?: string;
};

export type ApiNamespaceDoc<TNamespace extends ScriptApiNamespace> = {
    namespace: string;
    methods: {
        [K in keyof TNamespace & string]: ApiMethodDoc<TNamespace[K]>;
    };
    tsDeclaration?: string;
};

export interface AllowedScriptApiManifest {
    namespaces: Array<{
        namespace: string;
        name: string;
        description?: string;
        tsDeclaration?: string;
        methods: Array<{
            name: string;
            description?: string;
            params: Array<{ name: string; type: string }>;
            returns: string;
            tsSignature?: string;
            tsDeclaration?: string;
        }>;
    }>;
}

export type ParsedDts = {
    namespaceTsDeclaration?: string;
    tsSignature: Record<string, string>;
    tsDeclaration: Record<string, string>;
    params: Record<string, Array<{ name: string; type: string }>>;
    returnType: Record<string, string>;
    docs: Record<string, string>;
};

export type DtypesSource =
    | { kind: "url"; value: string }
    | { kind: "text"; value: string }
    | { kind: "resolve"; value: () => string | Promise<string> };

/**
 * You can provide types manually via the following metadata properties.
 * Optionally, you can define a *.d.ts typescript definition for your API
 * and just ingest it like so:
 * class MyScriptApi implements MyScriptApiInterface {
 *     static ScriptApiMetadata = {
 *          // point to type where interface MyScriptApiInterface extends ScriptApiObject lives
 *          dtypesSource: {
 *            kind: "url",
 *            value: APPLICATION_CONTEXT.url + "plugins/my-plugin/my-api.scripts.d.ts"
 *          }
 *          //or
 *          dtypesSource: {
 *            kind: "resolve",
 *            value: async () => {
 *              const res = await import("./my-api.scripts.d.ts");
 *              return await res.text();
 *            }
 *          }
 *     };
 * }
 */
export interface ScriptApiMetadata<TApi extends ScriptApiObject = ScriptApiObject> {
    namespaceTsDeclaration?: string;
    docs?: Partial<Record<MethodKeys<TApi>, string>>;
    params?: Partial<Record<MethodKeys<TApi>, Array<{ name: string; type: string }>>>;
    returnType?: Partial<Record<MethodKeys<TApi>, string>>;
    tsSignature?: Partial<Record<MethodKeys<TApi>, string>>;
    tsDeclaration?: Partial<Record<MethodKeys<TApi>, string>>;
    dtypesSource?: DtypesSource;
}

export interface ScriptManagerStatic<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> {
    __self: ScriptingManager<TNamespaces> | undefined;
    instance(viewerActions?: ViewerActionMap<TNamespaces>, apiTimeout?: number): ScriptingManager<TNamespaces>;
    instantiated(): boolean;
}

export type ScriptNamespaceConsentEntry = {
    title: string;
    granted: boolean;
};

export interface AllowedScriptApiManifest {
    namespaces: Array<{
        namespace: string;
        tsDeclaration?: string;
        methods: Array<{
            name: string;
            description?: string;
            params: Array<{ name: string; type: string }>;
            returns: string;
            tsSignature?: string;
            tsDeclaration?: string;
        }>;
    }>;
}