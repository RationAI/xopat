import * as pkg from "marked";
const root = (globalThis.npm = globalThis.npm || {});
root.modules = root.modules || {};
root.modules["marked"] = pkg;