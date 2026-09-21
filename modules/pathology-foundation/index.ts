/// <reference path="../../src/types/globals.d.ts" />

// Order matters: the broker registers `window.PathologyFoundation` and the
// module singleton; the scripting layer then exposes the `pathology` namespace
// (which resolves the module lazily via singletonModule at call time).
import "./pathologyFoundation";
import { registerPathologyScriptingApi } from "./scripting/api";

// Expose the `pathology` scripting namespace. Enables LLM integration via the
// vercel-ai-chat-sdk module and every other chat provider + the scripting console.
registerPathologyScriptingApi();
