# xOpat Default Deployment Configuration

This README describes options for xOpat configurations and available core configuration details.
For details on modules and plugin configurations, see respective READMEs in given folders.

The configuration can be provided either in a file (default location `env/env.json`, override-able path in `XOPAT_ENV` 
variable) or a serialized JSON (also in `XOPAT_ENV`).

**If you just want to run a deployment, start with [Composing a deployment](#composing-a-deployment-npm-run-up)
below** — `npm run up` assembles one out of small tracked fragments and keeps
secrets in `env/.env`, instead of you maintaining another whole-file variant.
Everything in this README still describes what those fragments contain.

---

## Composing a deployment (`npm run up`)

A deployment is a handful of independent decisions — where slides come from,
how users log in, which assistant, where state lives — and writing one whole
ENV file per combination is what produced the pile of near-identical files this
directory used to be. So the decisions are layers:

```bash
npm run up                       # ask one question per decision, interactively
npm run up -- --list             # every preset and fragment, grouped by dimension
npm run up -- dicom-idc          # a named preset from env/presets.json
npm run up -- base/core data/dicomweb-idc auth/keycloak-saml chat/anthropic-server-key
npm run up -- env/env.mine.json logging/chat-transcript   # layer onto your own ENV
npm run up:dev -- default        # ...with the asset watcher (npm run dev)
npm run up:check -- keycloak-oidc   # what it needs, what collides — without running
npm run up:compose -- oidc-chat --emit=compose   # one line, for docker-compose.yml
```

A **selector** resolves in this order: a preset name in `env/presets.json`, a
fragment id under `env/parts/`, then any file path — which is why a hand-written
ENV is just another layer rather than a different mechanism.

The composed result is written to `env/.compose/<label>.json` (gitignored,
inspectable) alongside `<label>.provenance.json`, which records **which layer won
every leaf**. The server is then started the ordinary way, with `XOPAT_ENV`
pointing at that file — nothing downstream knows composition happened.

### Conflicts are an error, not a merge

Two layers writing the same key to different values stops the run:

```
CONFLICT  core.client.localhost.default_background_protocol  (differing-leaf)
  data/wsi-service   "wsi_service"
  data/tiff-webtiff  "tiff"
CONFLICT  dimension "data"
  data/wsi-service, data/tiff-webtiff — pick one, or pass --force
```

Silently picking a winner is exactly what made a directory of near-identical
files untrustworthy, so it is refused. Exempt by design: a layer declaring
`role: "base"` (it exists to be overridden), and explicit overrides (`--set`, a
preset's `override` block). `--force` downgrades everything to last-wins.

Fragments also declare a **dimension** — `data`, `auth`, `chat`, `io`,
`storage`, … — and two fragments in one dimension conflict even when their keys
never overlap, because two data sources or two auth brokers is a
misconfiguration however it is spelled.

### Writing a fragment

A fragment is a partial ENV plus an optional `$meta` block, and lives at
`env/parts/<dimension>/<name>.json`. It is **tracked**, so it must be
secret-free — `npm run up:check` fails on a literal credential.

```jsonc
{
  "$meta": {
    "description": "shown by --list and in the interactive picker",
    "dimension": "auth",              // mutual exclusion group
    "role": "layer",                  // or "base": exists to be overridden
    "requires": ["XOPAT_SAML_JWT_SECRET"],   // reported when unset
    "defaults": { "KEYCLOAK_URL": "http://localhost:8081" },
    "conflictsWith": ["auth/keycloak-oidc"]
  },
  "core": { "...": "the ordinary ENV shape" }
}
```

A file may also declare `"$base": [...]` — selectors merged in before it, as
`role: "base"` layers. That is how `test/env/saml.json` and `test/env/oidc.json`
share one copy of their role rules instead of two copies a comment asks you to
keep identical.

### Secrets: `env/.env`

Copy `env/.env.example` to `env/.env` and fill in what you need. The runner
injects those variables into the server process, where the ordinary
`<% VAR %>` substitution resolves them — **the composer never substitutes**, so
the file under `env/.compose/` stays safe to paste into a bug report.

Precedence, lowest to highest:
`$meta.defaults` → a preset's `env` block → `env/.env` → your shell.
So `WSI_PORT=9999 npm run up -- default` always wins.

`npm run dev` reads `env/.env` too. The server does not: secrets reach it
through its process environment, which is what containers and systemd already
supply, and teaching `getCore` to read a file would add per-request I/O and
diverge from the PHP backend.

Implementation: `server/utils/node/env-compose.mjs` (the merge, shared with the
test harness), `env-cli.mjs` (the runner), `env-picker.mjs` (the questions).

Default static configuration for plugins, modules and the viewer itself can be overridden
in ``env.json`` file. The full configuration is compiled for you (with comments) in `env.example.json`.
Only fields that are to be overridden can be present.

To compile the `env.example.json`, run

> grunt env

Then, you can simply override values you need to change, simply follow the `env.example.json` file. It looks like this:
````json
{
  "core": {
      //In particular, you will want to provide a path to redirect in case of errors
      "gateway": "../",
      "active_client": "localhost",
      "client": {
          "localhost": {
              ...
          }
      },
      ...
  },
  "plugins": {
      //here goes plugins configuration, an object keyed by plugin id
      "<plugin-id>": { }
  },
  "modules": {
      //here goes modules configuration, an object keyed by module id
      "<module-id>": { }
  }
}
````
To generate minimal configuration file, run

> grunt env --minimal

which strips built-in options for plugins, modules, and removes empty configuration module objects.

### Static configuration provided in a dynamic way
To provide a configuration file path, you can set 
``XOPAT_ENV`` environmental variable to specify
 - a file path, if the file exists and _is readable_, it will try to parse its contents,
 - a string data, its contents will be treated as a serialized JSON,
 - otherwise, ``env/env.json`` is used (if exists)

### `__ORIGIN__` for unpredictable iframe origins
The `core.client.<active_client>.domain` field accepts the literal token
`"__ORIGIN__"`. At browser boot, xopat replaces it with
`window.location.origin`. Use this when the deploy script cannot know in
advance which origin will actually serve the iframe — the canonical case is
Google Colab's `serve_kernel_port_as_iframe`, which serves the iframe under
a different alias than `google.colab.kernel.proxyPort(...)` returns. The
xopat `/proxy/...` route emits no CORS headers, so the effective `domain`
must match the iframe origin or every proxy fetch fails the preflight.

If you also need cookies in such a deployment, set `js_cookie_domain`
explicitly — the cookie attribute receives the raw token unchanged.

### Deployment cache key (`core.client.<active>.cacheKey`)

Browsers scope storage by **origin**, and one origin routinely serves several
deployments — every env file you run on `localhost`. Without an identity, the
state one deployment leaves behind is picked up by the next: a stale session
replays with data references the new deployment cannot resolve, and plugins the
new env never shipped auto-load from the previous one's cookie.

```jsonc
"core": {
    "client": {
        "localhost": { "cacheKey": "dev-dicom" }
    }
}
```

- **Production:** pin it once and never change it — the key stays stable across
  unrelated config edits, so users keep their session and preferences.
- **Development:** give each env file its own key, and switching `XOPAT_ENV`
  flushes the previous one's boot state. Or leave it unset: the key is then
  derived from the configuration that decides whether a session's data
  references still resolve (domain/path/name/version, `active_client`,
  `slide_protocols`, the default protocols, the legacy `image_group_*` /
  `data_group_*` fields, and the shipped plugin/module ids). Cosmetic settings —
  themes, UI flags, viewport defaults — never participate.

What the key scopes: the boot session caches (`xoSessionCache`,
`__xopat_session__`) and the plugin-autoload cookie (`_plugins.<key>`). It does
**not** scope `kv:*` storage (`AppCache`, `AppCookies`, per-plugin caches),
which stays keyed by owner only. Implementation:
`src/classes/app/deployment-key.ts`.

**The key does not see per-element config.** It fingerprints `core.client` (domain,
path, protocols, …) plus the *ids* of the shipped plugins and modules — not their
`plugins.<id>` / `modules.<id>` blocks, because those records also carry
include.json fields that churn on every release. Two env files that differ only in
element config therefore share a key: measured today,
`env.fileserver.json` and `env.webtiff.json` (same client block, same ids, different
`protocolBaseUrl`). Give such files an explicit `cacheKey`.

`setup.bypassCache: true` is the switch for the boot session cache, and
`setup.bypassCacheLoadTime: true` a narrower one — it skips the restore on a *cold*
load (no session of its own) while still evicting and saving. Neither is reachable
from `client.io.bindings`: those flows run before the storage pipeline exists, so
`client.io.bindings` does not reach them (binding `core`'s `kv:cache` to
`memory` still leaves the boot path writing `localStorage`). Note that
bypassing suppresses *restoring and saving* only; an entry belonging to a
different deployment is still evicted. See `src/IO_PIPELINE.md` →
*Bootstrap exception*.

`client.sessionCacheKey` and `setup.sessionCacheKey` are accepted as deprecated
aliases.

### Slide-protocol registry
The `core.client.<active_client>` block declares which image servers the viewer
talks to via the named **slide-protocol registry**:

```json
"slide_protocols": {
    "wsi_service": "`http://localhost:8080/v3/slides/info?slide_id=${data}`"
},
"default_background_protocol":    "wsi_service",
"default_visualization_protocol": "wsi_service"
```

Each entry is a backtick template with `data` (scalar DataID) in scope; the
server URL is embedded directly in the template. Names declared here can be
referenced safely from a session config via `BackgroundItem.protocol` /
`DataOverride.protocol` — including in secure mode, because the lookup is a
name, not an `eval` of user input. Plugins may add additional entries (URL
templates **or** factory protocols that build a `TileSource` directly) at
runtime via `window.SLIDE_PROTOCOLS.register(...)` — see the dicom plugin for
a factory-protocol reference.

The legacy `image_group_server` + `image_group_protocol` + `data_group_server`
+ `data_group_protocol` fields are still accepted and auto-synthesized at
boot into deprecated `__legacy_bg` / `__legacy_viz` registry entries (with a
one-shot deprecation warning). Plan to migrate new deployments to the new
shape; the legacy fields will be removed in a follow-up major.

### Plugin selection mode
The active client block carries a `pluginSelectionMode` knob (default `"all"`)
that decides which plugins the server ships to the client:

```json
"core": {
    "active_client": "localhost",
    "client": {
        "localhost": {
            "pluginSelectionMode": "available"
        }
    }
}
```

- `"all"` — every discovered plugin without `enabled: false` is shipped.
- `"whitelist"` — only plugins explicitly opted in by this env via
  `plugins.<id>.enabled = true` are shipped. A plugin's own `enabled: true`
  in `include.json` does NOT whitelist it; only the deployment ENV does.
  ``permaLoad`` does **not** opt a plugin in: an ENV block must set
  `enabled: true` explicitly, `permaLoad` only forces loading of a plugin that
  is already shipped. See `server/README.md` § *Plugin selection mode*.
- `"available"` — like `"all"`, plus each plugin OR module may declare
  a single `requiredConfig: ["dot.path", ...]` array in its
  `include.json`. Each path is resolved against TWO deployment-owned
  sources; a path is satisfied when EITHER carries a non-empty value:
    1. `plugins[<id>]` / `modules[<id>]` block in env.json (the public
       per-element block).
    2. `core.server.secure.plugins[<id>]` / `core.server.secure.modules[<id>]`
       (the server-only block, never shipped to the browser — natural
       home for secret-adjacent values).
  **Include.json defaults are not consulted**; only what this env
  explicitly sets in one of the two buckets satisfies the gate.
  Plugins whose required module is dropped get the existing missing-dep
  error, which is the intended UX when an upstream isn't configured.
  The plugin author lists *what* keys must exist; this env decides
  *where* each value lives based on sensitivity.

  Concrete shape for a deployment that wants DICOM and a chat plugin to
  be available, mixing both buckets according to sensitivity:

  ```json
  {
      "core": {
          "client": { "<env>": { "pluginSelectionMode": "available" } },
          "server": {
              "secure": {
                  "proxies": {
                      "openai": {
                          "baseUrl": "https://api.openai.com",
                          "headers": { "Authorization": "Bearer <% OPENAI_KEY %>" },
                          // An alias that injects a credential must say who may
                          // spend it. Session + CSRF is not authorization — both
                          // are handed to any anonymous page load. Either name
                          // verifiers, or declare it public with
                          // `{"enabled": false}` and mean it. Omitting the block
                          // is refused (500).
                          "auth": {
                              "enabled": true,
                              "verifiers": ["jwt"],
                              "mode": "all",
                              "jwt": { "forward": false }
                          }
                      }
                  },
                  "plugins": {
                      "chat-chatgpt": { "proxyAlias": "openai" }
                  }
              }
          }
      },
      "plugins": {
          "dicom": { "serviceUrl": "https://my-pacs/dicom-web" }
      }
  }
  ```

  Both `dicom.requiredConfig` (`["serviceUrl"]`) and
  `chat-chatgpt.requiredConfig` (`["proxyAlias"]`) are satisfied — the
  former by the public `plugins.dicom.serviceUrl` entry, the latter by
  `core.server.secure.plugins.chat-chatgpt.proxyAlias`. The gate doesn't
  care which bucket carried each value, only that something did.

See `server/README.md` for the full reference and `plugins/README.md` for
the `requiredConfig` field semantics.

### Server-side login (`core.server.secure.rpcVerifiers`)

Server-side RPC authentication is configured per **auth context** under
`core.server.secure.rpcVerifiers`. The viewer's **main** context — the one a
plugin means when it leaves `authContext` unset — may be keyed **`"default"`,
`"core"` or `""`; all three are the same context**. `"default"` is the
conventional spelling:

```jsonc
"rpcVerifiers": {
  "default": { "verifiers": { "jwt": { "secretEnv": "<% XOPAT_JWT_SECRET %>" } }, "mode": "all" }
}
```

A deployment that configures nothing here still works — auth is opt-in. Named
sub-contexts (anything other than the three main spellings) are matched exactly
and refused when unconfigured. Full rules, verifier names and the decision matrix:
[`server/node/README.md`](../server/node/README.md) § *Configuring RPC verifiers*,
and [`src/AUTH.md`](../src/AUTH.md) for the client half.

### Logging, and shipping it somewhere

Two blocks, one model. Verbosity is per channel on both sides, and both are
**deployment** configuration — a session, a URL param or an embedding app can
never raise a level or unlock payload logging.

```jsonc
"core": {
  "server": {
    "logging": {
      "channels": { "module.vercel-ai-chat-sdk:transcript": "trace" },
      "allowSensitive": true,                      // message content; PHI on real data
      "redact": { "maxStringLength": 200000 },     // else long replies/script results are cut
      "sinks": {
        "stream": [{
          "file": "/var/log/xopat/chat-transcript.ndjson",
          "channels": ["module.vercel-ai-chat-sdk:transcript"],
          "minLevel": "trace",
          "includeSensitive": true,                // a SECOND opt-in: payloads leave the box
          "attachments": true                      // images beside the transcript
        }]
      },
      "client": { "ingest": true }                 // accept the browser's records too
    }
  },
  "client": {
    "logging": {
      "level": "warn",
      "channels": { "module.vercel-ai-chat-sdk": "debug" },
      "forward": { "enabled": true, "minLevel": "warn" }
    }
  }
}
```

That is the "keep the chat conversation in local files" recipe: one NDJSON line
per message plus a `chat-transcript.files/` directory of attachments. Turn it off
again afterwards — those files are patient data.

**To reconstruct whole sessions** (a pilot run), add the browser's timeline and
the regions the foundation model reviewed to the same file:
`client: { ingest: true }`, `channels` also carrying `"client:session": "info"`
and `"module.vercel-ai-chat-sdk:vision": "trace"`, both `"client"` and the vision
channel in the destination's channel list, and
`client.logging.forward.minLevel: "info"`. You then get session start, which
slides were opened, auth, warnings and the conversation interleaved by
timestamp — grouped by `clientSession` (one per page load) and joined to the
chat by a hashed `principal`. Full recipe: *reconstruct a pilot session* in
[`server/LOGGING.md`](../server/LOGGING.md). For the far noisier "exactly
what the model was sent" dump, name `module.vercel-ai-chat-sdk:llm:full`
instead; it repeats the whole conversation every turn. Full specs:
[`server/LOGGING.md`](../server/LOGGING.md) and [`src/LOGGING.md`](../src/LOGGING.md).

### Environmental variables
You can use custom environment variables as a string values like this: ``<% ENV_VAR_NAME %>``.
If ``X=3`` then `"watch <%X%>"` will result in `"watch 3"`. The pattern used is
> ``<%\s*[a-zA-Z_][a-zA-Z0-9_]*\s*%>``

which basically says
 - start with `<%`
 - continue with any whitespace including newlines `\s*`
 - allowed a single word, name of variable, that does not start with a number: `[a-zA-Z_][a-zA-Z0-9_]*`
 - and backwards
