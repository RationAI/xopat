/// <reference path="../../src/types/globals.d.ts" />
// Order matters: the module registers the `mlflow` sink with the IO pipeline;
// the scripting layer then exposes the `mlflowSink` namespace (which resolves
// the module lazily via singletonModule at call time).
import "./mlflow-sink";
import { registerMlflowSinkScriptingApi } from "./scripting/api";

// Expose the `mlflowSink` scripting namespace, so the record→MLflow structure
// is reachable from the scripting console and every chat/LLM integration.
registerMlflowSinkScriptingApi();
