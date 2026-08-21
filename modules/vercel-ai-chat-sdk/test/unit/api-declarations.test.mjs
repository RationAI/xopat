/**
 * The scripting API interface is stripped from the type blob before it reaches the model,
 * because the prompt already renders every method as `signature — <flattened JSDoc>`.
 *
 * The risk this suite exists for is not "we saved too few tokens" — it is a brace-matching
 * bug silently cutting a type contract in half. The model would read the truncated remains as
 * the whole truth and write code against types that do not exist, so every test here is about
 * what must SURVIVE, not what must go.
 *
 * The source is TypeScript; it is transpiled with the esbuild the repo already depends on
 * (same approach as payload-slimming.test.mjs).
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-api-decls-"));
const outfile = path.join(tmp, "api-declarations.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "vercel-ai-chat-sdk", "shared", "api-declarations.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { stripApiInterfaceDeclaration } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const BLOB = `export type Bounds = { x: number; y: number; width: number; height: number };

export interface ViewerScriptApi extends ScriptApiObject {
    /** Focus the viewer. */
    focusOnImage(x: number, y: number, magnification?: number): Promise<void>;
    /** Nested object literal in a signature — a non-recursive matcher trips here. */
    setOptions(opts: { a: { b: number }, cb: (v: { z: string }) => void }): Promise<void>;
}

export type ViewerPoint = { x: number; y: number };`;

test("the api interface goes, the supporting types stay", { tag: ["@unit"] }, () => {
    const out = stripApiInterfaceDeclaration(BLOB);

    expect(out, "the interface is the part already rendered per method").not.toContain("ViewerScriptApi");
    expect(out, "types before it survive").toContain("export type Bounds");
    expect(out, "and types AFTER it — the ones a naive cut would lose").toContain("export type ViewerPoint");
});

test("nested braces inside the interface do not end the match early", { tag: ["@unit"] }, () => {
    // The failure this guards: stopping at the first `}` would leave the tail of the
    // interface behind and swallow the type that follows it.
    const out = stripApiInterfaceDeclaration(BLOB);

    expect(out).not.toContain("setOptions");
    expect(out).not.toContain("cb: (v: { z: string })");
    expect(out.trim().endsWith("export type ViewerPoint = { x: number; y: number };")).toBe(true);
});

test("a blob with no api interface is returned intact", { tag: ["@unit"] }, () => {
    const types = `export type A = { a: number };\n\nexport type B = { b: string };`;

    expect(stripApiInterfaceDeclaration(types)).toBe(types);
});

test("an unbalanced blob is returned untouched rather than truncated", { tag: ["@unit"] }, () => {
    // Degrade toward a bigger prompt, never toward a half a type contract.
    const broken = `export type Keep = { k: number };

export interface Broken extends ScriptApiObject {
    method(): void;`;

    expect(stripApiInterfaceDeclaration(broken)).toBe(broken);
});

test("empty and absent inputs are handled", { tag: ["@unit"] }, () => {
    expect(stripApiInterfaceDeclaration(undefined)).toBe("");
    expect(stripApiInterfaceDeclaration(null)).toBe("");
    expect(stripApiInterfaceDeclaration("")).toBe("");
});

test("an interface NOT extending ScriptApiObject is kept", { tag: ["@unit"] }, () => {
    // Only the api surface is duplicated by the per-method rendering; an ordinary
    // interface is a supporting type like any other.
    const blob = `export interface PlainShape { a: number }`;

    expect(stripApiInterfaceDeclaration(blob)).toBe(blob);
});

test("it holds against the real viewer API declarations", { tag: ["@unit"] }, () => {
    // A synthetic fixture cannot prove much about a 10 KB hand-written .d.ts.
    const real = readFileSync(
        path.join(fromRoot(), "src", "classes", "scripting", "viewer-api.scripts.d.ts"),
        "utf8"
    );

    const out = stripApiInterfaceDeclaration(real);

    expect(out.length, "the interface is a large share of the file").toBeLessThan(real.length * 0.75);
    expect(out.length, "but the supporting types must not vanish").toBeGreaterThan(500);
    expect(out, "no half-open declaration is left behind").not.toContain("extends ScriptApiObject");
    // Brace parity is the cheap proof that nothing was cut mid-declaration.
    const opens = (out.match(/\{/g) || []).length;
    const closes = (out.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
});
