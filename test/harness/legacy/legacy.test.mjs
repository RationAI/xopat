/**
 * Bridges every not-yet-ported test script into the runner.
 *
 * One runner test per legacy script. The script's own assertions are replayed
 * as soft expectations, so a script with five failures reports five named
 * failures rather than one opaque "exit code 1" — and the full output is
 * attached either way.
 *
 * This file is temporary by construction: it shrinks as `manifest.mjs` shrinks.
 */
import { test, expect } from "@playwright/test";
import { LEGACY_SCRIPTS } from "./manifest.mjs";
import { runLegacyScript } from "./adapter.mjs";

for (const entry of LEGACY_SCRIPTS) {
    test(`legacy: ${entry.name}`, { tag: entry.tags ?? [] }, async ({}, testInfo) => {
        testInfo.setTimeout((entry.timeout ?? 120_000) + 30_000);

        const result = await runLegacyScript(entry, { timeout: entry.timeout });

        await testInfo.attach(`${entry.name} output`, {
            body: result.output || "(no output)",
            contentType: "text/plain",
        });
        testInfo.annotations.push({
            type: "assertions",
            description: `${result.passed} passed, ${result.failed} failed`
                + (result.declared !== null ? ` (script declared ${result.declared})` : "")
                + ` · ${result.dialect} dialect · ${result.durationMs}ms`,
        });

        expect(result.timedOut, `${entry.file} exceeded its ${entry.timeout ?? 120_000}ms budget`).toBe(false);

        for (const assertion of result.assertions) {
            if (assertion.ok) continue;
            expect.soft(
                assertion.ok,
                `${entry.name} › ${assertion.name}${assertion.detail ? `\n  ${assertion.detail}` : ""}`,
            ).toBe(true);
        }

        // A script can also die before printing anything it planned to print —
        // a throw during setup, a missing import, an unhandled rejection. The
        // exit code is the backstop that catches exactly that case.
        expect(
            result.exitCode,
            `${entry.file} exited ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ""}`,
        ).toBe(0);

        // Nothing recognisable in the output means the parser has drifted from
        // the script — fail loudly rather than report a green zero-assertion run.
        expect(
            result.dialect !== "none" || result.declared !== null,
            `no assertions parsed from ${entry.file}; its output format may have changed`,
        ).toBe(true);
    });
}
