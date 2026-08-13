/**
 * Bridge for e2e suites of linked-in elements.
 * See `external-unit.test.mjs` and `external-integration.test.mjs`.
 */
import { pathToFileURL } from "node:url";
import { externalTestFiles } from "../discover.mjs";

for (const file of externalTestFiles("e2e")) {
    await import(pathToFileURL(file).href);
}
