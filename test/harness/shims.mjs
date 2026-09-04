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
