# Chat Anthropic plugin

This plugin registers an Anthropic Claude provider for the `vercel-ai-chat-sdk` chat module.

Configure it through the viewer env and plugin config:

```json
"chat-anthropic": {
  "permaLoad": true,
  "authMode": "none"
}
```

For a server-managed default token, set secure plugin config in `server.json` or your runtime secure config:

```json
{
  "providerDefaults": {
    "baseUrl": "https://api.anthropic.com/v1",
    "apiKey": "YOUR_SERVER_ONLY_DEFAULT_TOKEN",
    "defaultModelId": "",
    "modelsPath": "/models",
    "anthropicVersion": "2023-06-01"
  }
}
```

`apiKey` has three states:

| value | meaning |
| --- | --- |
| `"sk-ant-…"` | the operator's server-side key |
| absent / `""` | a key is required — **model discovery does not call Anthropic** until the deployer or a BYOK user supplies one (no more 401 on every boot) |
| `false` | the endpoint is declared keyless; discovery runs with no `x-api-key` header |

See the chat SDK's [README](../../modules/vercel-ai-chat-sdk/README.md) →
"No key, no discovery".

## Requiring login

Auth is **opt-in and method-agnostic**. `authMode: "none"` (the default) needs no
auth configured anywhere. To require login:

```json
"chat-anthropic": {
  "permaLoad": true,
  "authMode": "jwt",
  "authContext": "anthropic"     // null / "core" = the viewer's main identity
}
```

The plugin names only the **context**, never the mechanism — whichever auth module
the deployment loads (`oidc-client-ts`, `oidc-server-ts`, `saml-auth`, …) claims
that context and drives the login. Load one with
`modules.<id>.permaLoad: true`; the plugin no longer pulls one in through
`modules`, so a SAML or auth-less deployment is not forced to ship OIDC.

Enforce it server-side by pairing the context with a verifier under
`core.server.secure.rpcVerifiers.<authContext>` (see `src/AUTH.md`).

Back-compat: if the auth config lives on the plugin instead of on an auth module,
set `authBroker` + `authConfig` (legacy: `oidc` + `oidcFlow`). It is applied only
when no auth module claims the context.
