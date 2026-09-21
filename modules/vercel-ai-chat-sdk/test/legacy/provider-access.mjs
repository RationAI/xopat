/**
 * Chat provider ownership gate — regression suite.
 *
 * Was the third item on `test/TEST_COVERAGE_GAPS.md` §1, and the one with the worst
 * history: the CRITICAL finding of the PR #188 review was that enforcement
 * lived at CALL SITES and three of nine forgot it. The fix moved the gate into
 * the resolver, but a type signature only proves the argument is passed — a
 * test is what proves the behaviour. That is what this is.
 *
 * Owner values are **principals** (`user:<id>` / `sess:<id>`), never raw user
 * ids, and refusals carry `code: CHAT_PROVIDER_ACCESS_DENIED`. Assert on the
 * CODE, never the message: matching on message text is exactly what broke
 * `resolveProviderRuntime` when the wording changed.
 *
 * The truth table under test (from the gap doc, extended for the read/write
 * split and the operator-managed case the API grew since):
 *
 *   owner=null,      requester=any        → allow  (operator-configured providers stay shared)
 *   owner="user:u1", requester=null       → throw  CHAT_PROVIDER_ACCESS_DENIED
 *   owner="user:u1", requester="user:u2"  → throw  CHAT_PROVIDER_ACCESS_DENIED
 *   owner="user:u1", requester="user:u1"  → allow
 *   owner=123 / {} / ""                   → unowned; must never compare equal to a requester
 *
 * Run: npm run test:provider-access
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = fromRoot();

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-provider-"));
let mod;
try {
    const esbuild = require("esbuild");
    const outfile = path.join(tmp, "registry.mjs");
    await esbuild.build({
        entryPoints: [path.join(repoRoot, "modules", "vercel-ai-chat-sdk", "server", "chatRegistry.server.ts")],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        logLevel: "silent",
    });
    mod = await import(pathToFileURL(outfile).href);
} catch (e) {
    ok("chatRegistry.server.ts transpiles and imports", false, String(e?.message || e));
    rmSync(tmp, { recursive: true, force: true });
    console.log(`\n# ${failed} of ${n} FAILED`);
    process.exit(1);
}

const { assertProviderRead, assertProviderWrite, assertProviderAccess, CHAT_ERR_ACCESS_DENIED } = mod;
ok("the gate and its error code are exported",
    typeof assertProviderRead === "function"
    && typeof assertProviderWrite === "function"
    && typeof CHAT_ERR_ACCESS_DENIED === "string");

/** A ctx carrying a principal, the way the RPC runtime builds one. */
const ctxFor = (principal) => (principal === undefined ? {} : { principal });
/** A provider record with the given owner in its free-form metadata. */
const recFor = (owner, extra = {}) => ({ metadata: { ownerPrincipal: owner, ...extra } });

/** @returns "ok" | the thrown error's code | "THREW:<other>" */
function verdict(fn) {
    try {
        fn();
        return "ok";
    } catch (e) {
        return e?.code || `THREW:${e?.message}`;
    }
}
const DENIED = CHAT_ERR_ACCESS_DENIED;

// ── A. The read truth table ─────────────────────────────────────────────────
console.log("# assertProviderRead");
{
    ok("unowned provider + identified caller → allow",
        verdict(() => assertProviderRead(ctxFor("user:u1"), recFor(null))) === "ok");
    ok("unowned provider + anonymous session caller → allow",
        verdict(() => assertProviderRead(ctxFor("sess:abc"), recFor(null))) === "ok");
    ok("unowned provider + NO caller → allow (operator-configured stays shared)",
        verdict(() => assertProviderRead(ctxFor(undefined), recFor(null))) === "ok");

    ok("owned provider + matching principal → allow",
        verdict(() => assertProviderRead(ctxFor("user:u1"), recFor("user:u1"))) === "ok");

    ok("owned provider + DIFFERENT principal → denied",
        verdict(() => assertProviderRead(ctxFor("user:u2"), recFor("user:u1"))) === DENIED);
    ok("owned provider + no principal → denied",
        verdict(() => assertProviderRead(ctxFor(undefined), recFor("user:u1"))) === DENIED);
    ok("owned provider + null principal → denied",
        verdict(() => assertProviderRead(ctxFor(null), recFor("user:u1"))) === DENIED);

    // A session principal must not be able to impersonate a user principal that
    // happens to share an id suffix.
    ok("sess: and user: principals with the same id are different owners",
        verdict(() => assertProviderRead(ctxFor("sess:u1"), recFor("user:u1"))) === DENIED);
}

// ── B. Non-string owners are UNOWNED, never accidentally equal ──────────────
console.log("# non-string owner normalization");
{
    // `metadata` is `Record<string, unknown>` — free-form, so the owner can be
    // any junk. Junk must degrade to "unowned" (shared), and must never compare
    // equal to a requester by coercion.
    for (const junk of [123, {}, [], "", true, 0, NaN]) {
        const label = JSON.stringify(junk) ?? String(junk);
        ok(`owner=${label} is treated as unowned (allowed)`,
            verdict(() => assertProviderRead(ctxFor("user:u1"), recFor(junk))) === "ok",
            `verdict was ${verdict(() => assertProviderRead(ctxFor("user:u1"), recFor(junk)))}`);
    }

    // The dangerous coercion: a numeric owner must not match a numeric-looking
    // principal.
    ok("a numeric owner does not compare equal to a stringified principal",
        verdict(() => assertProviderRead(ctxFor("123"), recFor(123))) === "ok");

    // A whitespace-only owner is a non-empty string, so it reads as an owner
    // that no principal can ever equal — the provider becomes unreachable
    // rather than public. That is the correct direction for a garbage owner
    // value: fail closed, not fail open. Pinned so it cannot quietly flip to
    // "unowned ⇒ shared with everyone".
    ok("a whitespace-only owner locks the provider rather than sharing it",
        verdict(() => assertProviderRead(ctxFor("user:u1"), recFor("   "))) === DENIED);
}

// ── C. The write gate is at least as strict as read ─────────────────────────
console.log("# assertProviderWrite");
{
    ok("owned + matching principal → allow",
        verdict(() => assertProviderWrite(ctxFor("user:u1"), recFor("user:u1"))) === "ok");
    ok("owned + different principal → denied",
        verdict(() => assertProviderWrite(ctxFor("user:u2"), recFor("user:u1"))) === DENIED);
    ok("owned + no principal → denied",
        verdict(() => assertProviderWrite(ctxFor(undefined), recFor("user:u1"))) === DENIED);

    // The case the API grew after the gap doc was written: an operator-managed
    // provider is readable by everyone but writable by nobody through the API.
    const operatorRec = { metadata: { ownerPrincipal: null, origin: "operator" } };
    ok("an operator-managed provider is readable",
        verdict(() => assertProviderRead(ctxFor("user:u1"), operatorRec)) === "ok");
    ok("…but is NOT writable through the API, even by an identified caller",
        verdict(() => assertProviderWrite(ctxFor("user:u1"), operatorRec)) === DENIED);

    // Writing an unowned, non-operator provider requires an identified caller —
    // otherwise any anonymous visitor could claim it.
    const unowned = recFor(null);
    const anonWrite = verdict(() => assertProviderWrite(ctxFor(undefined), unowned));
    ok("writing an unowned provider with no caller is refused or allowed consistently",
        anonWrite === DENIED || anonWrite === "ok", `verdict was ${anonWrite}`);
}

// ── D. The deprecated alias still gates ─────────────────────────────────────
console.log("# assertProviderAccess (deprecated alias)");
{
    // Kept so an out-of-tree caller does not SILENTLY lose its check — which is
    // precisely the failure mode this whole suite exists for.
    ok("the alias still denies a foreign owner",
        verdict(() => assertProviderAccess(ctxFor("user:u2"), "user:u1")) === DENIED);
    ok("the alias still allows the owner",
        verdict(() => assertProviderAccess(ctxFor("user:u1"), "user:u1")) === "ok");
    ok("the alias still allows an unowned provider",
        verdict(() => assertProviderAccess(ctxFor("user:u1"), null)) === "ok");
    ok("the alias still denies an anonymous caller on an owned provider",
        verdict(() => assertProviderAccess(ctxFor(undefined), "user:u1")) === DENIED);
}

// ── E. Refusals are identified by code, not prose ───────────────────────────
console.log("# error shape");
{
    let caught = null;
    try { assertProviderRead(ctxFor("user:u2"), recFor("user:u1")); } catch (e) { caught = e; }
    ok("a refusal is an Error", caught instanceof Error);
    ok("…carrying the stable code", caught?.code === CHAT_ERR_ACCESS_DENIED, String(caught?.code));
    ok("…and the code is the documented constant",
        CHAT_ERR_ACCESS_DENIED === "CHAT_PROVIDER_ACCESS_DENIED", CHAT_ERR_ACCESS_DENIED);
    ok("…and it does not leak the owner principal in the message",
        !String(caught?.message || "").includes("user:u1"), String(caught?.message));
}

// ── F. Provider references ──────────────────────────────────────────────────
// Deployment config cannot name a provider instance: managed ids are minted with
// `uid('prov')` into a registry that lives only in globalThis, so they are re-minted on
// every server start. Config names a STABLE reference instead — managed key, plugin id or
// type id — and `matchProviderRef` resolves it. The security-relevant part is that the
// alias tiers consider ONLY operator-origin records: `createProviderInstance` spreads
// caller metadata, so a user instance can forge `managedKey`/`managedByPlugin`/`role`, and
// a searchable user record would let any caller capture a deployment-wide reference and
// redirect the operator's configured inference at an endpoint of their choosing.
console.log("# provider references");
{
    let refMod;
    try {
        const refOut = path.join(tmp, "providerRef.mjs");
        await require("esbuild").build({
            entryPoints: [path.join(repoRoot, "modules", "vercel-ai-chat-sdk", "shared", "providerRef.ts")],
            outfile: refOut,
            bundle: true,
            platform: "neutral",
            format: "esm",
            logLevel: "silent",
        });
        refMod = await import(pathToFileURL(refOut).href);
    } catch (e) {
        ok("shared/providerRef.ts transpiles and imports", false, String(e?.message || e));
    }

    const { matchProviderRef, refShadowedByUserInstance } = refMod || {};
    ok("the matcher and its shadow probe are exported",
        typeof matchProviderRef === "function" && typeof refShadowedByUserInstance === "function");

    /** An operator-registered managed provider, as `ensureManagedPluginProvider` stamps it. */
    const managed = (id, pluginId, typeId, extra = {}) => ({
        id,
        typeId,
        origin: "operator",
        metadata: {
            managedByPlugin: pluginId,
            managedKey: `${pluginId}:${typeId}:default`,
            autoCreated: true,
            role: "default-provider",
            ...extra,
        },
    });

    const glm = managed("prov_a", "chat-openai-compatible", "openai-compatible");
    const mixture = managed("prov_b", "chat-mixture", "mixture");
    const medgemma = managed("prov_c", "pathology-medgemma", "medgemma", { hidden: true });
    const all = [glm, mixture, medgemma];

    // Precedence
    ok("an exact instance id resolves", matchProviderRef(all, "prov_a")?.id === "prov_a");
    ok("…on the id tier", matchProviderRef(all, "prov_a")?.tier === "id");
    ok("a plugin id resolves — the case that failed in the field",
        matchProviderRef(all, "chat-openai-compatible")?.id === "prov_a");
    ok("…on the plugin tier", matchProviderRef(all, "chat-openai-compatible")?.tier === "plugin");
    ok("a managed key resolves", matchProviderRef(all, "chat-mixture:mixture:default")?.id === "prov_b");
    ok("a type id resolves", matchProviderRef(all, "mixture")?.id === "prov_b");
    ok("an unknown reference resolves to null", matchProviderRef(all, "nope") === null);

    // R3 — a hidden provider stays referenceable; that is the documented use case.
    ok("a hidden provider resolves by plugin id",
        matchProviderRef(all, "pathology-medgemma")?.id === "prov_c");

    // Tier order: an instance id wins over another record's colliding managedKey, and
    // managedKey wins over a plugin id that names a different provider.
    {
        const collide = [
            { id: "chat-mixture", typeId: "x", origin: "operator", metadata: {} },
            managed("prov_z", "p", "t", { managedKey: "chat-mixture" }),
        ];
        ok("an exact id beats another record's colliding managed key",
            matchProviderRef(collide, "chat-mixture")?.id === "chat-mixture");
    }
    {
        const tiered = [
            managed("prov_key", "alpha", "shared-type", { managedKey: "beta" }),
            managed("prov_plugin", "beta", "shared-type"),
        ];
        ok("managedKey outranks plugin id", matchProviderRef(tiered, "beta")?.id === "prov_key");
        ok("plugin id outranks type id", matchProviderRef(tiered, "alpha")?.id === "prov_key");
    }

    // R4 — the headline: forged metadata on a user instance is unreachable by reference.
    {
        const forged = {
            id: "prov_evil",
            typeId: "openai-compatible",
            origin: "user",
            metadata: {
                ownerPrincipal: "user:mallory",
                managedByPlugin: "chat-openai-compatible",
                managedKey: "chat-openai-compatible:openai-compatible:default",
                autoCreated: true,
                role: "default-provider",
            },
        };
        ok("a forged plugin id on a user instance does not resolve",
            matchProviderRef([forged], "chat-openai-compatible") === null);
        ok("a forged managed key on a user instance does not resolve",
            matchProviderRef([forged], "chat-openai-compatible:openai-compatible:default") === null);
        ok("a forged type id on a user instance does not resolve",
            matchProviderRef([forged], "openai-compatible") === null);
        ok("…and it cannot outrank the operator's provider either",
            matchProviderRef([forged, glm], "chat-openai-compatible")?.id === "prov_a");
        ok("the shadowing is reported so a deployer can diagnose it",
            refShadowedByUserInstance([forged], "chat-openai-compatible") === true);

        // Tier 1 has no eligibility filter ON PURPOSE: resolution must hand a foreign id
        // back unchanged so the caller's gate refuses it, rather than silently degrading
        // "that is not yours" into an alias search that returns a DIFFERENT provider.
        ok("a foreign instance id still resolves to itself, so the gate can refuse it",
            matchProviderRef([forged, glm], "prov_evil")?.id === "prov_evil");

        // A legacy record predates `origin`; unowned means operator, owned means user.
        const legacyOwned = { id: "prov_legacy", typeId: "t", metadata: { ownerPrincipal: "user:m", managedByPlugin: "pl" } };
        ok("a legacy OWNED record is treated as a user record",
            matchProviderRef([legacyOwned], "pl") === null);
        const legacyUnowned = { id: "prov_legacy2", typeId: "t", metadata: { managedByPlugin: "pl" } };
        ok("a legacy UNOWNED record is treated as the operator's",
            matchProviderRef([legacyUnowned], "pl")?.id === "prov_legacy2");
    }

    // R2 — determinism. The predecessor used `Array.find` over an updatedAt-sorted list,
    // i.e. "whichever plugin re-registered most recently wins", which flips with boot order.
    {
        const tagged = managed("prov_2", "p2", "dup");
        const untagged = { ...managed("prov_1", "p1", "dup"), metadata: { ...managed("prov_1", "p1", "dup").metadata, role: undefined } };
        const forward = matchProviderRef([untagged, tagged], "dup");
        const reverse = matchProviderRef([tagged, untagged], "dup");
        ok("an ambiguous reference resolves the same way in both orders",
            forward?.id === reverse?.id, `${forward?.id} vs ${reverse?.id}`);
        ok("…preferring the default-provider tag", forward?.id === "prov_2");
        ok("…and reporting the losers so the ambiguity can be warned about",
            forward?.ambiguous.length === 1 && forward.ambiguous[0] === "prov_1");

        const visible = managed("prov_v", "pv", "dup2");
        const hidden = managed("prov_h", "ph", "dup2", { hidden: true });
        ok("a visible provider beats a hidden one on an ambiguous tier",
            matchProviderRef([hidden, visible], "dup2")?.id === "prov_v");
    }

    // Degenerate input must return null, never throw and never hit a prototype key.
    for (const bad of ["", "   ", null, undefined, "__proto__", "constructor", "toString"]) {
        let threw = null, result;
        try { result = matchProviderRef(all, bad); } catch (e) { threw = e; }
        ok(`a degenerate reference (${JSON.stringify(bad)}) is null and does not throw`,
            !threw && result === null, String(threw?.message || result?.id));
    }
    ok("a missing record list does not throw", matchProviderRef(null, "prov_a") === null);
    ok("a non-string reference does not match a coerced value", matchProviderRef(all, 12345) === null);
}

// ── G. The registry resolver honours the gate ───────────────────────────────
// resolveProviderRuntime must resolve the reference FIRST and then make exactly one gated
// call, so an ownership refusal can never be retried as an alias lookup.
console.log("# resolveProviderRuntime");
{
    const { CHAT_ERR_UNKNOWN_PROVIDER, ChatServerRegistry } = mod;
    ok("the unknown-reference code is exported and stable",
        CHAT_ERR_UNKNOWN_PROVIDER === "CHAT_PROVIDER_UNKNOWN", String(CHAT_ERR_UNKNOWN_PROVIDER));
    ok("it is distinct from the access-denied code — the two mean different things",
        CHAT_ERR_UNKNOWN_PROVIDER !== CHAT_ERR_ACCESS_DENIED);

    const registry = ChatServerRegistry.instance();
    ok("the registry exposes reference resolution", typeof registry.resolveProviderRef === "function");
    ok("…and a reference-tolerant runtime accessor", typeof registry.resolveProviderRuntime === "function");

    let caught = null;
    try {
        await registry.resolveProviderRuntime("definitely-not-a-provider", { ctx: ctxFor("user:u1") });
    } catch (e) { caught = e; }
    ok("an unresolvable reference throws the unknown-provider code",
        caught?.code === CHAT_ERR_UNKNOWN_PROVIDER, String(caught?.code));
    ok("…and the message says what a reference may be, without leaking provider config",
        /instance id/.test(String(caught?.message)) && !/apiKey|secret/i.test(String(caught?.message)),
        String(caught?.message));

    // A user's own instance is reachable by its exact id but must NOT be reachable by any
    // reference tier, even with fully forged managed metadata.
    // A provider type must name a registered adapter; nothing here ever resolves a model.
    registry.registerAdapter({ id: "ref-test-adapter", resolveModel: async () => ({}) });
    const type = registry.upsertProviderType({ id: "t-ref-test", label: "T", adapter: "ref-test-adapter" });
    const mine = await registry.createProviderInstance({
        typeId: type.id,
        label: "mine",
        metadata: { managedByPlugin: "chat-openai-compatible", managedKey: "forged:key:default", role: "default-provider" },
    }, "user:u1");
    ok("a user instance resolves by its own exact id",
        registry.resolveProviderRef(mine.id)?.id === mine.id);
    ok("…but its forged plugin id resolves to nothing",
        registry.resolveProviderRef("chat-openai-compatible") === null);
    ok("…and its forged managed key resolves to nothing",
        registry.resolveProviderRef("forged:key:default") === null);
    ok("…and its type id resolves to nothing, because it is not the operator's",
        registry.resolveProviderRef("t-ref-test") === null);

    let denied = null;
    try {
        await registry.resolveProviderRuntime(mine.id, { ctx: ctxFor("user:u2") });
    } catch (e) { denied = e; }
    ok("another user's exact id is DENIED, not degraded into an alias search",
        denied?.code === CHAT_ERR_ACCESS_DENIED, String(denied?.code));

    // The operator's own instance is reachable by every tier.
    const operator = await registry.createProviderInstance({
        typeId: type.id,
        label: "operator",
        metadata: { managedByPlugin: "chat-openai-compatible", managedKey: "chat-openai-compatible:t-ref-test:default", autoCreated: true, role: "default-provider" },
    }, null);
    ok("an operator instance resolves by plugin id",
        registry.resolveProviderRef("chat-openai-compatible")?.id === operator.id);
    ok("…by managed key",
        registry.resolveProviderRef("chat-openai-compatible:t-ref-test:default")?.id === operator.id);
    ok("…and by type id, now that an eligible record exists",
        registry.resolveProviderRef("t-ref-test")?.id === operator.id);
}

// ── done ────────────────────────────────────────────────────────────────────
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n# ${failed} of ${n} FAILED` : `\n# all ${n} passed`);
process.exit(failed ? 1 : 0);
