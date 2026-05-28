# Chat plugin for OpenAI-compatible endpoints

Generic chat provider that works with any GPT-like API speaking the OpenAI
HTTP wire format: OpenAI itself, Azure OpenAI, vLLM, Ollama, LM Studio,
Together, Groq, CERIT-AI, and friends. Point `baseUrl` at your endpoint
and the plugin will discover models via `GET {baseUrl}{modelsDiscoveryPath}`
and stream completions through the Vercel AI SDK's
`@ai-sdk/openai-compatible` adapter.

## Integrating via a server proxy

Define a proxy in your xOpat env (the alias is arbitrary — pick anything
that identifies the upstream):

````json
"server": {
  "secure": {
    "proxies": {
      "my-llm": {
        "baseUrl": "https://api.example.com/",
        "headers": {
          "Authorization": "Bearer [API TOKEN KEY FROM ENV OR PLAINTEXT]",
          "Content-Type": "application/json"
        }
      }
    }
  }
}
````

Then enable the plugin against that alias:

````json
"chat-openai-compatible": {
  "permaLoad": true,
  "authMode": "none",
  "proxyAlias": "my-llm"
}
````

With `authMode: "none"` the chat is usable by anyone who can reach the
viewer URL — the upstream proxy is the one enforcing the API token, so
make sure it's locked down. For viewer-side auth, switch to
`"authMode": "jwt"` and configure `authContext` / `oidc` in
`include.json`.
