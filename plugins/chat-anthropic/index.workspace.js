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

        // Boot resilience: a cold/slow auth backend must not strand the chat with no
        // provider until a manual reload. The shared helper fails each attempt fast
        // (5s RPC timeout, not the 30s client backstop), retries with backoff, and
        // refreshes the catalog on success so the provider self-surfaces. It is
        // detached — registration runs in the background (the loader holds the boot
        // loading overlay on every pluginReady, so a cold provider must never be
        // awaited here); the chat panel's busy UI reports progress instead.
        xmodules["vercel-ai-chat-sdk"]?.instance().registerManagedProvider(
            () => this.server().ensureChatProviderRegistered(
                { contextId, authType, requiresLogin },
                { timeoutMs: 5000 }
            ),
            { label: "Anthropic" }
        );

        // Let the core broker force + drive login for that context. Whichever auth
        // module owns it configures it; an inline authBroker/authConfig on this
        // plugin is applied only when none does.
        this.requireAuthContext();
    }
});
