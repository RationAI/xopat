# Scripting Support for xOpat

This document explains how to write custom script namespaces for the scripting system, with the current **context-contained worker model**.

The most important rule is:

**A script namespace must behave as if each script runs in its own isolated context.  
Do not resolve viewer state, selection state, or per-script state from global mutable UI state.  
Always resolve it from the calling scripting context.**

---

## Mental model

A custom script namespace is host-side code that becomes callable from a script worker.

For example, if you register a namespace called `measurements`, a script can call:

``````ts
const size = measurements.getImageSize();
``````

That host-side namespace should:

- expose a stable, script-safe API
- return plain serializable data
- use the current `ScriptingContext` to resolve which viewer/session it should act on
- avoid leaking global UI state across scripts

---

## Two ways to add a namespace

You can add a namespace in two ways.

### 1. Preferred: class-based namespace with `ingestApi(...)`

Use this when you want:

- generated docs/metadata
- TypeScript declarations for scripts
- a clean, documented public API
- underscore-prefixed private helpers

This is the best choice for most real namespaces.

### 2. Lightweight: `registerNamespace(...)`

Use this when you want:

- a very small helper namespace
- no full class
- quick host utilities

If the namespace should receive the calling script context, register it with:

``````ts
{ contextAware: true }
``````

---

## Recommended structure

A good namespace usually has:

- one public class extending `XOpatScriptingApi`
- one `.scripts.d.ts` file describing the script-visible API
- private helper methods prefixed with `_`
- public methods that return plain data and accept plain inputs
- no direct dependence on "who is globally active right now"

---

## Existing API:
Use the provided base class to implement your scripting and rely on existing functionality.
````ts
class MyScriptingApi extends XOpatScriptingApi {
    // Use this method to get the current scripting context for generic context differentiation.
    protected get scriptingContext(): HostScriptContext;

    // Access the active viewer. The active viewer has been already set for you by someone. Treat it as VIEWER instance on the host.
    protected get activeViewer(): OpenSeadragon.Viewer;
}
````

## Example: class-based namespace
The following examples might re-implement stuff that is already available in the base scripting API abstract class.
Prefer re-using existing functionality whenever possible.

### 1. Script-visible types

Create a file like `measurements-api.scripts.d.ts`.

``````ts
import type { ScriptApiObject } from "../scripting-manager";

export type ImageSize = {
    width: number;
    height: number;
    viewerContextId: string;
};

export interface MeasurementsScriptApi extends ScriptApiObject {
    /**
    * Returns the size of the active image in the current script context.
    */
    getImageSize(): ImageSize;

    /**
     * Returns the viewer context id currently bound to this script context.
     */
    getBoundViewerId(): string;
}
``````

### 2. Host implementation

Create a namespace class.

``````ts
import type { ScriptApiMetadata } from "./abstract-types";
import type { MeasurementsScriptApi, ImageSize } from "./measurements-api.scripts";

import { XOpatScriptingApi } from "./abstract-api";

export class XOpatMeasurementsScriptApi
    extends XOpatScriptingApi
    implements MeasurementsScriptApi
{
    static ScriptApiMetadata: ScriptApiMetadata<XOpatMeasurementsScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => {
                const res = await fetch(
                    APPLICATION_CONTEXT.url + "plugins/my-plugin/measurements-api.scripts.d.ts"
                );

                if (!res.ok) {
                    throw new Error("Failed to load measurements-api.scripts.d.ts");
                }

                return await res.text();
            }
        }
    };

    constructor(namespace = "measurements") {
        super(
            namespace,
            "Measurements",
            "Context-bound measurement helpers for scripts."
        );
    }

    protected _getBoundViewerId(): string {
        return (
            this.scriptingContext.getActiveViewerContextId?.() ||
            this.scriptingContext.activeViewerContextId ||
            this.scriptingContext.id
        );
    }

    protected _getViewer(): OpenSeadragon.Viewer {
        const viewerId = this._getBoundViewerId();
        const viewers = VIEWER_MANAGER?.viewers || [];

        const viewer = viewers.find(v => v.uniqueId === viewerId);
        if (!viewer) {
            throw new Error(
                "No viewer is available for the current script context."
            );
        }

        return viewer;
    }

    getBoundViewerId(): string {
        return this._getBoundViewerId();
    }

    getImageSize(): ImageSize {
        const viewer = this._getViewer();
        const item = viewer.world?.getItemAt?.(0);
        const contentSize = item?.getContentSize?.();

        return {
            width: contentSize?.x ?? 0,
            height: contentSize?.y ?? 0,
            viewerContextId: this._getBoundViewerId()
        };
    }
}
``````

### 3. Register it

Register before workers are created.

``````ts
ScriptingManager.registerExternalApi(
async manager => {
await manager.ingestApi(new XOpatMeasurementsScriptApi("measurements"));
},
{ label: "measurements" }
);
``````

### 4. Use it in a script

``````ts
const contexts = application.getGlobalInfo();
application.setActiveViewer(contexts[0].contextId);

const info = measurements.getImageSize();
console.log(info.viewerContextId, info.width, info.height);
``````

---

## Example: lightweight namespace with `registerNamespace(...)`

This is fine for small utilities.

Use `contextAware: true` when the implementation must know which script context is calling.

``````ts
manager.registerNamespace(
    "runtime",
    {
        getContextInfo: true,
        echo: true
    },
    {
        namespace: "runtime",
        name: "Runtime",
        description: "Small runtime helpers.",

        getContextInfo(context) {
            return {
                id: context.id,
                label: context.label,
                activeViewerContextId:
                    context.getActiveViewerContextId?.() ??
                    context.activeViewerContextId ??
                    null
            };
        },

        echo(context, value) {
            return {
                contextId: context.id,
                value
            };
        }
    } as any,
    { contextAware: true }
);
``````

Script usage:

``````ts
const runtimeInfo = runtime.getContextInfo();
console.log(runtimeInfo.id, runtimeInfo.activeViewerContextId);
``````

---

## What to do

### Do: resolve everything from the calling context

Good:

``````ts
protected _getViewer(): OpenSeadragon.Viewer {
    const viewerId =
        this.scriptingContext.getActiveViewerContextId?.() ||
        this.scriptingContext.activeViewerContextId ||
        this.scriptingContext.id;

    const viewer = (VIEWER_MANAGER?.viewers || []).find(v => v.uniqueId === viewerId);

    if (!viewer) {
        throw new Error("Viewer for this script context was not found.");
    }

    return viewer;
}
``````

Why this is good:

- one script cannot silently hijack another script's viewer
- the namespace behaves deterministically for its context
- worker reuse stays safe because context is explicit

---

### Do: keep public API methods small and boring

Good:

``````ts
getViewportCenter() {
    const viewer = this._getViewer();
    const center = viewer.viewport.getCenter();

    return {
        x: center.x,
        y: center.y
    };
}
``````

Why this is good:

- inputs and outputs are plain values
- behavior is easy to test
- worker message passing stays simple

---

### Do: hide helper methods with `_`

Good:

``````ts
protected _getViewer() { ... }
protected _normalizePlane(plane) { ... }

getMetadata() { ... }
focusOn(x, y, zoom) { ... }
``````

Use `_` for helper methods that should not be exposed to scripts.

A good rule is:

- public method = part of script API
- `_privateHelper` = implementation detail

---

### Do: provide `.scripts.d.ts` when the namespace is real

Good:

``````ts
static ScriptApiMetadata = {
    dtypesSource: {
        kind: "resolve",
        value: async () => {
            const res = await fetch("/plugins/my-plugin/my-api.scripts.d.ts");
            return await res.text();
        }
    }
};
``````

Why this is good:

- scripts get discoverable method signatures
- generated docs stay consistent
- namespace usage is easier for users

---

### Do: register namespaces early

Good:

``````ts
ScriptingManager.registerExternalApi(async manager => {
    await manager.ingestApi(new XOpatMeasurementsScriptApi("measurements"));
});
``````

Register during app/plugin startup, before scripts start creating workers.

Why this matters:

- existing workers may not see namespaces added later
- startup registration keeps all workers consistent

---

### Do: return serializable data

Good:

``````ts
return {
    width: 1024,
    height: 768,
    channels: ["DNA", "RNA"]
};
``````

Prefer:

- numbers
- strings
- booleans
- arrays
- plain objects
- `null`

Avoid returning host objects directly.

---

## What not to do

### Do not: read or write global mutable viewer selection

Bad:

``````ts
getImageSize() {
    const viewer = VIEWER_MANAGER.activeViewer;
    const item = viewer.world.getItemAt(0);
    const size = item.getContentSize();

    return { width: size.x, height: size.y };
}
``````

Why this is bad:

- it depends on whatever the UI currently considers "active"
- another script or UI action can change the result
- it breaks context containment

Better:

``````ts
getImageSize() {
    const viewer = this._getViewer();
    const item = viewer.world.getItemAt(0);
    const size = item?.getContentSize?.();

    return { width: size?.x ?? 0, height: size?.y ?? 0 };
}
``````

---

### Do not: store per-script selection in global singleton state

Bad:

``````ts
class XOpatMyApi extends XOpatScriptingApi {
    private static currentViewerId: string | null = null;

    selectViewer(id: string) {
        XOpatMyApi.currentViewerId = id;
    }

    getSomething() {
        const viewer = VIEWER_MANAGER.viewers.find(
            v => v.uniqueId === XOpatMyApi.currentViewerId
        );
    ...
    }
}
``````

Why this is bad:

- all scripts share the same static field
- one script can overwrite another script's selection
- behavior becomes order-dependent

Better:

``````ts
selectViewer(id: string) {
    this.scriptingContext.setActiveViewerContextId(id);
}
``````

---

### Do not: expose host internals as script API by accident

Bad:

``````ts
class XOpatFooApi extends XOpatScriptingApi {
    getData() { ... }
    cleanupInternalState() { ... }
    rebuildCaches() { ... }
}
``````

If those methods are public and not underscore-prefixed, they are likely to become script-visible.

Better:

``````ts
class XOpatFooApi extends XOpatScriptingApi {
    getData() { ... }

    protected _cleanupInternalState() { ... }
    protected _rebuildCaches() { ... }
}
``````

---

### Do not: return DOM nodes, viewers, tiled images, or other host objects

Bad:

``````ts
getViewer() {
    return this._getViewer();
}
``````

Why this is bad:

- worker boundaries are for data, not live host instances
- scripts should not manipulate host internals directly
- these values are not good script API contracts

Better:

``````ts
getViewerInfo() {
    const viewer = this._getViewer();
    const center = viewer.viewport.getCenter();

    return {
        id: this._getBoundViewerId(),
        x: center.x,
        y: center.y,
        zoom: viewer.viewport.getZoom()
    };
}
``````

---

### Do not: make methods depend on hidden ambient state

Bad:

``````ts
runMeasurement() {
    if (!window.__myPluginLastMousePoint) {
        throw new Error("No mouse point.");
    }

    return doMeasure(window.__myPluginLastMousePoint);
}
``````

Why this is bad:

- hidden dependencies are hard to reason about
- testability is poor
- scripts become flaky and UI-order-dependent

Better:

``````ts
runMeasurement(x: number, y: number) {
    return doMeasure({ x, y });
}
``````

---

## Good pattern: context-bound selection

If your namespace needs a selected viewer, follow this pattern.

``````ts
class XOpatMyApi extends XOpatScriptingApi {
    protected _getViewerId(): string {
        return (
            this.scriptingContext.getActiveViewerContextId?.() ||
            this.scriptingContext.activeViewerContextId ||
            this.scriptingContext.id
        );
    }

    protected _getViewer(): OpenSeadragon.Viewer {
        const viewerId = this._getViewerId();
        const viewer = (VIEWER_MANAGER?.viewers || []).find(v => v.uniqueId === viewerId);

        if (!viewer) {
            throw new Error(`Viewer '${viewerId}' is not available.`);
        }

        return viewer;
    }
}
``````

This is the right pattern because the script context becomes the source of truth.
In fact, do not implement this specific logics since it is already done for you.
But it is a nice example.

---

## Good pattern: application namespace chooses, feature namespace uses

Let one namespace choose the context-local target, and let the rest of the namespaces read that same local selection.

Script:

``````ts
const contexts = application.getGlobalInfo();

const target = contexts.find(c => c.imageName.includes("slide-01"));
if (!target) {
    throw new Error("Target slide not found.");
}

application.setActiveViewer(target.contextId);

const viewport = viewer.getViewport();
const size = measurements.getImageSize();

console.log(viewport, size);
``````

Why this is good:

- the script chooses explicitly
- later calls reuse the same script-local binding
- the worker stays self-contained

---

## Choosing between `ingestApi(...)` and `registerNamespace(...)`

Use `ingestApi(...)` when:

- this is a real namespace
- you want docs and types
- you want a class with private helpers
- you want maintainable code

Use `registerNamespace(...)` when:

- the namespace is tiny
- it is purely utility-like
- you do not need a full class
- you still want context passed in via `contextAware: true`

Default recommendation:

- real feature namespace -> `ingestApi(...)`
- tiny helper namespace -> `registerNamespace(...)`

---

## Suggested file layout

``````text
plugins/my-plugin/
measurements-api.ts
measurements-api.scripts.d.ts
index.ts
``````

Example `index.ts`:

``````ts
import { ScriptingManager } from ".../scripting-manager";
import { XOpatMeasurementsScriptApi } from "./measurements-api";

ScriptingManager.registerExternalApi(
    async manager => {
        await manager.ingestApi(new XOpatMeasurementsScriptApi("measurements"));
    },
    { label: "measurements" }
);
``````

---

## Checklist

Before shipping a namespace, check:

- [ ] Every public method is intended to be script-visible
- [ ] Helper methods are prefixed with `_` or made non-public
- [ ] Viewer/session resolution comes from `scriptingContext`
- [ ] No per-script state is stored in globals or statics
- [ ] Inputs and outputs are plain serializable values
- [ ] A `.scripts.d.ts` file exists for real namespaces
- [ ] The namespace is registered before workers are started
- [ ] Error messages explain what the script should do next

---

## Minimal template

``````ts
import type { ScriptApiMetadata } from "./abstract-types";
import type { MyNamespaceScriptApi } from "./my-namespace-api.scripts";
import { XOpatScriptingApi } from "./abstract-api";

export class XOpatMyNamespaceScriptApi
    extends XOpatScriptingApi
    implements MyNamespaceScriptApi
{
    static ScriptApiMetadata: ScriptApiMetadata<XOpatMyNamespaceScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => {
                const res = await fetch("/plugins/my-plugin/my-namespace-api.scripts.d.ts");
                if (!res.ok) throw new Error("Failed to load type definitions.");
                return await res.text();
            }
        }
    };

    constructor(namespace = "myNamespace") {
        super(namespace, "My Namespace", "Describe what this namespace does.");
    }

    protected _getViewerId(): string {
        return (
            this.scriptingContext.getActiveViewerContextId?.() ||
            this.scriptingContext.activeViewerContextId ||
            this.scriptingContext.id
        );
    }

    myMethod(value: number) {
        return {
            contextId: this.scriptingContext.id,
            viewerContextId: this._getViewerId(),
            value
        };
    }
    
    myOtherMethod(value: string) {
        const viewer = this.activeViewer;
        // do something with viewer
        return value;
    }
}
``````

---

## Final rule

If you are unsure whether some state belongs in:

- a global singleton
- a static class field
- `VIEWER_MANAGER.activeViewer`
- some plugin-wide mutable variable

then it probably does **not** belong there for script execution.

Put per-script selection and per-script execution state in the **calling scripting context**, and make every namespace read from that context.
