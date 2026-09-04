/**
 * "Not signed in yet" is not "the provider is broken".
 *
 * A deployment can legitimately gate its chat behind a login while leaving the viewer open —
 * slides for everyone, the model for whoever signs in. On such a deployment the very first
 * provider-registration RPC is REFUSED, and that used to be handled as if the backend had
 * fallen over: four attempts, ~5.6 s of exponential backoff, and then a red band reading
 * "Couldn't connect to the OpenAI provider: Unauthorized: RPC auth failed" with a Retry button
 * — in front of a user whose only problem was that they had not clicked Login. Nothing
 * re-registered when they eventually did, so the dead end was permanent until Retry.
 *
 * Three separable decisions come out of that, and this file pins all three:
 *
 *   1. WHICH failures are refusals (`shared/errors.ts`) — the predicate everything hangs off,
 *      and the one that must not quietly widen until a 500 stops being retried;
 *   2. that a refusal ends the retry loop immediately and lands in the PENDING set rather
 *      than the failed one;
 *   3. that a genuine fault still gets its retries, which is the guard saying decision 2
 *      narrowed the classification instead of gutting the loop.
 *
 * The loop is exercised for real — `ChatModule.prototype._runManagedRegistration` called on a
 * hand-built `this` — rather than reimplemented here, because a copy of the policy in a test
 * only ever proves the copy.
 */
import { test, expect, installBrowserGlobals } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const moduleDir = path.join(fromRoot(), "modules", "vercel-ai-chat-sdk");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-chat-reg-"));

async function bundle(entry, name) {
    const outfile = path.join(tmp, `${name}.mjs`);
    await esbuild.build({
        entryPoints: [entry], outfile, bundle: true, platform: "neutral",
        format: "esm", logLevel: "silent",
    });
    return import(pathToFileURL(outfile).href);
}

const { isAuthError } = await bundle(path.join(moduleDir, "shared", "errors.ts"), "errors");

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ── 1. the predicate ────────────────────────────────────────────────────────────────────

test("a refusal is recognised however the layer that rejected it reports one", { tag: ["@unit"] }, () => {
    // The same call can fail as an HTTPError carrying `statusCode` or as an RPC error
    // carrying the server's `code`, and the caller cannot know in advance which.
    expect(isAuthError({ statusCode: 401 })).toBe(true);
    expect(isAuthError({ status: 401 })).toBe(true);
    expect(isAuthError({ statusCode: 403 }), "authenticated but not permitted is still refused").toBe(true);
    expect(isAuthError({ code: "RPC_AUTH_FAILED" })).toBe(true);
    expect(isAuthError({ code: "RPC_NO_SESSION" })).toBe(true);
    expect(isAuthError({ code: "RPC_BAD_CSRF" })).toBe(true);
});

test("RPC_AUTH* is matched by prefix, so a new server code is covered on the day it lands", { tag: ["@unit"] }, () => {
    expect(isAuthError({ code: "RPC_AUTH_EXPIRED" })).toBe(true);
    expect(isAuthError({ code: "RPC_AUTH_SOMETHING_INVENTED_LATER" })).toBe(true);
});

test("everything else is a transient and must keep its retries", { tag: ["@unit"] }, () => {
    // This is the guard on the whole change: widen the predicate and the retry loop
    // silently stops covering the outage it was written for.
    expect(isAuthError({ statusCode: 500 })).toBe(false);
    expect(isAuthError({ statusCode: 502 })).toBe(false);
    expect(isAuthError({ code: "RPC_TIMEOUT" })).toBe(false);
    expect(isAuthError(new Error("Failed to fetch"))).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
});

// ── 2 & 3. the loop ─────────────────────────────────────────────────────────────────────

/**
 * `chat.ts` cannot be imported at module scope, and the reason is worth stating: evaluating it
 * needs stand-ins for `van`, `UI`, `OpenSeadragon` and `XOpatModuleSingleton`, and a worker
 * imports every spec file into ONE process. Installing those globals at module scope put them
 * in place while OTHER spec files were still evaluating theirs — a half-real `OpenSeadragon`
 * broke `plugins/dicom`'s tile source at its own import. Load inside the fixture instead, where
 * nobody else's module scope is running, and hand the globals back the moment the class exists.
 */
let ChatModule;
let shims;

test.beforeAll(async () => {
    // A permissive proxy is right here precisely because nothing under test calls through it:
    // a hand-listed set of tags would be a second thing to maintain every time the panel adds
    // an element.
    const vanStub = {
        tags: new Proxy({}, { get: () => () => ({}) }),
        state: (v) => ({ val: v }),
        derive: (fn) => ({ val: fn() }),
        add: () => {},
        hydrate: () => {},
    };
    const heavy = installBrowserGlobals({
        extra: {
            addModule: () => {},
            van: vanStub,
            UI: new Proxy({}, { get: () => class {} }),
            OpenSeadragon: { EventSource: class {} },
            // The loader normally supplies this base class. Only its identity matters — the
            // policy under test lives on ChatModule's own prototype.
            XOpatModuleSingleton: class { constructor() {} },
        },
    });
    try {
        ({ ChatModule } = await bundle(path.join(moduleDir, "chat.ts"), "chat"));
    } finally {
        heavy.restore();
    }
    // The class survives its evaluation environment; the tests themselves need only `$.t`,
    // which the failure path reaches for.
    shims = installBrowserGlobals();
});

test.afterAll(() => shims?.restore());

/**
 * The minimum `this` `_runManagedRegistration` touches, plus a record of what it did.
 * Built by hand rather than by constructing a ChatModule: the constructor wants a viewer,
 * a panel and a live server, none of which this policy consults.
 */
function harness() {
    const state = {
        events: [], busy: [], statuses: [], notices: [], refreshed: 0, waitedFor: [],
    };
    const self = {
        _failedRegistrations: new Map(),
        _pendingAuthRegistrations: new Map(),
        _describeRegistrationError: ChatModule.prototype._describeRegistrationError,
        _syncRegistrationFailureNotice: () => state.notices.push("failure"),
        _syncRegistrationAuthNotice: () => state.notices.push("auth"),
        _indexManagedRegistration: () => {},
        _settleRegistrationContext: async (contextId) => {
            state.waitedFor.push(contextId ?? null);
        },
        refreshProviders: async () => { state.refreshed++; },
        raiseEvent: (name, payload) => state.events.push({ name, payload }),
        chatPanel: {
            setExternalBusy: (key, phase) => state.busy.push(phase),
            _setStatus: (text) => state.statuses.push(text),
        },
        state,
    };
    return self;
}

const run = (self, register, opts = {}) =>
    ChatModule.prototype._runManagedRegistration.call(self, register, opts);

test("the context is waited for before the first attempt, not after it", { tag: ["@unit"] }, async () => {
    // Plugins load during `before-app-init`, which runs BEFORE core awaits the boot login,
    // and the RPC rides a client whose `awaitContext` is false — so without this wait the
    // first attempt is guaranteed to race an in-flight login.
    const self = harness();
    const order = [];
    self._settleRegistrationContext = async (id) => { order.push(`settle:${id}`); };

    await run(self, async () => { order.push("register"); return { ok: true }; }, { contextId: "chat" });

    expect(order).toEqual(["settle:chat", "register"]);
});

test("a provider needing no login waits for nothing", { tag: ["@unit"] }, async () => {
    // Passing a contextId for an authMode "none" deployment would park the registration
    // on a context nobody ever authenticates.
    const self = harness();

    await run(self, async () => ({ ok: true }), {});

    expect(self.state.waitedFor).toEqual([null]);
});

test("a refusal is attempted exactly once", { tag: ["@unit"] }, async () => {
    const self = harness();
    let attempts = 0;

    const started = Date.now();
    const result = await run(self, async () => {
        attempts++;
        throw Object.assign(new Error("Unauthorized: RPC auth failed"), { code: "RPC_AUTH_FAILED" });
    }, { label: "OpenAI", contextId: "chat" });

    expect(attempts, "retrying a verdict just asks the same question again").toBe(1);
    expect(result).toBeNull();
    // The old path slept 0.8 + 1.6 + 3.2s before giving up. Generous bound — the point is
    // that no backoff ran at all, not the exact wall-clock.
    expect(Date.now() - started).toBeLessThan(500);
});

test("a refusal is pending, not failed, and says so without crying wolf", { tag: ["@unit"] }, async () => {
    const self = harness();

    await run(self, async () => {
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }, { label: "OpenAI", contextId: "chat" });

    expect(self._pendingAuthRegistrations.has("OpenAI")).toBe(true);
    expect(self._failedRegistrations.size, "nothing failed").toBe(0);
    expect(self.state.notices).toContain("auth");
    // The status line said "Chat provider unavailable." on this path. It is available;
    // the user is not signed in.
    expect(self.state.statuses).toEqual([]);
    const names = self.state.events.map(e => e.name);
    expect(names).toContain("provider-registration-needs-login");
    expect(names, "an observer must not hear this as an outage").not.toContain("provider-registration-failed");
});

test("the pending entry keeps what it needs to re-run itself after a login", { tag: ["@unit"] }, async () => {
    const self = harness();
    const register = async () => { throw Object.assign(new Error("nope"), { statusCode: 401 }); };

    await run(self, register, { label: "OpenAI", contextId: "chat" });

    const entry = self._pendingAuthRegistrations.get("OpenAI");
    expect(entry.register).toBe(register);
    expect(entry.opts.contextId, "the watcher checks THIS context before re-running").toBe("chat");
});

test("a genuine fault still gets every retry and still reports a failure", { tag: ["@unit"] }, async () => {
    // The regression guard: this change narrowed which errors skip the loop, it did not
    // remove the loop.
    const self = harness();
    let attempts = 0;

    await run(self, async () => {
        attempts++;
        throw Object.assign(new Error("Internal Server Error"), { statusCode: 500 });
    }, { label: "OpenAI" });

    expect(attempts).toBe(4);
    expect(self._failedRegistrations.has("OpenAI")).toBe(true);
    expect(self._pendingAuthRegistrations.size).toBe(0);
    expect(self.state.events.map(e => e.name)).toContain("provider-registration-failed");
});

test("a fault that clears on a retry registers normally", { tag: ["@unit"] }, async () => {
    const self = harness();
    let attempts = 0;

    const result = await run(self, async () => {
        if (++attempts < 3) throw Object.assign(new Error("cold backend"), { statusCode: 503 });
        return { providerId: "prov_1" };
    }, { label: "OpenAI" });

    expect(result).toEqual({ providerId: "prov_1" });
    expect(self._failedRegistrations.size).toBe(0);
    expect(self._pendingAuthRegistrations.size).toBe(0);
    expect(self.state.refreshed, "the catalogue is refreshed so the provider self-surfaces").toBe(1);
});

/** Run with a stubbed `APPLICATION_CONTEXT.auth` and the REAL `_settleRegistrationContext`. */
async function withAuth(auth, body) {
    const previous = globalThis.APPLICATION_CONTEXT;
    globalThis.APPLICATION_CONTEXT = { auth };
    try {
        const self = harness();
        self._settleRegistrationContext = ChatModule.prototype._settleRegistrationContext;
        return await body(self);
    } finally {
        globalThis.APPLICATION_CONTEXT = previous;
    }
}

test("a context nobody logs in at boot is NOT settled on our behalf", { tag: ["@unit"] }, async () => {
    // The regression this gate exists for. Settling a context is not passive — it runs the
    // broker's init(), and for OIDC that includes the once-per-session `prompt=none` probe.
    // Forcing it on a deployment that deliberately does not log in at boot made the probe run,
    // come back `interaction_required`, and park the context in needs-interaction — after which
    // the user's own Login click deferred to the recovery gate instead of navigating.
    let settled = 0;
    await withAuth(
        { whenContextSettled: async () => { settled++; return false; }, listAutoLoginContexts: () => [] },
        async (self) => { await run(self, async () => ({ ok: true }), { contextId: "chat" }); },
    );

    expect(settled, "nothing is driving a login for this context, so there is nothing to wait for").toBe(0);
});

test("a context core WILL log in at boot is waited for", { tag: ["@unit"] }, async () => {
    // The case the wait exists for: a redirect callback is being processed, and registering
    // before it lands guarantees a 401 the deployment never intended.
    let settled = 0;
    await withAuth(
        { whenContextSettled: async () => { settled++; return true; }, listAutoLoginContexts: () => ["core"] },
        async (self) => { await run(self, async () => ({ ok: true }), { contextId: "core" }); },
    );

    expect(settled).toBe(1);
});

test("a context whose wait rejects does not block the registration", { tag: ["@unit"] }, async () => {
    // The wait is an optimisation of WHEN we ask, never a precondition for asking: a broker
    // that fails to settle must not strand a provider whose server would answer fine — and a
    // rejection escaping here would break `registerManagedProvider`'s "never rejects" contract.
    const result = await withAuth(
        {
            whenContextSettled: async () => { throw new Error("broker exploded"); },
            listAutoLoginContexts: () => ["chat"],
        },
        (self) => run(self, async () => ({ ok: true }), { contextId: "chat" }),
    );

    expect(result).toBeTruthy();
});

test("a deployment with no auth module at all is not made to wait", { tag: ["@unit"] }, async () => {
    // `whenContextSettled` missing is the ordinary no-auth case, not an error.
    const result = await withAuth({}, (self) => run(self, async () => ({ ok: true }), { contextId: "chat" }));

    expect(result).toBeTruthy();
});
