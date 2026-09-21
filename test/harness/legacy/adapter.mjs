/**
 * Runs a legacy test script unmodified and turns its output into assertions.
 *
 * See `manifest.mjs` for what "legacy" means here and `tap.mjs` for the output
 * dialects. This module deliberately knows nothing about the runner so it can
 * be unit-tested on its own.
 */
import { spawn } from "node:child_process";
import { repoRoot, fromRoot } from "../paths.mjs";
import { captureOutput, killTree } from "../proc.mjs";
import { parseLegacyOutput } from "./tap.mjs";

/**
 * @param {import("./manifest.mjs").LegacyEntry} entry
 * @param {{signal?: AbortSignal, timeout?: number}} [opts]
 * @returns {Promise<{exitCode: number|null, signal: string|null, output: string,
 *                    timedOut: boolean, durationMs: number} & import("./tap.mjs").ParsedOutput>}
 */
export async function runLegacyScript(entry, opts = {}) {
    const timeout = opts.timeout ?? entry.timeout ?? 120_000;
    const started = Date.now();

    const child = spawn(process.execPath, [fromRoot(entry.file)], {
        cwd: repoRoot,
        env: { ...process.env, ...entry.env },
        stdio: ["ignore", "pipe", "pipe"],
        // Own process group on POSIX so killTree can take the whole tree down.
        detached: process.platform !== "win32",
    });
    const captured = captureOutput(child);

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void killTree(child); }, timeout);
    const onAbort = () => { void killTree(child); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    /** @type {{code: number|null, signal: string|null}} */
    const exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
    }).finally(() => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
    });

    const parsed = parseLegacyOutput(captured.text);
    return {
        ...parsed,
        exitCode: exit.code,
        signal: exit.signal,
        timedOut,
        durationMs: Date.now() - started,
        output: captured.truncated ? `…output truncated…\n${captured.text}` : captured.text,
    };
}
