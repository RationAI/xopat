export type AnyFn = (...args: any[]) => any;

export type MethodKeys<T> = {
    [K in keyof T]-?: T[K] extends AnyFn ? K : never;
}[keyof T] & string;

export type ScriptApiObject = {
    readonly namespace: string;
    readonly name: string;
    readonly description: string;
};


export type HostScriptContext = Pick<
    ScriptingContextState,
    "id" | "label" | "metadata" | "activeViewerContextId" | "bypassConsentDialog"
> & {
    getActiveViewerContextId(): string | null;
    setActiveViewerContextId(contextId: string | null | undefined): unknown;
    isConsentDialogBypassed(): boolean;
    setBypassConsentDialog(value: boolean): unknown;
    /**
     * Optional viewer-id / name aliasing (default: identity). A consumer (e.g. the chat
     * module, which streams viewer context to an upstream LLM) may install a resolver so
     * the model only ever sees opaque handles instead of real slide identifiers/names.
     * Core scripting installs nothing → identity → unchanged local behavior. See
     * `setViewerIdAlias`. Callers must treat all three as optional (`?.` + fallback to the
     * raw id/name), since synthetic in-process contexts omit them.
     */
    setViewerIdAlias?(alias: ViewerIdAlias | null): unknown;
    /** Real viewer id → opaque handle for values leaving the host toward the model. */
    toPresentedViewerId?(id: string): string;
    /** Opaque handle → real viewer id for values arriving from the model. */
    toInternalViewerId?(id: string): string;
    /** Real viewer name → shown name (may be masked to the handle by the consumer's policy). */
    presentViewerName?(realId: string, name: string | null | undefined): string | null;
    /**
     * Session-scoped consent cache (optional — synthetic in-process contexts omit
     * it and then every action re-prompts). Runtime memory only, never serialized.
     */
    rememberActionConsent?(cacheKey: string): unknown;
    isActionConsented?(cacheKey: string): boolean;
};

export type ScriptApiInvocationContext = {
    scriptingContext: HostScriptContext;
};

/**
 * Pluggable viewer-identity aliasing installed on a scripting context. All fields are
 * optional and default to identity when absent. Used to keep real slide identifiers/names
 * out of data that leaves the host toward an untrusted upstream (e.g. an LLM), while
 * tool-call round-trips stay reliable because the handle is a stable opaque join key.
 */
export type ViewerIdAlias = {
    /** Opaque handle → real viewer id (arriving from the model). */
    toInternal?: (id: string) => string;
    /** Real viewer id → opaque handle (leaving toward the model). */
    toPresented?: (id: string) => string;
    /** Real viewer name → shown name (may mask to the handle under the consumer's policy). */
    presentName?: (realId: string, name: string | null | undefined) => string | null;
};

export type ContextAwareHostAction = AnyFn & {
    __scriptingContextAware?: boolean;
};


export type NamespaceSchema<TApi extends ScriptApiObject = ScriptApiObject> = {
    __self__: boolean;
    name: string;
    description: string;
    /** Namespace exposes identifying / patient-sensitive data (informational; see XOpatScriptingApi.sensitive). */
    sensitive?: boolean;
    _docs?: Partial<Record<MethodKeys<TApi>, string>>;
    params?: Partial<Record<MethodKeys<TApi>, Array<{ name: string; type: string }>>>;
    returnType?: Partial<Record<MethodKeys<TApi>, string>>;
    tsSignature?: Partial<Record<MethodKeys<TApi>, string>>;
    tsDeclaration?: Partial<Record<MethodKeys<TApi>, string>>;
    namespaceTsDeclaration?: string;
} & Partial<Record<MethodKeys<TApi>, boolean>>;

export type ScriptApiNamespace = Record<string, AnyFn>;
export type ScriptApiNamespaces = Record<string, ScriptApiNamespace>;
export type ViewerActionMap<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> = Record<string, ContextAwareHostAction>;

export type NamespacesState<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> = {
    [K in keyof TNamespaces]?: NamespaceSchema<TNamespaces[K]>;
} & Record<string, NamespaceSchema>;

export type ScriptingContextState = {
    id: string;
    label?: string;
    metadata?: Record<string, unknown>;
    activeViewerContextId?: string | null;
    bypassConsentDialog?: boolean;
    workerIds: string[];
    createdAt: number;
    lastUsedAt: number;
};

export type ExecuteScriptOptions = {
    workerId?: string;
    reuseWorker?: boolean;
};

export type WorkerRecord = {
    worker: Worker;
    channel: MessageChannel;
    contextId: string;
    createdAt: number;
    lastUsedAt: number;
    reusable?: boolean;
    /** True once the worker has run its first `run` message (stubs + hardening installed). */
    initialized?: boolean;
    /** The execId of the run currently owning this worker; gates stale api-calls/results. */
    currentExecId?: string | null;
    /** In-flight script runs keyed by execId (a reusable worker runs several over its life). */
    runs?: Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: unknown) => void;
        timeoutId: ReturnType<typeof setTimeout>;
    }>;
    /** Serialization tail for a reusable worker: the next run chains after this settles. */
    busyTail?: Promise<unknown>;
};

/** Structured, code-free description of the namespaces a worker may expose. */
export type WorkerNamespaceManifest = Array<{
    namespace: string;
    methods: string[];
}>;

export type ApiCallMessage = {
    type: "api-call";
    /** Which script run issued this call; host rejects calls from a stale run. */
    execId: string;
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

/** Worker → host: a script finished (or threw). */
export type WorkerResultMessage = {
    execId: string;
    result?: unknown;
    error?: string;
};

/** Worker → host: emitted once by a freshly-spawned pooled worker. */
export type WorkerReadyMessage = {
    type: "ready";
};

/**
 * Host → worker: execute a script. On the first run for a worker the host also
 * sends `namespaces` (built stubs + hardening); subsequent runs on a reusable
 * worker omit it. The secure MessagePort is transferred alongside the first run.
 */
export type RunWorkerMessage = {
    type: "run";
    execId: string;
    script: string;
    apiTimeout: number;
    /** Present on the first run only; code-free namespace description. */
    namespaces?: WorkerNamespaceManifest;
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

export type ExternalScriptApiRegistrar<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> =
    (manager: ScriptingManager<TNamespaces>) => void | Promise<void>;

export type ExternalScriptApiRegistration<TNamespaces extends ScriptApiNamespaces = ScriptApiNamespaces> = {
    registrar: ExternalScriptApiRegistrar<TNamespaces>;
    label?: string;
};

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
    __externalApiRegistrations?: Array<ExternalScriptApiRegistration<TNamespaces>>;
    instance(viewerActions?: ViewerActionMap<TNamespaces>, apiTimeout?: number): ScriptingManager<TNamespaces>;
    instantiated(): boolean;
    registerExternalApi(
        registrar: ExternalScriptApiRegistrar<TNamespaces>,
        options?: { label?: string }
    ): Promise<void> | void;
}

export type ScriptNamespaceConsentEntry = {
    title: string;
    description?: string;
    granted: boolean;
    /** Namespace exposes identifying / patient-sensitive data. */
    sensitive?: boolean;
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