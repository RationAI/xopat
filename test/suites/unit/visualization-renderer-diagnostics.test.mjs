/**
 * flex-renderer degrades bad configuration on its own. A production session (3.1.0)
 * rendered every colormap layer grayscale because a heatmap-era cache value was
 * rejected, and the user saw no sign of it — the warning went to the console only.
 * The library now reports fallbacks through `UIControls.setReporter`; these vectors
 * pin that they reach the user as ONE toast per burst, that a rejected saved value
 * (which renders the configured default) does not, and that the paths the library
 * still only logs to the console are caught too.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? {};
globalThis.$.t = (key, vars) => `${key}:${vars?.count ?? ""}`;

const { ClientLogging } = await import("../../../src/classes/app/logging.ts");
const { ViewerVisualizationRuntime } = await import("../../../src/classes/app/viewer-visualization-runtime.ts");

function setup() {
    const shown = [];
    globalThis.Dialogs = { MSG_WARN: "warn", show: (text, ms, level) => shown.push({ text, level }) };
    const logging = new ClientLogging({ level: "warn" });
    const runtime = new ViewerVisualizationRuntime({ logging, log: (channel) => logging.log(channel) });
    runtime.watchRendererDiagnostics(10);
    // What adoptConsole emits for a console.warn / console.error call.
    const consoleRecord = (level, message) => logging._emit("console", level, false, [message], false);
    return { shown, runtime, logging, consoleRecord };
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test("reported fallbacks surface as one aggregated toast and are logged @unit", async () => {
    const { shown, runtime, logging } = setup();
    runtime.reportRendererDiagnostic("warn", "palette-invalid",
        { layerId: "layer_shader_0", control: "color", message: "palette has unsupported shape", value: "#2962ff" });
    runtime.reportRendererDiagnostic("error", "layer-assembly-failed",
        { layerId: "layer_shader_2", message: "Failed to assemble shader", error: new Error("boom") });
    runtime.reportRendererDiagnostic("warn", "control-init-failed", { layerId: "l", control: "x", message: "init failed" });
    await wait(40);

    expect(shown.length).toBe(1);
    expect(shown[0].text).toBe("error.visualizationRendererWarnings:3");
    expect(shown[0].level).toBe("warn");

    const logged = logging.getEntries({ channel: "flex-renderer" });
    expect(logged.map(r => r.fields?.code)).toEqual(["palette-invalid", "layer-assembly-failed", "control-init-failed"]);
    expect(logged[0].fields.layerId).toBe("layer_shader_0");
});

test("a rejected saved value is logged but does not toast @unit", async () => {
    const { shown, runtime, logging } = setup();
    runtime.reportRendererDiagnostic("warn", "cache-value-rejected",
        { layerId: "layer_shader_0", control: "color", message: "saved value does not fit", value: "#2962ff" });
    await wait(40);
    expect(shown.length).toBe(0);
    expect(logging.getEntries({ channel: "flex-renderer" }).length).toBe(1);
});

test("console-only renderer failures toast, unrelated console output does not @unit", async () => {
    const { shown, consoleRecord } = setup();
    consoleRecord("error", "Failed to construct shader 'layer_0' (colormap).");
    consoleRecord("warn", "Invalid channel 'use_channel0'. Will use channel 'r'.");
    consoleRecord("warn", "[Violation] Permissions policy violation: unload is not allowed in this document.");
    consoleRecord("warn", "LGraphAudio: something");
    await wait(40);
    expect(shown.length).toBe(1);
    expect(shown[0].text).toBe("error.visualizationRendererWarnings:2");
});
