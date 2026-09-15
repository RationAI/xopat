/**
 * Browser globals for unit-testing client code in plain Node.
 *
 * Much of xOpat's pure logic is delivered as browser scripts that assign to
 * `window` or reach for `$.t`, `atob`, `requestAnimationFrame`. Every
 * pre-runner suite that needed those grew its own private shim — a different
 * `$` stub in one file, a hand-rolled rAF queue in another — which is how three
 * files ended up with three subtly different notions of "the browser".
 *
 * One shim, installed and removed around a test, keeps that from happening
 * again. It is deliberately thin: anything that needs a real DOM belongs in a
 * browser project, not here.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fromRoot } from "./paths.mjs";

const NOT_SET = Symbol("not-set");

/**
 * @param {object} [options]
 * @param {(key: string, vars?: object) => string} [options.t] `$.t` implementation
 * @param {Record<string, unknown>} [options.extra] additional globals to define
 * @returns {{restore: () => void, flushRaf: () => void, window: object}}
 */
export function installBrowserGlobals(options = {}) {
    const previous = new Map();
    const define = (name, value) => {
        previous.set(name, name in globalThis ? globalThis[name] : NOT_SET);
        globalThis[name] = value;
    };

    // `window === globalThis` so that `window.Foo = ...` in a loaded script is
    // reachable as `globalThis.Foo`, which is how these scripts are consumed.
    if (!("window" in globalThis)) define("window", globalThis);

    // The dummy `$.t` mirrors the one `src/loader.ts` installs before i18next
    // initializes: it returns the key's last dot-segment, never a literal
    // fallback. A test asserting on user-facing text should assert on the KEY.
    define("$", { t: options.t ?? ((key) => String(key).split(".").pop()) });

    if (typeof globalThis.atob !== "function") {
        define("atob", (b64) => Buffer.from(b64, "base64").toString("binary"));
    }
    if (typeof globalThis.btoa !== "function") {
        define("btoa", (bin) => Buffer.from(bin, "binary").toString("base64"));
    }

    // A manually pumped rAF: real timing would make assertions racy, and tests
    // that need a frame boundary should say so by calling `flushRaf()`.
    const rafQueue = [];
    define("requestAnimationFrame", (fn) => rafQueue.push(fn) - 1);
    define("cancelAnimationFrame", (handle) => { rafQueue[handle] = null; });

    for (const [name, value] of Object.entries(options.extra ?? {})) define(name, value);

    return {
        window: globalThis,
        flushRaf() {
            const pending = rafQueue.splice(0, rafQueue.length);
            for (const fn of pending) if (fn) fn(performance.now());
        },
        restore() {
            for (const [name, value] of previous) {
                if (value === NOT_SET) delete globalThis[name];
                else globalThis[name] = value;
            }
            previous.clear();
        },
    };
}

/**
 * Load a browser script that assigns to `window`, and hand back what it defined.
 *
 * @param {string} absolutePath
 * @param {string} globalName the `window.<name>` the script installs
 */
export async function loadBrowserScript(absolutePath, globalName) {
    const source = readFileSync(absolutePath, "utf8");
    // Not `eval`: these are repo-owned files, never user input, and the module
    // wrapper keeps the script's own `var`s out of the shared global scope.
    // eslint-disable-next-line no-new-func
    new Function("window", "globalThis", source)(globalThis, globalThis);
    return globalThis[globalName];
}

/** Memoized per path — the vendored bundle is large and its evaluation is pure. */
const sandboxedScripts = new Map();

/**
 * A DOM node stub flat enough for a browser bundle's feature detection.
 * Deliberately not a DOM: anything that needs one belongs in a browser project.
 */
function stubElement() {
    return {
        style: {}, className: "", nodeType: 1, children: [], childNodes: [],
        appendChild() {}, removeChild() {}, insertBefore() {},
        setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, removeEventListener() {},
        getContext() { return null; },
    };
}

/**
 * Evaluate the vendored OpenSeadragon in an isolated `vm` context.
 *
 * `loadBrowserScript` runs a script in the shared global scope, which is fine
 * for a small module but wrong for a 34k-line browser bundle that installs
 * timers, feature flags and a `OpenSeadragon` global every suite in the process
 * would then share. The classes worth unit-testing here — `ImageLoader`,
 * `ImageJob`, `BatchImageJob`, `Point`, `Rect` — are pure; only the bundle's
 * top-level browser detection needs satisfying, hence the thin stubs.
 *
 * Never returns a partially-initialized library: a failure to evaluate comes
 * back as `error`, so a caller can `test.skip` with the reason instead of
 * asserting against `undefined`.
 *
 * @param {string} [scriptPath] defaults to the vendored bundle
 * @returns {{OpenSeadragon: object|null, error: string|null}}
 */
export function loadOpenSeadragon(scriptPath = fromRoot("src/libs/openseadragon.js")) {
    const cached = sandboxedScripts.get(scriptPath);
    if (cached) return cached;

    let result;
    try {
        const sandbox = {
            console,
            setTimeout, clearTimeout, setInterval, clearInterval,
            performance,
            devicePixelRatio: 1,
            document: {
                documentElement: stubElement(),
                body: stubElement(),
                createElement: stubElement,
                createElementNS: stubElement,
                createTextNode: () => ({}),
                getElementsByTagName: () => [],
                getElementById: () => null,
                addEventListener() {}, removeEventListener() {},
            },
            navigator: { userAgent: "node", appVersion: "5.0 (node)", platform: "node", vendor: "" },
            location: {
                href: "http://localhost/", protocol: "http:", host: "localhost",
                hostname: "localhost", pathname: "/", search: "", hash: "",
            },
            XMLHttpRequest: class {},
            Image: class {},
            requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
            cancelAnimationFrame: clearTimeout,
        };
        sandbox.window = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.self = sandbox;

        vm.runInNewContext(readFileSync(scriptPath, "utf8"), sandbox, { filename: scriptPath });

        const OpenSeadragon = sandbox.OpenSeadragon ?? null;
        result = OpenSeadragon
            ? { OpenSeadragon, error: null }
            : { OpenSeadragon: null, error: `${scriptPath} defined no OpenSeadragon global` };
    } catch (e) {
        result = { OpenSeadragon: null, error: `${scriptPath} did not evaluate: ${e?.message ?? e}` };
    }

    sandboxedScripts.set(scriptPath, result);
    return result;
}

/**
 * The slice of `OpenSeadragon.EventSource` that `XOpatUser` actually uses.
 *
 * One definition, because four auth suites had four copies with two different
 * private field names — and `XOpatUser extends window.OpenSeadragon.EventSource`
 * binds to whichever copy existed at the FIRST import in the worker, so the other
 * three were dead code that only looked authoritative.
 */
class TestEventSource {
    constructor() { this.__handlers = new Map(); }
    addHandler(event, cb) {
        if (!this.__handlers.has(event)) this.__handlers.set(event, []);
        this.__handlers.get(event).push(cb);
    }
    removeHandler(event, cb) {
        const list = this.__handlers.get(event) || [];
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
    }
    numberOfHandlers(event) { return (this.__handlers.get(event) || []).length; }
    raiseEvent(event, payload) {
        for (const cb of [...(this.__handlers.get(event) || [])]) cb(payload || {});
    }
    async raiseEventAwaiting(event, payload) {
        for (const cb of [...(this.__handlers.get(event) || [])]) await cb(payload || {});
    }
}

/**
 * The pristine values of the tunable statics, captured on the first import —
 * i.e. before any suite has had a chance to write them. Restored on every call so
 * a suite that overrides them cannot decide the next suite's breaker thresholds.
 */
let pristineStatics = null;

/**
 * A fresh `XOpatUser` for a unit suite, with the browser surface it needs.
 *
 * `import(".../user.ts?t=<random>")` does NOT produce a fresh module: Playwright
 * transpiles and caches TypeScript by resolved path, so the query is discarded and
 * every suite in the worker shares ONE `XOpatUser` — one base class, one set of
 * statics, one singleton claim. Four suites each carried a partial workaround for
 * that, and the parts they missed leaked into each other:
 *
 *  - `secret-refresh-budget` writes `REFRESH_COOLDOWN_MS` / `MAX_REFRESH_FAILURES`
 *    and left `MAX_REFRESH_FAILURES = 1` behind; `secret-refresh-loop` relies on the
 *    default of 2, so its breaker tripped a round early and the suite failed
 *    whenever the two shared a worker.
 *  - Two suites *replaced* `window.OpenSeadragon` instead of merging into it,
 *    discarding the `TileSource` the OSD suites install.
 *  - Each installed only the globals its own vectors happened to reach, so a suite
 *    passed on the strength of what a neighbour left behind.
 *
 * Everything a suite can vary is a parameter; everything else is reset here.
 *
 * @param {object} [options]
 * @param {number} [options.cooldownMs] `XOpatUser.REFRESH_COOLDOWN_MS` for this test
 * @param {number} [options.maxFailures] `XOpatUser.MAX_REFRESH_FAILURES` for this test
 * @param {(ctx: string, opts: object) => void} [options.markNeedsInteraction]
 *        stands in for `APPLICATION_CONTEXT.auth.markNeedsInteraction`
 * @returns {Promise<{user: object, XOpatUser: Function, module: object}>}
 */
export async function freshXOpatUser(options = {}) {
    const { cooldownMs, maxFailures, markNeedsInteraction } = options;

    globalThis.window = globalThis.window ?? globalThis;
    // Merged, never replaced: a neighbour's `TileSource` must survive this call.
    globalThis.window.OpenSeadragon = {
        ...(globalThis.window.OpenSeadragon || {}),
        EventSource: TestEventSource,
    };

    // `user.ts` reads `HttpClient` bare (`setSecret`) and `window.APPLICATION_CONTEXT`
    // qualified — different lookups whenever `window` is not the global alias.
    const httpClient = { knowsSecretType: () => true };
    globalThis.window.HttpClient = httpClient;
    globalThis.HttpClient = httpClient;
    globalThis.$ = globalThis.$ ?? { t: (k) => k };
    // Probe for the method, not for *a* document: suites share a worker and a
    // neighbour's stand-in (a cookie jar, say) is truthy without being usable.
    if (typeof globalThis.document?.getElementById !== "function") {
        globalThis.document = { getElementById: () => null };
    }
    globalThis.USER_INTERFACE = { AppBar: { rightMenu: { getTab: () => ({ setTitle() {} }) } } };
    globalThis.Dialogs = { show() {}, MSG_ERR: "err" };
    globalThis.window.APPLICATION_CONTEXT = {
        auth: { markNeedsInteraction: (ctx, opts) => markNeedsInteraction?.(ctx, opts) },
    };

    const module = await import("../../src/classes/user.ts");
    const { XOpatUser } = module;

    if (!pristineStatics) {
        pristineStatics = {
            cooldownMs: XOpatUser.REFRESH_COOLDOWN_MS,
            maxFailures: XOpatUser.MAX_REFRESH_FAILURES,
        };
    }
    XOpatUser.REFRESH_COOLDOWN_MS = cooldownMs ?? pristineStatics.cooldownMs;
    XOpatUser.MAX_REFRESH_FAILURES = maxFailures ?? pristineStatics.maxFailures;

    // Release the singleton claim; `__self` is private to TypeScript only.
    XOpatUser.__self = undefined;
    return { user: XOpatUser.instance(), XOpatUser, module };
}
