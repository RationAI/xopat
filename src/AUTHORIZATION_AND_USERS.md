# xOpat Authentication & HTTP Client

This README consolidates and corrects our authentication docs to match the current (final) implementations of `XOpatUser` and `HttpClient`.

## TL;DR
- Use `XOpatUser.instance()` for login state and secrets.
- Bind secrets to a **type** (e.g., `"jwt"`, `"basic"`) and optionally to a **contextId** (e.g., `"mlflow"`).
- `HttpClient` automatically applies auth headers from `XOpatUser` and can refresh secrets once on `401` by firing a `secret-needs-update` event that your UI/module should handle.
- Built-in auth header handlers for `jwt` and `basic`; you can register your own.
- Differentiate between **contextual** and **core** secrets.

---

## 1) User & Secrets

`XOpatUser` is a singleton that stores login state and authentication secrets and exposes a small event API.

### Login / Logout
```js
const user = XOpatUser.instance();

// Login (must be logged out before calling)
user.login(userId, userName, optionalIconHtml);

// Logout (clears id, name, and ALL secrets from all contexts when used like this)
user.logout();
```
This is core flow - it should executed present only once in your app. More plugins can, for example, 
queue on event and test whether the user is logged in (supporting fallback logins), but they can never log-in twice.

Each of these methods accepts additional optional parameter ``contextId``, which means we can log-in for third party services:

```js
// Login for custom third-party service
user.login(userId, userName, optionalIconHtml, 'my-service');

// Logout (clears only my-service context secrets)
user.logout('my-service');
```

### Secret storage
Secrets are stored by **type** and optional **contextId**. 
```js
// Set a secret (fires `secret-updated` if value is truthy, `secret-removed` if cleared)
user.setSecret(secretValue, /* type = */ "jwt", /* contextId? = */ "mlflow");

// Read a secret; will fall back to generic type if context-bound one is missing
const token = user.getSecret("jwt", "mlflow");
```

> **Note:** You can use non-default types (e.g., `"basic"`, `"apiKey"`), but `HttpClient` must have a handler registered for that type to apply headers.

### Secret lifecycle events

| Event                 | When it fires                                        |
|-----------------------|-------------------------------------------------------|
| `secret-updated`      | After `setSecret(secret, type, contextId)` with truthy secret |
| `secret-removed`      | After `setSecret(null, type, contextId)`              |
| `secret-needs-update` | When a client requests a refresh (e.g., after 401)   |
| `login` / `logout`    | On login/logout                                       |

> Note that events with ``*`` asterisk are namespaced. If you have a `custom-context` context,
> the event name fired is ``login:custom-context``. For details, see [EVENTS.md](EVENTS.md) description.
> You can use ``XOpatUser.instance().getEventName(eventName, 'custom-context')`` to get the event name with namespace.

### Writing a secret provider (UI contract)
Based on the above, you can write a module that provides secrets for your app - either a specific third-party service or a generic viewer-wide login.
Some components (notably `HttpClient`) may ask the app to re-acquire a secret. Your authentication module should listen for `secret-needs-update`, perform the refresh (e.g., silent token refresh, interactive login), and then call `user.setSecret(...)`.

```js
// Somewhere in your auth module/plugin:
XOpatUser.instance().addHandler("secret-needs-update", async ({ type, contextId }) => {
  const user = XOpatUser.instance();
  const newSecret = await fetchNewTokenSomehow(type, contextId); // your logic
  // Throwing an exception is OK, but if you fail to call setSecret, the client will wait until timeout.  
  user.setSecret(newSecret, type, contextId);
});
```

If multiple auth strategies are present, they may all listen for the event; the first one that successfully sets a secret resolves the client’s await.

---

## 2) Contextual Authentication in the UI

xOpat allows **contextual** authentication so different backend services (e.g., MLflow, analytics, search) can use different credentials for the same user session. Use a short identifier as `contextId` when setting or retrieving secrets, and pass the same `contextId` to `HttpClient`.

Typical pattern:

1. On startup (e.g., in a `before-first-open` handler), ensure the user is logged in and populate the relevant secrets—either generic or per-context.
2. Initialize HTTP clients with the `auth.contextId` that matches where the secret is stored.

```js
VIEWER_MANAGER.addHandler('before-first-open', async () => {
  const user = XOpatUser.instance();
  if (!user.isLogged) {
    await ensureUserLoggedIn(); // your own routine
  }
  // Optionally bind a context-specific secret
  const token = await acquireJwtFor("mlflow");
  user.setSecret(token, "jwt", "mlflow");
});
```

---

## 3) HTTP Client

`HttpClient` is a thin wrapper over `fetch` with JSON/query helpers, retries, and pluggable authentication. It throws `HTTPError` on non-OK HTTP responses and aborts.

```js
const mlflow = new HttpClient({
  baseURL: "https://mlflow.yourhost/api/2.0/mlflow",
  timeoutMs: 30000,
  maxRetries: 3,
  auth: {
    contextId: "mlflow",   // matches where the secret is stored in XOpatUser
    types: ["jwt"],         // order matters; handlers run in sequence
    refreshOn401: true,     // one-shot refresh via `secret-needs-update`
    // handlers: { jwt: customHandler } // optional per-instance overrides
  }
});

// Simple GET with query params (auto-parses JSON/text)
const runs = await mlflow.request("/runs/search", {
  method: "POST",
  body: { experiment_ids: ["0"], max_results: 100 },
});
```

### Auth header handling
- **Sources:** Secrets are read from `XOpatUser` using each requested `type` (and `contextId`, if configured).
- **Handlers:** For each `type`, a handler returns additional headers. Built-in:
    - `jwt` → `{ Authorization: "Bearer <token>" }`
    - `basic` (expects secret object `{ username, password }`) → `{ Authorization: "Basic <base64>" }`
- **Custom types:**
```js
HttpClient.registerAuthHandler("apiKey", async ({ secret }) => ({ "X-API-Key": secret }));
```

### Automatic refresh on 401
If `refreshOn401` is `true` and a request returns **401**, the client will emit a single refresh cycle:
1. Calls `user.requestSecretUpdate(type, contextId)` for each `type` in order.
2. Waits for your auth module to handle `secret-needs-update` and call `setSecret`.
3. Replays the request once with the new headers.

If the refresh fails or another non-retriable error occurs, the original error is thrown.

### Retries & backoff
- Retries apply to **network errors**, **429**, and **5xx** responses, up to `maxRetries` with exponential backoff (capped).
- **Timeouts:** Requests are aborted after `timeoutMs` using `AbortController`.

### Response parsing
- `expect: "json"` → parse JSON, `expect: "text"` → text, default is **auto**:
    1. If `content-type` includes `application/json`, parse JSON.
    2. Otherwise, try JSON, then fall back to text.

### Errors (`HTTPError`)
`HttpClient` throws a specialized `HTTPError` that extends `Error` and includes:
- `response` (the `Response` object, if available)
- `textData` (captured raw body for diagnostics)
- `statusCode` (HTTP status or `500` for generic failures)

```js
try {
  await mlflow.request("/something");
} catch (e) {
  if (e instanceof HTTPError) {
    console.error(e.statusCode, e.textData);
  }
}
```

---

## 4) Putting it together (end-to-end example)

```js
// 1) Startup: make sure the user is logged in and set a JWT for the "mlflow" context
const user = XOpatUser.instance();
VIEWER_MANAGER.addHandler('before-first-open', async () => {
  if (!user.isLogged) await ensureUserLoggedIn();

  const jwt = await acquireJwtFor("mlflow");
  user.setSecret(jwt, "jwt", "mlflow");
});

// 2) Auth module listens for refresh requests (or just use 'secret-needs-update:mlflow' event name directly)
user.addHandler(user.getEventName('secret-needs-update', 'mlflow'), async ({ type }) => {
  if (type === 'jwt') {
    const refreshed = await refreshJwtSilently();
    if (refreshed) XOpatUser.instance().setSecret(refreshed, type, contextId);
  }
});

// 3) Use the client
const client = new HttpClient({ baseURL: MLFLOW_URL, auth: { contextId: 'mlflow', types: ['jwt'] } });
const data = await client.request('/experiments/list');
```

---

## 5) Notes & Best Practices
- Prefer **context-bound** secrets for services with different lifecycles or issuers (e.g., `mlflow`, `analytics`).
- Keep `types` ordered by preference (e.g., try `jwt` first, then fall back to `basic`).
- Treat `logout()` as a destructive operation that clears **all** secrets unless context ID is specified; handle session UI accordingly.
- If you introduce a new secret type, **register a handler** early during app startup.
- In multi-auth setups, assign **event priorities** (e.g., on `before-first-open`) so only the first successful login path wins.


