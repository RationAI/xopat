/**
 * Bridge for unit suites of elements that are linked into the tree.
 *
 * See `externalTestFiles` in `../discover.mjs` for why this exists: the file
 * scan does not walk through a symlink/junction, so an element developed in its
 * own repository needs its test files pulled in explicitly. Importing a file
 * that calls `test(...)` registers those tests exactly as if the runner had
 * found it — the only cost is that the report attributes them to this bridge
 * rather than to the element's own path.
 *
 * Empty and inert when no external element is linked in.
 */
import { pathToFileURL } from "node:url";
import { externalTestFiles } from "../discover.mjs";

for (const file of externalTestFiles("unit")) {
    await import(pathToFileURL(file).href);
}
