addPlugin("chat-anthropic", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        // Auth is context-based and OPT-IN: `authMode: "none"` (the default) means
        // the provider works with no auth configured anywhere. `authContext`
        // (default "core") names WHERE we authenticate, never HOW — this plugin
        // knows nothing about OIDC or SAML. See src/AUTH.md.
        const contextId = this.authContextId;
        const requiresLogin = this.authRequiresLogin;
        const authType = this.getStaticMeta("authMode", "none");

        // DECLARE THE CONTEXT FIRST. Whichever auth module owns it configures it; an
        // inline authBroker/authConfig on this plugin is applied only when none does.
        // Ordering matters: the registration below waits for this context to settle, and
        // a context nobody has declared yet settles instantly as "absent" — so declaring
        // it afterwards meant the wait was always a no-op and the first RPC raced the login.
        this.requireAuthContext();

        // Boot resilience: a cold/slow auth backend must not strand the chat with no
        // provider until a manual reload. The shared helper waits for `contextId` to reach
        // a verdict, bounds each attempt (15s RPC timeout, not the 30s client backstop),
        // retries transients with backoff, and refreshes the catalog on success so the
        // provider self-surfaces. A refusal is NOT retried — it waits for the login and
        // re-runs itself once one lands. It is detached — registration runs in the
        // background (the loader holds the boot loading overlay on every pluginReady, so a
        // cold provider must never be awaited here); the chat panel's busy UI reports progress.
        xmodules["vercel-ai-chat-sdk"]?.instance().registerManagedProvider(
            () => this.server().ensureChatProviderRegistered(
                { contextId, authType, requiresLogin },
                { timeoutMs: 15000 }
            ),
            // `contextId` only when a login is actually required: passing it for an
            // authMode "none" provider would make the helper wait on a context this
            // deployment never authenticates.
            { label: "Anthropic", pluginId: this.id, ...(requiresLogin ? { contextId } : {}) }
        );
    }
});
