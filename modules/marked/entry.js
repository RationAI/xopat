import * as namespace from "marked";
const actualModule = (namespace.default !== undefined && Object.keys(namespace).length === 1)
    ? namespace.default : (namespace.default || namespace);
globalThis.__temp_bundle_export = actualModule;
