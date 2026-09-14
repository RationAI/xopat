/**
 * The WAV the capture uploads under the Silero VAD: a 44-byte PCM16 mono header
 * over the concatenated frames, so bytes and samples map exactly and every
 * transcription backend can decode it.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleDir = path.join(fromRoot(), "modules", "speech-to-text");

const tmp = mkdtempSync(path.join(tmpdir(), "xopat-wav-encode-"));
const esbuild = require("esbuild");

const outfile = path.join(tmp, "wavEncode.mjs");
await esbuild.build({
    entryPoints: [path.join(moduleDir, "wavEncode.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { encodeWav16, WAV_SAMPLE_RATE } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ascii = (view, offset, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(offset + i)));

test("three 512-sample frames become 1536 PCM16 samples under a canonical header", { tag: ["@unit"] }, () => {
    const frames = [new Float32Array(512), new Float32Array(512), new Float32Array(512)];
    const buf = encodeWav16(frames);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 1536 * 2);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 1536 * 2);
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);          // PCM
    expect(v.getUint16(22, true)).toBe(1);          // mono
    expect(v.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
    expect(v.getUint32(28, true)).toBe(WAV_SAMPLE_RATE * 2);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(1536 * 2);
});

test("samples are scaled and clamped to the 16-bit range", { tag: ["@unit"] }, () => {
    const buf = encodeWav16([new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])]);
    const v = new DataView(buf);
    const at = (i) => v.getInt16(44 + i * 2, true);
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(Math.floor(0.5 * 0x7FFF));
    expect(at(2)).toBe(-0x4000);
    expect(at(3)).toBe(0x7FFF);
    expect(at(4)).toBe(-0x8000);
    expect(at(5)).toBe(0x7FFF);   // clamped
    expect(at(6)).toBe(-0x8000);  // clamped
});

test("an empty frame list is a valid, silent WAV", { tag: ["@unit"] }, () => {
    const v = new DataView(encodeWav16([]));
    expect(v.byteLength).toBe(44);
    expect(v.getUint32(40, true)).toBe(0);
});
