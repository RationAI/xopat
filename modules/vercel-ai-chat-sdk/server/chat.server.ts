import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ChatServerRegistry, type ChatProviderAdapter } from './chatRegistry.server';

const LLM_DEBUG = true;

function llmLog(label: string, data: any) {
    if (!LLM_DEBUG) return;

    try {
        console.log(`[LLM DEBUG] ${label}`, JSON.stringify(data, null, 2));
    } catch {
        console.log(`[LLM DEBUG] ${label}`, data);
    }
}

export const policy = {
    ensureModelCapabilities: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 30_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    registerProviderType: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    listProviderTypes: {
        auth: { public: true, requireSession: false },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    createProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    listProviders: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    getProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    updateProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    deleteProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    listModels: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    createSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    listSessions: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    getSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    renameSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    deleteSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    uploadAttachment: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 10_000, maxBodyBytes: 12 * 1024 * 1024, maxConcurrency: 5, queueLimit: 20 },
    },
    appendMessages: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 512 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    sendTurn: {
        auth: { public: false, requireSession: true },
        runtime: {
            timeoutMs: 60_000,
            maxBodyBytes: 512 * 1024,
            maxConcurrency: 5,
            queueLimit: 25,
            circuitBreaker: { key: 'chat-upstream', failureThreshold: 5, resetAfterMs: 30_000 },
        },
    },
} as const;

function getRegistry() {
    return ChatServerRegistry.instance();
}

function ensureSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

function summarizePart(part: any) {
    if (!part) return null;
    return {
        type: part.type,
        mimeType: part.mimeType,
        hasDataUrl: !!part.dataUrl,
        hasUrl: !!part.url,
        name: part.name || null,
        dataUrlLen: typeof part.dataUrl === 'string' ? part.dataUrl.length : 0,
    };
}

function summarizeModelPart(part: any) {
    return {
        type: part?.type,
        mediaType: part?.mediaType,
        hasImage: typeof part?.image === 'string' ? true : false,
        imageLen: typeof part?.image === 'string' ? part.image.length : 0,
        hasData: typeof part?.data === 'string' ? true : false,
        dataLen: typeof part?.data === 'string' ? part.data.length : 0,
        filename: part?.filename || null,
        textLen: typeof part?.text === 'string' ? part.text.length : 0,
    };
}

function summarizeModelMessage(msg: any) {
    if (typeof msg?.content === 'string') {
        return { role: msg?.role, contentType: 'string', chars: msg.content.length };
    }
    if (Array.isArray(msg?.content)) {
        return {
            role: msg?.role,
            contentType: 'array',
            parts: msg.content.map(summarizeModelPart),
        };
    }
    return { role: msg?.role, contentType: typeof msg?.content };
}

function defaultPersonality(): ChatPersonality {
    return {
        id: 'default',
        label: 'Default',
        systemPrompt: `
You are an assistant integrated into xOpat pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.
Your users include pathologists, clinicians, students and researchers including IT specialists.

Integration notes:
- You only know what the user explicitly writes in chat unless additional capabilities are granted through the scripting API.
- You may receive access to a scripting API. Only use explicitly allowed namespaces.
- You MUST NOT guess on facts. If information is missing, ask clarifying questions.

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).
If scripting is available and useful, prefer doing the work silently rather than talking about the script itself.
Match the selected personality. For non-technical users, avoid technical language and implementation details unless explicitly requested.
    `
    };
}

function ensureDefaultPersonality() {
    const registry = getRegistry();
    if (!registry.getPersonality('default')) {
        registry.registerPersonality(defaultPersonality());
    }
}

function buildAttachmentIndex(attachments: ChatAttachmentRecord[] = []): Map<string, ChatAttachmentRecord> {
    return new Map(attachments.map((att) => [att.id, att]));
}

function resolvePartPayload(
    part: any,
    attachmentIndex?: Map<string, ChatAttachmentRecord>
): { source: string; mimeType?: string; name?: string } {
    const attachment = part?.attachmentId ? attachmentIndex?.get(part.attachmentId) : undefined;
    return {
        source: String(part?.dataUrl || part?.url || attachment?.dataUrl || '').trim(),
        mimeType: part?.mimeType || attachment?.mimeType || undefined,
        name: part?.name || attachment?.name || undefined,
    };
}


function dataUrlToBytes(value: string | undefined | null): { bytes: Uint8Array | null; mediaType?: string } {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (!match) return { bytes: null };

    const mediaType = match[1] || undefined;
    const base64 = match[2] || '';
    const buf = Buffer.from(base64, 'base64');
    return { bytes: new Uint8Array(buf), mediaType };
}

function buildOpenAICompatibleHeaders(config: Record<string, unknown>, secrets: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = typeof secrets.apiKey === 'string' && secrets.apiKey ? String(secrets.apiKey) : '';
    const headerName = typeof config.apiKeyHeader === 'string' && config.apiKeyHeader ? String(config.apiKeyHeader) : 'Authorization';
    if (apiKey) {
        headers[headerName] = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
    }
    const headersJson = typeof config.headersJson === 'string' ? config.headersJson.trim() : '';
    if (headersJson) {
        try {
            const extra = JSON.parse(headersJson);
            if (extra && typeof extra === 'object') {
                for (const [key, value] of Object.entries(extra)) {
                    if (value != null) headers[key] = String(value);
                }
            }
        } catch (_error) {
            throw new Error('Invalid headersJson. Expected a JSON object.');
        }
    }
    return headers;
}

function ensureBuiltinAdapters() {
    const registry = getRegistry();

    if (!registry.getAdapter('openai-compatible')) {
        const adapter: ChatProviderAdapter = {
            id: 'openai-compatible',
            async listModels({ ctx, config, secrets, type }) {
                const baseURL = String(config.baseUrl || config.baseURL || '').trim();
                if (!baseURL) return [];
                const modelsPath = String(config.modelsPath || '/models');
                const url = new URL(modelsPath, ensureSlash(baseURL)).toString();
                const headers = buildOpenAICompatibleHeaders(config, secrets);
                const res = await fetch(url, {
                    method: 'GET',
                    headers,
                    signal: ctx?.signal,
                });
                if (!res.ok) throw new Error(`Model discovery failed: ${res.status} ${res.statusText}`);
                const json = await res.json();
                const data = Array.isArray(json?.data) ? json.data : [];
                return data.map((item: any): ChatProviderModelInfo => {
                    const capabilities = inferCapabilitiesFromModelItem(item);

                    return {
                        id: String(item.id),
                        label: item?.name || String(item.id),
                        description: item?.description || undefined,
                        multimodal: capabilities.images === 'supported' || capabilities.files === 'supported',
                        supportsFiles: capabilities.files === 'supported',
                        supportsImages: capabilities.images === 'supported',
                        supportsToolCalls: type.supportsToolCalls,
                        capabilities,
                    };
                });
            },
            resolveModel({ instance, modelId, config, secrets }) {
                const baseURL = String(config.baseUrl || config.baseURL || '').trim();
                if (!baseURL) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
                const apiKey = typeof secrets.apiKey === 'string' && secrets.apiKey ? String(secrets.apiKey) : undefined;
                const headers = buildOpenAICompatibleHeaders(config, secrets);
                const provider = createOpenAICompatible({
                    name: instance.id,
                    baseURL,
                    apiKey,
                    headers,
                });
                return provider(modelId);
            },
        };
        registry.registerAdapter(adapter);
    }

    if (!registry.getProviderType('openai-compatible')) {
        registry.upsertProviderType({
            id: 'openai-compatible',
            label: 'OpenAI-compatible',
            description: 'Generic OpenAI-compatible endpoint. Plugin defaults may provide a visible default URL and hidden default token. Users may override both; secret values stay server-side.',
            adapter: 'openai-compatible',
            supportsUploads: true,
            supportsFiles: false,
            supportsImages: false,
            supportsToolCalls: false,
            configSchema: [
                { key: 'baseUrl', label: 'Base URL', input: 'url', required: true, placeholder: 'https://example.invalid/v1', description: 'OpenAI-compatible base URL, usually ending with /v1.' },
                { key: 'modelsPath', label: 'Models path', input: 'text', defaultValue: '/models', description: 'Relative or absolute path for model discovery.' },
                { key: 'apiKey', label: 'API key', input: 'password', secret: true, description: 'Optional static API key. Hidden in the UI after save and stored server-side only.' },
                { key: 'apiKeyHeader', label: 'API key header', input: 'text', defaultValue: 'Authorization' },
                { key: 'headersJson', label: 'Extra headers JSON', input: 'textarea', description: 'Optional JSON object with additional non-secret headers.' },
            ],
            source: 'builtin',
        });
    }
}

function scriptSystemContent(allowedScriptApi?: AllowedScriptApiManifest): string {
    if (!allowedScriptApi?.namespaces?.length) {
        return [
            'Scripting API access is currently disabled.',
            'Do not produce executable viewer scripts.',
            'Do not call scripting namespaces.',
            'If the user asks for automation, explain that scripting access is not currently granted.',
        ].join('\n');
    }

    const namespacesText = allowedScriptApi.namespaces.map((ns) => {
        const methods = ns.methods.map((method) => {
            const args = (method.params || []).map((p) => `${p.name}: ${p.type}`).join(', ');
            const signature = method.tsSignature || `${method.name}(${args}) => ${method.returns || 'void'}`;
            const description = method.description ? ` — ${method.description}` : '';
            const declaration = method.tsDeclaration ? `\n    TS: ${method.tsDeclaration}` : '';
            return `  - ${signature}${description}${declaration}`;
        }).join('\n');
        const namespaceDescription = ns.description ? ` — ${ns.description}` : '';
        const namespaceDeclaration = ns.tsDeclaration ? `\n  Namespace TS:\n  ${ns.tsDeclaration}` : '';
        return `- namespace ${ns.namespace}${namespaceDescription}${namespaceDeclaration}\n${methods}`;
    }).join('\n\n');

    return `Viewer scripting is available.

Scripting has priority whenever the allowed API can perform the task, inspect state, fetch viewer data, or automate a multi-step action.
When scripting can help, you MUST use it instead of describing manual steps.

Critical output rules:
- If you use scripting, return exactly one fenced code block with language tag xopat-script.
- Do NOT return XML, pseudo-XML, JSON call envelopes, function-call objects, or tags such as <call>, <message>, <start|assistant|>, commentary, or tool-call formats.
- Do NOT say "run this script", "execute this", "here is a script", "use the API", or similar technical wording unless the user explicitly asks for technical details.
- Your only executable output format is exactly one fenced code block tagged xopat-script like so: \`\`\`xopat-script [executable here] \`\`\`.
- Even if the scripting definition does not say it, you need to **await** all API method calls as they are being routed through asynchronous gate.
- If a requested action does not map cleanly to an allowed method, do not invent a method. Ask a brief clarification question or use the closest valid method sequence.
- Assume the application executes xopat-script automatically.
- For non-technical users, speak naturally about the result or next step, not about the implementation mechanism.
- Do not mention workers, async, namespaces, or code execution unless the user explicitly asks for technical details.
- Never invent namespaces or methods.
- The script must be using plain JavaScript + the allowed scripting API only. Do NOT use TypeScript syntax.
- Do not wrap explanations inside the code block.
- After successful tool execution, if the result contains numbers, measurements, coordinates, zoom values, ratios, or metadata, quote them directly and explain them briefly.

If scripting is not needed, answer normally in plain user-facing language.

Allowed scripting API:
${namespacesText}`;
}

function sessionPreamble(providerId: string, allowedScriptApi?: AllowedScriptApiManifest): string {
    const scriptNamespaces = allowedScriptApi?.namespaces?.map((n) => n.namespace).join(', ') || 'none';
    return `You are an assistant integrated into a pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.
Your users include pathologists, clinicians, students and researchers including IT specialists.

Integration notes:
- You only know what the user explicitly writes in chat unless additional capabilities are granted through the scripting API.
- You may receive access to a scripting API. Only use explicitly allowed namespaces.
- You MUST NOT guess on facts. If information is missing, ask clarifying questions.

Current session:
- Provider: ${providerId}
- Allowed scripting namespaces: ${scriptNamespaces}

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).
If scripting is available and useful, prefer doing the work silently rather than talking about the script itself.
Match the selected personality. For non-technical users, avoid technical language and implementation details unless explicitly requested.`;
}

function summarizeForTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((m) => m.role === 'user');
    const text = coerceMessageText(firstUser || null).trim();
    if (!text) return 'New chat';
    return text.slice(0, 80);
}

function coerceMessageText(message: ChatMessage | null | undefined): string {
    if (!message) return '';
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    const parts = message.parts || [];
    return parts.map((part) => {
        switch (part.type) {
            case 'text': return part.text;
            case 'host-feedback': return part.text;
            case 'script-result': return part.text;
            case 'image': return `[Image: ${part.name || part.mimeType}]`;
            case 'file': return `[File: ${part.name}]`;
            default: return '';
        }
    }).filter(Boolean).join('\n');
}

function normalizeIncomingMessage(message: ChatMessage): ChatMessage {
    if (message.parts?.length) {
        return {
            ...message,
            content: message.content || coerceMessageText(message),
            createdAt: message.createdAt || new Date().toISOString(),
        };
    }
    if (typeof message.content === 'string') {
        return {
            ...message,
            parts: [{ type: 'text', text: message.content }],
            createdAt: message.createdAt || new Date().toISOString(),
        };
    }
    return {
        ...message,
        parts: [],
        content: '',
        createdAt: message.createdAt || new Date().toISOString(),
    };
}

function stripDataUrlPrefix(value: string | undefined | null): { mediaType?: string; data: string } {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (match) {
        return { mediaType: match[1] || undefined, data: match[2] || '' };
    }
    return { data: raw };
}

function toModelMessage(
    message: ChatMessage,
    attachmentIndex?: Map<string, ChatAttachmentRecord>,
    capabilities?: ModelCapabilities | null
) {
    const role = message.role === 'tool' ? 'assistant' : message.role;
    const parts = message.parts || (message.content ? [{ type: 'text', text: message.content }] : []);

    if (role === 'system') {
        return {
            role: 'system',
            content: typeof message.content === 'string' && message.content.trim()
                ? message.content
                : coerceMessageText(message),
        } as any;
    }

    const content = parts.map((part) => {
        switch (part.type) {
            case 'text':
            case 'host-feedback':
            case 'script-result':
                return { type: 'text', text: part.text } as const;

            case 'image': {
                if (!mediaAllowedForModel('image', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[Image omitted for non-multimodal model: ${part.name}]` : '[Image omitted for non-multimodal model]',
                    } as const;
                }

                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytes(resolved.source);

                if (inline.bytes) {
                    return {
                        type: 'image',
                        image: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'image/*',
                    } as const;
                }

                if (/^https?:\/\//i.test(resolved.source)) {
                    return {
                        type: 'image',
                        image: resolved.source,
                        mediaType: resolved.mimeType || 'image/*',
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[Image unavailable: ${resolved.name}]` : '[Image unavailable]',
                } as const;
            }

            case 'file': {
                if (!mediaAllowedForModel('file', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[File omitted for unsupported model: ${part.name}]` : '[File omitted for unsupported model]',
                    } as const;
                }
                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytes(resolved.source);

                if (inline.bytes) {
                    return {
                        type: 'file',
                        data: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'application/octet-stream',
                        filename: resolved.name,
                    } as const;
                }

                if (/^https?:\/\//i.test(resolved.source)) {
                    return {
                        type: 'file',
                        data: resolved.source,
                        mediaType: resolved.mimeType || 'application/octet-stream',
                        filename: resolved.name,
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[File unavailable: ${resolved.name}]` : '[File unavailable]',
                } as const;
            }

            default:
                return { type: 'text', text: '' } as const;
        }
    });

    if (content.length === 1 && content[0]!.type === 'text') {
        return { role, content: content[0]!.text } as any;
    }

    return { role, content } as any;
}

function mediaAllowedForModel(
    partType: 'image' | 'file',
    capabilities?: ModelCapabilities | null
): boolean {
    if (!capabilities) return true;
    if (partType === 'image') return capabilities.images === 'supported';
    return capabilities.files === 'supported';
}

function capabilityFromBool(value: any): CapabilityState {
    return value === true ? 'supported' : value === false ? 'unsupported' : 'unknown';
}

function inferCapabilitiesFromModelItem(item: any): ModelCapabilities {
    const modalities = Array.isArray(item?.modalities)
        ? item.modalities.map((v: any) => String(v).toLowerCase())
        : [];

    const inputModalities = Array.isArray(item?.input_modalities)
        ? item.input_modalities.map((v: any) => String(v).toLowerCase())
        : [];

    const caps = item?.capabilities && typeof item.capabilities === 'object' ? item.capabilities : {};

    const imageHint =
        item?.supportsImages ??
        item?.supports_images ??
        item?.vision ??
        item?.supportsVision ??
        caps?.images ??
        caps?.vision ??
        (modalities.includes('image') || inputModalities.includes('image') ? true : undefined);

    const fileHint =
        item?.supportsFiles ??
        item?.supports_files ??
        caps?.files ??
        caps?.documents ??
        (modalities.includes('file') || modalities.includes('document') || inputModalities.includes('file') || inputModalities.includes('document') ? true : undefined);

    const hasAnyProviderSignal =
        imageHint !== undefined ||
        fileHint !== undefined ||
        item?.multimodal !== undefined ||
        modalities.length > 0 ||
        inputModalities.length > 0;

    return {
        text: 'supported',
        images: capabilityFromBool(imageHint),
        files: capabilityFromBool(fileHint),
        source: hasAnyProviderSignal ? 'provider-metadata' : 'default',
        checkedAt: new Date().toISOString(),
    };
}

function tinyProbePng(): Uint8Array {
    return new Uint8Array([
        137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
        0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,
        0,0,0,12,73,68,65,84,8,153,99,248,15,4,0,9,251,3,253,
        160,90,167,130,0,0,0,0,73,69,78,68,174,66,96,130
    ]);
}

function tinyProbeTextFile(): Uint8Array {
    return new TextEncoder().encode('probe file');
}

async function probeModelCapabilities(ctx: any, providerId: string, modelId: string): Promise<ModelCapabilities> {
    const registry = getRegistry();
    const runtime = await registry.getProviderRuntime(providerId);
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId,
        contextId: runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });

    const result: ModelCapabilities = {
        text: 'unknown',
        images: 'unknown',
        files: 'unknown',
        source: 'probe',
        checkedAt: new Date().toISOString(),
    };

    try {
        const textProbe = await generateText({
            model,
            messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
            maxOutputTokens: 8,
        } as any);

        const out = String(textProbe?.text || '').trim().toUpperCase();
        result.text = out.includes('OK') ? 'supported' : 'unsupported';
    } catch {
        result.text = 'unsupported';
    }

    try {
        const imageProbe = await generateText({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', image: tinyProbePng(), mediaType: 'image/png' },
                    { type: 'text', text: 'If you can process image input, reply with exactly: IMAGE_OK. Otherwise reply with exactly: IMAGE_UNSUPPORTED.' },
                ],
            }],
            maxOutputTokens: 12,
        } as any);

        const out = String(imageProbe?.text || '').trim().toUpperCase();
        result.images = out.includes('IMAGE_OK') && !out.includes('IMAGE_UNSUPPORTED')
            ? 'supported'
            : 'unsupported';
    } catch {
        result.images = 'unsupported';
    }

    try {
        const fileProbe = await generateText({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'file', data: tinyProbeTextFile(), mediaType: 'text/plain', filename: 'probe.txt' },
                    { type: 'text', text: 'If you can process file input, reply with exactly: FILE_OK. Otherwise reply with exactly: FILE_UNSUPPORTED.' },
                ],
            }],
            maxOutputTokens: 12,
        } as any);

        const out = String(fileProbe?.text || '').trim().toUpperCase();
        result.files = out.includes('FILE_OK') && !out.includes('FILE_UNSUPPORTED')
            ? 'supported'
            : 'unsupported';
    } catch {
        result.files = 'unsupported';
    }

    return registry.setModelCapabilities(providerId, modelId, result);
}

function modelCapabilitySystemContent(capabilities?: ModelCapabilities | null): string {
    const lines = [
        `Model image support: ${capabilities?.images || 'unknown'}.`,
        `Model file support: ${capabilities?.files || 'unknown'}.`,
    ];

    if (capabilities?.images !== 'supported') {
        lines.push(
            'Do not rely on screenshots or image-returning API methods for reasoning.',
            'Prefer metadata, coordinates, measurements, labels, and plain-text summaries.'
        );
    }

    if (capabilities?.files !== 'supported') {
        lines.push(
            'Do not rely on file-returning API methods for reasoning.',
            'Prefer plain-text outputs when possible.'
        );
    }

    return lines.join('\n');
}

function sanitizeClientProviderTypeInput(input: CreateProviderTypeInput | UpdateProviderTypeInput): CreateProviderTypeInput | UpdateProviderTypeInput {
    const cloned: any = { ...input };
    delete cloned.fixedSecrets;
    return cloned;
}

export async function ensureModelCapabilities(
    ctx: any,
    input: { providerId: string; modelId: string; contextId?: string | null }
): Promise<{ providerId: string; modelId: string; capabilities: ModelCapabilities }> {
    ensureBuiltinAdapters();

    const registry = getRegistry();
    const cached = registry.getModelCapabilities(input.providerId, input.modelId);
    if (
        cached &&
        (cached.images !== 'unknown' || cached.files !== 'unknown') &&
        cached.source !== 'probe'
    ) {
        return { providerId: input.providerId, modelId: input.modelId, capabilities: cached };
    }

    if (cached?.source === 'probe') {
        registry.clearModelCapabilities(input.providerId, input.modelId);
    }

    const models = await registry.listModels(input.providerId, { ctx, contextId: input.contextId || null });
    const discovered = models.find((m) => m.id === input.modelId)?.capabilities || null;

    if (discovered && (discovered.images !== 'unknown' || discovered.files !== 'unknown')) {
        const stored = registry.setModelCapabilities(input.providerId, input.modelId, discovered);
        return { providerId: input.providerId, modelId: input.modelId, capabilities: stored };
    }

    const probed = await probeModelCapabilities(ctx, input.providerId, input.modelId);
    return { providerId: input.providerId, modelId: input.modelId, capabilities: probed };
}

export function registerPersonality(personality: ChatPersonality): void {
    ensureBuiltinAdapters();
    getRegistry().registerPersonality(personality);
}

export function registerProviderTypeServer(input: CreateProviderTypeInput | UpdateProviderTypeInput): ChatProviderTypeRecord {
    ensureBuiltinAdapters();
    const payload = {
        ...input,
        configSchema: Array.isArray(input.configSchema) ? input.configSchema : [],
        source: input.source || 'plugin',
    };
    return getRegistry().upsertProviderType(payload as CreateProviderTypeInput);
}

export async function registerProviderType(_ctx: any, input: CreateProviderTypeInput | UpdateProviderTypeInput): Promise<ChatProviderTypeClientRecord> {
    const registered = registerProviderTypeServer(sanitizeClientProviderTypeInput(input));
    const listed = getRegistry().listProviderTypes().find((item) => item.id === registered.id);
    if (!listed) throw new Error(`Failed to register provider type '${registered.id}'.`);
    return listed;
}

export async function listProviderTypes(): Promise<ProviderTypeListResult> {
    ensureBuiltinAdapters();
    return { providerTypes: getRegistry().listProviderTypes() };
}

export async function createProvider(ctx: any, input: CreateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    return getRegistry().createProviderInstance(input, ctx?.user?.id ?? null);
}

export async function listProviders(ctx: any, input?: { typeId?: string | null }): Promise<ProviderListResult> {
    ensureBuiltinAdapters();
    const providers = await getRegistry().listProviderInstances({ userId: ctx?.user?.id ?? null, typeId: input?.typeId || null });
    return { providers };
}

export async function getProvider(ctx: any, input: { providerId: string }): Promise<any> {
    ensureBuiltinAdapters();
    const provider = await getRegistry().getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
    const owner = provider.metadata?.ownerUserId ?? null;
    if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
    return provider;
}

export async function updateProvider(ctx: any, input: UpdateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.id);
    if (!current) throw new Error(`Unknown provider '${input.id}'.`);
    const owner = current.metadata?.ownerUserId ?? null;
    if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
    return getRegistry().updateProviderInstance(input.id, input);
}

export async function deleteProvider(ctx: any, input: { providerId: string }): Promise<{ ok: true }> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.providerId);
    if (!current) throw new Error(`Unknown provider '${input.providerId}'.`);
    const owner = current.metadata?.ownerUserId ?? null;
    if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
    await getRegistry().deleteProviderInstance(input.providerId);
    return { ok: true };
}

export async function listModels(ctx: any, input: {
    providerId?: string | null;
    providerTypeId?: string | null;
    draftConfig?: Record<string, unknown>;
    draftSecrets?: Record<string, unknown>;
    contextId?: string | null;
}): Promise<ProviderModelListResult> {
    ensureBuiltinAdapters();
    if (input.providerId) {
        const models = await getRegistry().listModels(input.providerId, { ctx, contextId: input.contextId || null });
        return { providerId: input.providerId, models };
    }
    if (input.providerTypeId) {
        const models = await getRegistry().previewListModels(input.providerTypeId, {
            ctx,
            contextId: input.contextId || null,
            draftConfig: input.draftConfig || {},
            draftSecrets: input.draftSecrets || {},
        });
        return { providerTypeId: input.providerTypeId, models };
    }
    throw new Error('listModels requires either providerId or providerTypeId.');
}

export async function createSession(ctx: any, input: CreateSessionInput): Promise<ChatSession> {
    ensureBuiltinAdapters();
    ensureDefaultPersonality();
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);

    if (input.personalityId && input.personalityPrompt && !registry.getPersonality(input.personalityId)) {
        registry.registerPersonality({ id: input.personalityId, label: input.personalityId, systemPrompt: input.personalityPrompt });
    }

    return registry.getSessionStore().createSession({
        id: registry.newId('sess'),
        title: input.title || 'New chat',
        providerId: input.providerId,
        providerTypeId: provider.typeId,
        modelId: input.modelId || provider.defaultModelId || '',
        personalityId: input.personalityId || 'default',
        contextId: input.contextId || provider.contextId || null,
        metadata: { ...input.metadata, userId: ctx?.user?.id ?? null },
    });
}

export async function listSessions(ctx: any, input?: { providerId?: string | null }): Promise<SessionListResult> {
    const sessions = await getRegistry().getSessionStore().listSessions({ providerId: input?.providerId || undefined, userId: ctx?.user?.id ?? null });
    return { sessions };
}

export async function getSession(_ctx: any, input: { sessionId: string; hydrateMessages?: boolean }): Promise<{ session: ChatSession; messages?: ChatMessage[]; attachments?: ChatAttachmentRecord[] }> {
    const hydrated = await getRegistry().hydrateSession(input.sessionId);
    return input.hydrateMessages === false ? { session: hydrated.session } : hydrated;
}

export async function renameSession(_ctx: any, input: { sessionId: string; title: string }): Promise<ChatSession> {
    return getRegistry().getSessionStore().updateSession(input.sessionId, { title: input.title });
}

export async function deleteSession(_ctx: any, input: { sessionId: string }): Promise<{ ok: true }> {
    await getRegistry().getSessionStore().deleteSession(input.sessionId);
    return { ok: true };
}

export async function uploadAttachment(_ctx: any, input: {
    sessionId: string;
    kind?: 'image' | 'file' | 'screenshot';
    name?: string;
    mimeType: string;
    dataBase64: string;
    metadata?: Record<string, unknown>;
}): Promise<ChatAttachmentRecord> {
    const record: ChatAttachmentRecord = {
        id: getRegistry().newId('att'),
        sessionId: input.sessionId,
        kind: input.kind || (input.mimeType.startsWith('image/') ? 'image' : 'file'),
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.dataBase64.length,
        dataUrl: input.dataBase64,
        createdAt: new Date().toISOString(),
        metadata: input.metadata,
    };
    return getRegistry().getSessionStore().uploadAttachment(record);
}

export async function appendMessages(_ctx: any, input: { sessionId: string; messages: ChatMessage[] }): Promise<{ messages: ChatMessage[] }> {
    const messages = input.messages.map(normalizeIncomingMessage);
    const appended = await getRegistry().getSessionStore().appendMessages(input.sessionId, messages);
    const all = await getRegistry().getSessionStore().listMessages(input.sessionId);
    const title = summarizeForTitle(all);
    await getRegistry().getSessionStore().updateSession(input.sessionId, { title });
    return { messages: appended };
}

function mergeAdjacentUserMultimodalTurns(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = [];

    for (const msg of messages) {
        const prev = merged[merged.length - 1];

        const msgParts = msg.parts || [];
        const prevParts = prev?.parts || [];

        const msgHasMedia = msg.role === 'user' && msgParts.some((p: any) => p.type === 'image' || p.type === 'file');
        const msgHasText = msg.role === 'user' && msgParts.some((p: any) => p.type === 'text' && String(p.text || '').trim());

        const prevHasMediaOnly =
            prev?.role === 'user' &&
            prevParts.length > 0 &&
            prevParts.some((p: any) => p.type === 'image' || p.type === 'file') &&
            !prevParts.some((p: any) => p.type === 'text' && String(p.text || '').trim());

        if (prev && prevHasMediaOnly && msg.role === 'user' && msgHasText && !msgHasMedia) {
            const combinedParts = [...prevParts, ...msgParts];

            merged[merged.length - 1] = {
                ...msg,
                id: msg.id || prev.id,
                sessionId: msg.sessionId || prev.sessionId,
                parts: combinedParts,
                content: coerceMessageText({ ...msg, parts: combinedParts } as ChatMessage),
                createdAt: msg.createdAt || prev.createdAt,
            };
            continue;
        }

        merged.push(msg);
    }

    return merged;
}

export async function sendTurn(ctx: any, input: SendTurnInput): Promise<ChatTurnResult> {
    ensureBuiltinAdapters();
    ensureDefaultPersonality();

    const registry = getRegistry();
    const sessionStore = registry.getSessionStore();
    const hydrated = await registry.hydrateSession(input.sessionId);
    const session = hydrated.session;
    const runtime = await registry.getProviderRuntime(session.providerId);
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

    const personality = (input.personalityId ? registry.getPersonality(input.personalityId) : registry.getPersonality(session.personalityId)) || defaultPersonality();
    const maxRecentMessages = Math.max(1, Math.min(50, Number(input.maxRecentMessages || 14)));
    const recentMessages = mergeAdjacentUserMultimodalTurns(
        hydrated.messages.slice(-maxRecentMessages)
    );

    const attachmentIndex = buildAttachmentIndex(hydrated.attachments || []);

    const modelCaps = await ensureModelCapabilities(ctx, {
        providerId: session.providerId,
        modelId: session.modelId,
        contextId: session.contextId || null,
    });

    const systemMessages = [
        { role: 'system', content: sessionPreamble(runtime.instance.label, input.allowedScriptApi) },
        { role: 'system', content: `Active personality: ${personality.label}\n\n${input.personalityPrompt || personality.systemPrompt}` },
        { role: 'system', content: scriptSystemContent(input.allowedScriptApi) },
    ].map((m) => toModelMessage(m as ChatMessage, attachmentIndex));

    const conversation = recentMessages.map((m) => toModelMessage(m, attachmentIndex, modelCaps.capabilities));

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId: session.modelId,
        contextId: session.contextId || runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });


    console.debug('[chat-debug/sendTurn]', {
        sessionId: session.id,
        providerId: session.providerId,
        modelId: session.modelId,
        recentMessages: recentMessages.map((m) => ({
            role: m.role,
            contentChars: typeof m.content === 'string' ? m.content.length : 0,
            parts: (m.parts || []).map(summarizePart),
        })),
        attachments: (hydrated.attachments || []).map((att) => ({
            id: att.id,
            kind: att.kind,
            mimeType: att.mimeType,
            name: att.name || null,
            dataUrlLen: typeof att.dataUrl === 'string' ? att.dataUrl.length : 0,
        })),
        conversation: conversation.map(summarizeModelMessage),
    });

    llmLog("MODEL_INPUT", {
        messageCount: [...systemMessages, ...conversation].length,
        messages: [...systemMessages, ...conversation].map((m: any) => ({
            role: m.role,
            content: Array.isArray(m.content)
                ? m.content.map((p: any) => {
                    if (p.type === 'image') {
                        return {
                            type: 'image',
                            hasData: !!p.image,
                            isUint8Array: p.image instanceof Uint8Array,
                            byteLength: p.image instanceof Uint8Array
                                ? p.image.byteLength
                                : (typeof p.image === 'string' ? p.image.length : 0),
                            preview: typeof p.image === 'string'
                                ? p.image.slice(0, 80)
                                : (p.image instanceof Uint8Array
                                    ? Array.from(p.image.slice(0, 12))
                                    : null),
                            mediaType: p.mediaType,
                        };
                    }
                    if (p.type === 'file') {
                        return {
                            type: 'file',
                            hasData: !!p.data,
                            isUint8Array: p.data instanceof Uint8Array,
                            byteLength: p.data instanceof Uint8Array
                                ? p.data.byteLength
                                : (typeof p.data === 'string' ? p.data.length : 0),
                            filename: p.filename,
                            mediaType: p.mediaType,
                        };
                    }
                    return p;
                })
                : m.content
        }))
    });

    const result = await generateText({
        model,
        messages: [...systemMessages, ...conversation],
    });

    const text = typeof result.text === 'string' ? result.text : '';
    const message: ChatMessage = {
        id: registry.newId('msg'),
        sessionId: session.id,
        role: 'assistant',
        content: text,
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
    };

    await sessionStore.appendMessages(session.id, [message]);
    const title = summarizeForTitle(await sessionStore.listMessages(session.id));
    const updatedSession = await sessionStore.updateSession(session.id, { title });

    const usage = (result as any).usage || (result as any).totalUsage;
    return {
        message,
        session: updatedSession,
        usage: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
            }
            : undefined,
        capabilities: modelCaps.capabilities,
    };
}
