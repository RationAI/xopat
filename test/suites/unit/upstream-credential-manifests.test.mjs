/**
 * Two invariants on the server side of the same failure.
 *
 * 1. A shipped `server.json` must never carry a PLACEHOLDER credential. The
 *    "is a credential configured?" gate is a presence check — any non-empty
 *    string reads as a real key — so a placeholder makes an unconfigured
 *    provider look usable, model discovery runs, and the upstream answers 401
 *    instead of the panel showing its "key required" hint. `""` is the state
 *    that means "required but absent"; `false` means "endpoint is keyless".
 *
 * 2. Errors leaving the SSRF guard carry the replay verdict the RPC client needs.
 *    A guard verdict is policy and never transient, so it is hard `false`; a
 *    transport failure is genuinely unknown, so it stays absent and lets the
 *    client's status heuristic decide.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "comment-json";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Shapes an operator is meant to REPLACE: screaming-snake tokens
 * (`YOUR_SERVER_ONLY_DEFAULT_TOKEN`) and angle-bracket slots (`<API_KEY>`).
 * Deliberately not "anything short" — a real key must never be flagged, or the
 * test gets suppressed the first time someone hits a false positive.
 */
const PLACEHOLDER = /^(<.*>|[A-Z][A-Z0-9]*(_[A-Z0-9]+)+)$/;

/** Every `<kind>/<id>/server.json` in the repo, parsed as JSONC. */
function serverManifests() {
    const found = [];
    for (const kind of ["plugins", "modules"]) {
        const root = join(REPO, kind);
        if (!existsSync(root)) continue;
        for (const id of readdirSync(root, { withFileTypes: true })) {
            if (!id.isDirectory()) continue;
            const file = join(root, id.name, "server.json");
            if (!existsSync(file)) continue;
            found.push({ id: `${kind}/${id.name}`, file, data: parse(readFileSync(file, "utf8")) });
        }
    }
    return found;
}

/** Secret-ish leaves anywhere in a manifest, as `path -> value` pairs. */
function secretLeaves(node, path = []) {
    if (!node || typeof node !== "object") return [];
    const out = [];
    for (const [key, value] of Object.entries(node)) {
        const here = [...path, key];
        if (value && typeof value === "object") {
            out.push(...secretLeaves(value, here));
        } else if (/(apiKey|token|secret|password)$/i.test(key)) {
            out.push({ path: here.join("."), value });
        }
    }
    return out;
}

test("no shipped server.json carries a placeholder credential @unit", () => {
    const manifests = serverManifests();
    // A zero-manifest run would pass vacuously — that is the failure mode that
    // makes a scanning test worthless, so assert we actually looked at something.
    expect(manifests.length).toBeGreaterThan(0);

    const offenders = [];
    for (const { id, data } of manifests) {
        for (const { path, value } of secretLeaves(data)) {
            if (typeof value === "string" && PLACEHOLDER.test(value.trim())) {
                offenders.push(`${id} -> ${path} = ${JSON.stringify(value)}`);
            }
        }
    }
    expect(offenders).toEqual([]);
});

test("an SSRF guard verdict is never replayed @unit", () => {
    const { SsrfBlockedError, UpstreamRequestError } = require(join(REPO, "server", "node", "ssrf-guard.js"));

    expect(new SsrfBlockedError("blocked").retriable).toBe(false);

    // Explicit boolean survives onto the error, in both directions.
    expect(new UpstreamRequestError("x", { retriable: false }).retriable).toBe(false);
    expect(new UpstreamRequestError("x", { retriable: true }).retriable).toBe(true);
});

test("a transport failure declares no verdict rather than guessing @unit", () => {
    const { UpstreamRequestError } = require(join(REPO, "server", "node", "ssrf-guard.js"));
    // Absent, not `false`: an ECONNREFUSED against a restarting upstream really
    // may succeed on the next attempt, and the client's heuristic handles it.
    expect("retriable" in new UpstreamRequestError("unreachable")).toBe(false);
    // A non-boolean must not become a verdict — the field stays absent.
    expect("retriable" in new UpstreamRequestError("x", { retriable: "false" })).toBe(false);
});
