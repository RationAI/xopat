/// <reference path="../../src/types/globals.d.ts" />

// Order matters: the inference module registers `window.SAMInference` and the
// module singleton; the state then attaches itself to `OSDAnnotations`.
import "./samInference";
import "./samState";
