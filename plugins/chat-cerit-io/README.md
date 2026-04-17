# Chat SAAI plugin for CERIT

You can integrate Chat to the viewer by using the viewer xopat env configuration:
````json
"server": {
  "secure": {
    "proxies": {
      "cerit": {
        "baseUrl": "https://llm.ai.e-infra.cz/",
        "headers": {
          "Authorization": "Bearer [API TOKEN KEY FROM ENV OR PLAINTEXT]",
          "Content-Type": "application/json"
        }
      }
    }
  }
}
````
and setting the plugin to use it:
````json
"chat-cerit-io": {
  "permaLoad": true,
  "authMode": "none",
  "proxyAlias": "cerit"
}
````
This makes the chat usable by _anyone_ who has the link to the viewer.
For authorization on the viewer side, see the include.json file configuration.
You must also set up the proxy to require the auth token before allowing traffic.