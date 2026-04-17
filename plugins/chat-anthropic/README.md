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

If you want the viewer-side provider to require login, keep `authMode: "jwt"` and provide the corresponding auth context.
