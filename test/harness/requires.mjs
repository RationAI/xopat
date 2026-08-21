/**
 * Declarative capability gates.
 *
 * A test that needs something the environment may not have should say so and
 * **skip with a reason**, not fail. The pre-runner suite's failure mode for a
 * missing slide service was a 30-second "Waiting for the viewer" timeout whose
 * cause `test/README.md` had to explain in prose — a skip that names the missing
 * variable is strictly better information for the same zero effort.
 */
import { test } from "@playwright/test";

/**
 * Real slide data, as opposed to the generated synthetic pyramid.
 *
 * Set `XOPAT_TEST_WSI` to the base URL of a slide service and the slide ids in
 * `XOPAT_TEST_SLIDES` (comma-separated) to enable these.
 *
 * @returns {{baseUrl: string, slides: string[]}} valid only when not skipped
 */
export function requireSlides() {
    const baseUrl = process.env.XOPAT_TEST_WSI;
    const slides = (process.env.XOPAT_TEST_SLIDES || "").split(",").map(s => s.trim()).filter(Boolean);
    test.skip(
        !baseUrl || slides.length === 0,
        "needs real slide data: set XOPAT_TEST_WSI and XOPAT_TEST_SLIDES (the synthetic pyramid covers most rendering tests)",
    );
    return { baseUrl, slides };
}

/** A capability the deployment under test may not expose. */
export function requireEnvVar(name, why) {
    test.skip(!process.env[name], `needs ${name}: ${why}`);
    return process.env[name];
}
