# Multi-viewport integration guide (Annotations use-case)

This app can run **multiple inner OpenSeadragon viewers (viewports)** at the same time. A correct integration must **never assume `window.VIEWER` is “the viewer”**. Instead, always scope your logic to a specific viewer instance.

This README shows the recommended interfaces + event patterns using the **annotations plugin** as the example, with a **generic annotations API** (no DICOM).

---

## Core primitives you should use

### 1) Viewer-aware singleton access

The reference to the annotations module is not something that has to do with multi-viewports. But we will need it - 
we can either use the global helper, or better, a callback that gets fired when the module is active:

```js

this.integrateWithSingletonModule('annotations', async (module) => {
    //...
});

// OR
const mod = singletonModule("annotations"); // only works if module is available - make a requirement dependency in include.json if you must
```

- `singletonModule(id)` -> global singleton instance
- `singletonModule(id, viewer)` -> viewer-context instance (for viewer-singletons, we need the global annotation reference)

> If a module is implemented as a global singleton, `singletonModule("annotations", viewer)` may still resolve to the same instance. In that case you must pass `viewer` explicitly to viewer-bound APIs (see below).

---

### 2) Broadcasted viewer events

Use `VIEWER_MANAGER.broadcastHandler(...)` for events that happen per viewer (OSD events like `open`):

```js
VIEWER_MANAGER.broadcastHandler("open", (e) => {
  const viewer = e.eventSource; // <-- the viewer that triggered the event
  // do viewer-scoped work here
});
```

Also useful:
- `VIEWER_MANAGER.addHandler("viewer-reset", ...)` for lifecycle cleanup (ViewerManager event)

---

### 3) Viewer-bound APIs in the annotations module

The annotations module should expose a deterministic viewer binding:

```js
const annotations = singletonModule("annotations"); // global module singleton
const fabric = annotations.getFabric(viewer);       // viewer-bound fabric wrapper (deterministic)
```

Avoid relying on `annotations.viewer` (which tracks an “active viewer”) for correctness. Prefer passing the viewer explicitly.
Better yet, keep internal viewer reference that resolves to the correct viewer instance (e.g. you can lock viewer ref update,
when users annotate, to avoid problems), and offer a getter:

```js
const fabric = annotations.fabric;
```
That always resolves to the correct viewer singleton that implements the annotations logics for the desired viewer.

---

## The multi-viewport pitfall

If you write:

```js
const tiledImage = VIEWER.scalebar.getReferencedTiledImage();
```

…you’re reading metadata from the **currently active** global viewer, which can differ from:
- the viewport where the user clicked “Save”, or
- the viewport that just opened a slide

Multi-viewport integrations must always use:
- the **viewer instance from the event** (`e.eventSource`), OR
- an explicit viewer parameter you already have

---

## Recommended integration pattern (Annotations + Generic API)

### Generic API (example)

Assume a minimal REST API:

- `GET  /api/annotations?slideId=...` -> `{ objects: [...] }`
- `POST /api/annotations?slideId=...` with body `{ objects: [...] }`

Where `slideId` comes from the viewer’s opened content metadata.

---

## A) Load annotations when *that viewport* opens content

```js
VIEWER_MANAGER.broadcastHandler("open", async (e) => {
  const viewer = e.eventSource;

  const annotations = singletonModule("annotations");
  const fabric = annotations.getFabric(viewer);

  // 1) Read slide metadata from THIS viewer
  const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();
  if (!tiledImage?.source?.getMetadata) return;

  const meta = tiledImage.source.getMetadata().imageInfo;
  const slideId = meta?.slideId || meta?.seriesUID || meta?.id; // pick your app’s identifier
  if (!slideId) return;

  // 2) Clear this viewport’s canvas before loading
  await fabric.loadObjects({ objects: [] }, true);

  // 3) Fetch and load objects into THIS viewport only
  const res = await fetch(`/api/annotations?slideId=${encodeURIComponent(slideId)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return;

  const imported = await res.json(); // { objects: [...] }

  if (imported?.objects?.length) {
    await fabric.loadObjects(imported, true); // clear=true is safe on slide switch
  }
});
```

**Why this works**
- Runs once per viewport open
- Uses `e.eventSource` so the correct viewer is always targeted
- Uses a viewer-bound fabric wrapper so objects cannot leak across viewports

---

## B) Save annotations for the viewport that triggered the action

### Best practice: pass the viewer explicitly in the save event payload

Note that this part is simplified, if your API supports it, you should store annotations
per element, bidnig to events like ``annotation-created``. Here, we provide a handler
for 'save' action performed by user, which, if not handled and the annotations **plugin** is active,
downloads the annotations as a file. So even if you implemented per-element saving, you still would
likely want to implement this to save annotations on user demand, instead of downloading files.

```js
annotations.raiseEvent("save-annotations", { viewer });
```

Handle it:

```js
module.addHandler("save-annotations", async (e) => {
  const viewer = e.viewer;                 // REQUIRED: viewport to save
  const fabric = module.getFabric(viewer); // viewer-bound wrapper

  const tiledImage = viewer?.scalebar?.getReferencedTiledImage?.();
  if (!tiledImage?.source?.getMetadata) throw new Error("No slide open in this viewport");

  const meta = tiledImage.source.getMetadata().imageInfo;
  const slideId = meta?.slideId || meta?.seriesUID || meta?.id;
  if (!slideId) throw new Error("Missing slideId in metadata");

  // Export objects from this viewport only
  const exported = await fabric.exportObjects(); // { objects: [...] } (example API)
  if (!exported?.objects?.length) return;

  const res = await fetch(`/api/annotations?slideId=${encodeURIComponent(slideId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exported),
  });

  if (!res.ok) throw new Error("Save failed");
  e.setHandled?.("Annotations saved.");
});
```

### Fallback (less reliable): use a tracked “active viewer”

If you cannot pass `viewer` through the event payload, you may fallback to:

```js
const viewer = module.viewer; // fallback only
const fabric = module.getFabric(viewer);
```

This can be wrong if focus/hover changes “active viewer” between click and handler execution.

---

## Minimal interface contract for multi-viewport-safe modules

A module that supports multi-viewports effectively should provide:

1) Deterministic viewer binding
```js
module.getFabric(viewer)
```

2) Viewer-aware events
```js
module.addHandler("save-annotations", (e) => {
  // expects e.viewer (preferred) OR otherwise uses explicit viewer binding
});
```

3) Hooks bound to viewer lifecycle
```js
VIEWER_MANAGER.broadcastHandler("open", (e) => loadFor(e.eventSource));
VIEWER_MANAGER.addHandler("viewer-reset", (e) => cleanupFor(e.viewer));
```

---

## Checklist

- [ ] Never read slide metadata from global `VIEWER` in multi-viewport flows
- [ ] Always get the viewer from the event (`e.eventSource`) or pass it explicitly
- [ ] Load annotations on `VIEWER_MANAGER.broadcastHandler("open", ...)` per viewport
- [ ] Save annotations with `module.getFabric(viewer)` (viewer-scoped export)
- [ ] Clear per viewport before loading: `loadObjects(imported, true)`
