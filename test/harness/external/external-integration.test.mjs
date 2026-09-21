/**
 * Bridge for integration suites of linked-in elements.
 * See `external-unit.test.mjs` for the rationale.
 *
 * Note the one asymmetry with in-repo elements: `tests.envs` is enforced by the
 * runner's `testIgnore`, which cannot apply to files the runner never saw. A
 * linked-in element that only makes sense in some deployments must therefore
 * tag its tests (`@secure-only`, `@production-only`) instead of relying on
 * `envs`. This is documented in `plugins/README.md`.
 */
import { pathToFileURL } from "node:url";
import { externalTestFiles } from "../discover.mjs";

for (const file of externalTestFiles("integration")) {
    await import(pathToFileURL(file).href);
}
