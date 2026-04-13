import { ChatServerRegistry, ensureBuiltinAdapters, type ChatProviderAdapter } from './chatRegistry.server';

export async function ensureManagedPluginProvider(ctx: any, input: {
    pluginId: string;
    providerType: CreateProviderTypeInput | UpdateProviderTypeInput;
    provider: Omit<CreateProviderInstanceInput, 'typeId'> & { typeId?: string | null };
    adapter?: ChatProviderAdapter;
    managedKey?: string | null;
}) {
    const pluginId = String(input?.pluginId || '').trim();
    if (!pluginId) throw new Error('ensureManagedPluginProvider: missing pluginId.');

    ensureBuiltinAdapters();
    const registry = ChatServerRegistry.instance();

    if (input.adapter) {
        registry.registerAdapter(input.adapter);
    }

    const providerType = registry.upsertProviderType(input.providerType);
    const typeId = String(input.provider?.typeId || providerType.id || '').trim();
    if (!typeId) throw new Error('ensureManagedPluginProvider: missing provider type id.');

    const managedKey = String(input?.managedKey || `${pluginId}:${typeId}:default`).trim();
    const providers = await registry.listProviderInstances({ userId: ctx?.user?.id ?? null, typeId });
    const existing = providers.find((provider: any) => {
        const meta = provider?.metadata || {};
        return (
            provider?.typeId === typeId &&
            (
                meta.managedKey === managedKey ||
                (meta.managedByPlugin === pluginId && meta.autoCreated === true)
            )
        );
    });

    const providerPayload = {
        ...input.provider,
        typeId,
        metadata: {
            managedByPlugin: pluginId,
            managedKey,
            autoCreated: true,
            role: 'default-provider',
            ...(input.provider?.metadata || {}),
        },
    };

    let provider: any;
    let providerCreated = false;
    let providerUpdated = false;

    if (!existing) {
        provider = await registry.createProviderInstance(
            providerPayload as CreateProviderInstanceInput,
            ctx?.user?.id ?? null
        );
        providerCreated = true;
    } else {
        provider = await registry.updateProviderInstance(existing.id, {
            id: existing.id,
            ...(providerPayload as Omit<UpdateProviderInstanceInput, 'id'>),
        });
        providerUpdated = true;
    }

    return {
        ok: true,
        providerTypeId: typeId,
        providerId: provider?.id || existing?.id || null,
        providerCreated,
        providerUpdated,
    };
}
