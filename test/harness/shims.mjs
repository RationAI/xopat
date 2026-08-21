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
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(absolutePath, "utf8");
    // Not `eval`: these are repo-owned files, never user input, and the module
    // wrapper keeps the script's own `var`s out of the shared global scope.
    // eslint-disable-next-line no-new-func
    new Function("window", "globalThis", source)(globalThis, globalThis);
    return globalThis[globalName];
}
