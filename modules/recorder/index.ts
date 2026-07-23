/// <reference path="../../src/types/globals.d.ts" />
// Order matters: the module registers OpenSeadragon.Recorder and the singleton;
// the scripting layer then exposes the `recorder` namespace (which resolves the
// module lazily via singletonModule at call time).
import "./recorder-module";
import { registerRecorderScriptingApi } from "./scripting/api";

// Expose the `recorder` scripting namespace. Enables LLM integration via the
// vercel-ai-chat-sdk module and every other chat provider + the scripting console.
registerRecorderScriptingApi();
