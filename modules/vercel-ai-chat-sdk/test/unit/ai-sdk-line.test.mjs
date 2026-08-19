/**
 * Every `@ai-sdk/*` provider package must come from the same AI SDK release line
 * as core `ai`.
 *
 * Vercel bumps the provider SPECIFICATION with each core major, and each provider
 * package targets exactly one line. Mixing them installs cleanly — there is no peer
 * dependency to violate — and then fails at turn time with the SDK's own opaque
 * error, whose wording names the wrong major:
 *
 *   Unsupported model version v4 for provider "anthropic.messages" and model
 *   "claude-opus-5". AI SDK 5 only supports models that implement specification
 *   version "v2".
 *
 * That is exactly how `chat-anthropic` + `chat-openai` broke: both were bumped to
 * `@ai-sdk/*@4` (the `ai@7` line) while the chat module still depended on `ai@6`.
 * Each element carries its own `package.json` under npm workspaces, so a single
 * `npm i @ai-sdk/<x>@latest` inside one plugin is all it takes to drift.
 *
 * `assertLanguageModelCompatible()` (server/chatRegistry.server.ts) catches this at
 * runtime; this test catches it before the merge. Static only — reads manifests, no
 * network, no browser.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

/** The package that defines the specification both sides must agree on. */
const SPEC_PACKAGE = "@ai-sdk/provider";
/** Not providers — they ARE the spec / its utilities, and are checked directly. */
const NOT_PROVIDERS = new Set([SPEC_PACKAGE, "@ai-sdk/provider-utils"]);

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

/** Leading integer of a semver range (`^4.0.7`, `4.0.7`, `>=4 <5` → 4). */
function majorOf(range) {
    const match = /(\d+)/.exec(String(range || ""));
    return match ? Number(match[1]) : null;
}

/** Every dependency an element declares, whatever section it sits in. */
function declaredDependencies(manifest) {
    return { ...(manifest?.dependencies || {}), ...(manifest?.devDependencies || {}) };
}

/**
 * `@ai-sdk/*` packages declared by any plugin/module, plus who declared them —
 * the "who" is what makes a failure actionable.
 */
function collectDeclaredAiSdkPackages() {
    const found = new Map();                        // package name → declaring element paths
    for (const kind of ["modules", "plugins"]) {
        const root = fromRoot(kind);
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const manifest = readJson(path.join(root, entry.name, "package.json"));
            if (!manifest) continue;
            for (const name of Object.keys(declaredDependencies(manifest))) {
                if (!name.startsWith("@ai-sdk/")) continue;
                const declaredBy = found.get(name) || [];
                declaredBy.push(`${kind}/${entry.name}`);
                found.set(name, declaredBy);
            }
        }
    }
    return found;
}

function installedManifest(packageName) {
    return readJson(fromRoot("node_modules", ...packageName.split("/"), "package.json"));
}

test("every @ai-sdk provider package matches core `ai`'s specification major @unit", () => {
    const core = installedManifest("ai");
    test.skip(!core, "needs an installed dependency tree: run `npm install` first");

    const coreSpecMajor = majorOf(core.dependencies?.[SPEC_PACKAGE]);
    expect(coreSpecMajor, `ai@${core.version} declares no ${SPEC_PACKAGE} dependency`).not.toBeNull();

    const declared = collectDeclaredAiSdkPackages();
    expect(declared.size, "no element declares an @ai-sdk/* package — has the chat stack moved?")
        .toBeGreaterThan(0);

    const mismatches = [];
    for (const [name, declaredBy] of declared) {
        const installed = installedManifest(name);
        if (!installed) continue;                   // not installed here; nothing to compare

        // The spec package itself is compared directly; a provider is compared through
        // the spec major it was built against.
        const specMajor = NOT_PROVIDERS.has(name)
            ? majorOf(installed.version)
            : majorOf(installed.dependencies?.[SPEC_PACKAGE]);
        if (specMajor === null || specMajor === coreSpecMajor) continue;

        mismatches.push(
            `${name}@${installed.version} (declared by ${declaredBy.join(", ")}) targets `
            + `${SPEC_PACKAGE}@${specMajor}, core ai@${core.version} targets `
            + `${SPEC_PACKAGE}@${coreSpecMajor}`,
        );
    }

    expect(
        mismatches,
        "AI SDK release lines have drifted apart. Vercel publishes one dist-tag per line — "
        + "`npm view <package> dist-tags` shows which major belongs with which core major "
        + "(ai-v6 / ai-v7). See modules/vercel-ai-chat-sdk/README.md → 'AI SDK version line'.\n"
        + mismatches.join("\n"),
    ).toEqual([]);
});
