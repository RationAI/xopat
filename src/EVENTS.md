# xOpat - Event System

Events are in the UI system the most powerful feature: they allow reacting to events
happening all over the place without tight dependencies. Note however,
that using events without consideration might lead to unpredictable behaviour,
like explosion of events or looped calling.

## Handler fault isolation

Handlers registered on a viewer or on `VIEWER_MANAGER` run isolated: an exception thrown by one of
them is caught, logged, and reported as an `error-user` event with code `E_HANDLER_FAULT` instead of
propagating. A handler that throws on three consecutive invocations is **unregistered** and reported
once more with `E_HANDLER_REMOVED`.

This exists because OpenSeadragon dispatches handlers without any try/catch, and re-arms its
`requestAnimationFrame` loop only *after* the frame's handlers returned. Before isolation, one
throwing handler on an event raised during the update cycle (`animation`, `animation-finish`,
`update-viewport`, ...) permanently stopped canvas rendering — a broken plugin took down the core
viewer. The isolation is installed per instance (`src/classes/app/event-isolation.ts`); the vendored
library is not patched.

Two consequences to keep in mind:
- **Abort signals still work.** `async` handlers are untouched (their rejection still flows through
  `raiseEventAwaiting`), and a *synchronous* throw on `before-app-init`, `before-refresh`, or
  `before-open` is deliberately re-thrown, so the documented "throw to abort" contract holds.
- **Isolation only covers handlers.** An exception thrown from OSD internals or a drawer outside a
  handler can still abort the update cycle before the loop is rescheduled. The complete fix is
  upstream (a `try/finally` around `updateOnce` in `updateMulti`, plus per-handler `try/catch` in
  `EventSource.getHandler`) and cannot live in `src/libs/`.

## Core Events

Events are of two basic types:
 - global events, which are invoked on the `VIEWER_MANAGER` instance, such events 
   - if you need to listen for all events on all viewers within the system, use `VIEWER_MANAGER.broadcastHandler(...)`.
 - viewer-local events, which are invoked on the target viewer they belong to, usually
OpenSeadragon events, or events extended by us.
   >NOTE! Registering events on `VIEWER` instance is not recommended. This variable always
    points to the current active (e.g. focused) viewer instance. This means you will register
    the handler to some random viewer that was just active, and might not be the viewer you wanted
    to react on.


   
## Events in modules
Modules (and possibly plugins) can have their own event system - in that case, the `EVENTS.md` description
should be provided. These events should be invoked on the parent instance of the 'module'.

### DO's
 - handle all events that might affect the behaviour of your code, especially
   - when the underlying image changes
   - then the visualization changes
   - in case of error events that are related to features you use
 - rely on events to communicate between plugins and modules
 - **do not** use UI notifications but events **in modules**
 - prefer events over UI notifications in **plugins**, unless the only purpose is to tell the user something
 - try out custom annotations objects before implementing custom inputs
   - object factory can help you with selection, brushing and many other powerful features related to user input
   over canvas
   - example: user drags a rectangle to select area: you can react on the annotation creation event by
   removing the annotation and getting the coordinates of the selected area
 - thoroughly test any user interaction with annotations plugin, rely on events

### Event API extension

# Event List
Events have their name (for which you register) and when invoked, a parameter is passed
to the handler function that might contain a lot of useful data.
## Global Events ``VIEWER_MANAGER``
#### async `before-app-init` | e: {data: [string], background: [BackgroundItem], visualizations: [VisualizationItem], fromLocalStorage: boolean}
Fired before the first open of the viewer happens. Apps can perform
custom functionality just before the viewer gets initialized.
``fromLocalStorage`` is true when the data was loaded from the user browser cache, but the viewer
was not opened with a session spec. You can use this flag to monitor whether the viewer
was properly opened, or just shows cached session and possibly replace it with more relevant one.
Note that exception thrown in this event is considered as a signal for aborting the viewer loading.

#### async `before-refresh` | e: {data: [string], background: [BackgroundItem], visualizations: [VisualizationItem], bgSpec: [number|number[]|undefined|null], vizSpec: [number|number[]|undefined|null], changeKind: ["noop"|"content"|"visualization"], changesViewerNature: boolean, changesViewerCount: boolean}
Generic hook fired before the viewer refresh cycle starts. Use this for coarse session-level
coordination, especially if you only need to know whether the call is a full content change or
just a visualization-only refresh.

#### async `before-open` | e: {viewer: OpenSeadragon.Viewer, viewerIndex: number, entry: object, backgroundIndex?: number, visualizationIndex?: number, background?: BackgroundItem, visualization?: VisualizationItem, data: [DataSpecification], dataIndexes: [number], changeKind: ["noop"|"content"|"visualization"]}
Viewer-scoped hook fired before a particular viewer is recreated or refreshed. Use this when you
need to adjust one viewer only. This event is not raised for viewers that are detected as unchanged
and skipped entirely. Since the event is fired before the viewer initialization, 
it is not fired on the actual instance, but on the manager instead. The viewer reference is
passed as the ``viewer`` property. Mutating `background`, `visualization`, or entries inside `data` updates the real session state that is used to open
that viewer. You should touch only parts of the session that relate to the viewer, marked by ``backgroundIndex``, ``visualizationIndex``, and ``dataIndexes``.

#### async `after-open` | e: {}
This event is fired once all viewers are opened and set up. There is no data since
you can read everything from the xOpat API, as the state was updated to reflect the current viewing session.
This event fires like ``before-open`` every time the whole viewing session is changed.

#### `viewer-create` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}
New viewer is added at position ``index`` in the screen.

#### `viewer-reset` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}`
Existing viewer data has been reset, the uniqueId value will change. This event fires with the
old value. New value can be retrieved once the viewer is reloaded.

#### `viewer-destroy` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}`
Existing viewer is removed at position ``index`` in the screen. Existing viewers shrink
so that the index is occupied if ``viewers.length > index``.

#### `get-preview-url` | e: `{server: string, image: string, imagePreview: null}`
Fired when the UI wants to know what is a slide _preview url_, which can be constructed
from ``server`` on which `image` slide identification lives. If `imagePreview`
is not set to be a valid string or blob value by the event handlers, it is created automatically 
from the available data in the viewer.

#### `before-plugin-load` | e: `{id: string}
Fired before a plugin is loaded within a system (at runtime).

#### `plugin-loaded` | e: `{id: string, plugin: XOpatPlugin, isInitialLoad: boolean}
Fired when plugin is loaded within a system (at runtime). Carries a flag whether the plugin was loaded automatically
(initial load) or not.

#### `plugin-failed` | e: `{id: string, message:string}
Fired when plugin fails to load within a system (at runtime).

#### `module-failed` | e: `{id: string, message:string}
Fired when a module is quarantined because its construction threw. The module is disabled for the
rest of the session: its instance is dropped, the handlers it registered are removed, and any later
`instance()` call throws instead of returning a half-built object.

#### `module-singleton-created` | e: `{id: string, module: XOpatModuleSingleton, viewer: OpenSeadragon.Viewer|undefined}`
Modules generally cannot be monitored as they might be any custom
code used in any context. However, singleton modules are meant for shared
access to functionality, therefore a handler for singletons is available.
Viewer argument is available if the module is also a viewer-singleton.

#### `viewer-singleton-created` | e: `{id: string, module: XOpatViewerSingleton, viewer: OpenSeadragon.Viewer|undefined}`
Fired when viewer singleton is created.

#### `module-loaded` | e: `{id: string}
Fired when module is loaded within a system (at runtime).

#### `key-down` | e: [KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) + `{focusCanvas: Viewer}`
Fired when user presses a key. The event object is extended by one property that tells us whether a viewer
canvas is in the focus (e.g. not a UI window) at the time. The event happens on the document node
and ignores OpenSeadragon key event.

#### `key-up` | e: [KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) + `{focusCanvas: Viewer}`
Fired when user releases a key. Similar as above.

#### `io:refused` | e: `{ ctx: IOContext, result: IOResult }`
Mirrored from `IO_PIPELINE` whenever any IO call (bundle export/import or per-element CRUD) is refused — either by an owner's `validate` hook, by a sink that tried and returned `{ refused: true }`, or because of a thrown error. The pipeline already shows a user-facing toast for refusals carrying `userMessage`; this event lets other modules observe and react (e.g. roll back local state). See [`IO_PIPELINE.md`](IO_PIPELINE.md).

> `ctx.meta.fromUndo` / `ctx.meta.fromRedo` are reserved keys the auto-history layer sets when replaying a history entry. Subscribers that count refusals "per user action" should filter these out.

#### `io:rejected-by-accepts` | e: `{ ctx: IOContext, sinkId: string }`
A bound sink's `accepts(ctx)` returned `false` — it opted out of handling this context before attempting. Distinct from `io:refused` so observers can distinguish "sink said this isn't for me" from "sink tried and failed". Useful for diagnostics; on its own it is not necessarily an error (the admin may have intentionally bound a context-filtering sink plus a fallback in the same array). When *every* bound sink opts out and no other write happened, `io:fully-refused` follows.

#### `io:fully-refused` | e: `{ ctx: IOContext, results: IOResult[] }`
Every bound sink for one dispatch failed (refused, threw, or declined via `accepts`). The data was silently dropped. Almost always a misconfigured `ENV.client.io.bindings` — the admin bound the owner+capability to sinks that none accepted at runtime. The console warns automatically; subscribe to this event to surface a richer admin notification.

#### `io:conflict` | e: `{ ctx: IOContext, sinkIds: string[] }`
Reserved for the case when two or more registered sinks both `accepts(ctx)` for the same operation. Not yet emitted by the current implementation (mirror semantics make this expected and not a conflict).

> Bundle export is driven by `IO_PIPELINE.flushBundleExport()` (called by `serializeApp` and the user-facing Export action). Plugins/modules declare bundle hooks via `this.initIO({ exportBundle, importBundle })`. See [`src/IO_PIPELINE.md`](IO_PIPELINE.md).

## Viewer-Local Events: ``VIEWER/viewer``
The events below only extend available events in OpenSeadragon. For other input events see the OpenSeadragon documentation.
Note that the most interaction should be thoroughly tested with annotations plugin/module.
Not all events and OpenSeadragon methods are 'OK' to use directly, especially those that manipulate the world items.
Prefer viewer-specific events and methods first.

#### `open` | e: {source: TileSource}
Fired when the viewer is ready. Note this is not the OSD native event but instead invoked when everything is ready.
It works just like the OSD event, but it also tells you how many times the viewer canvas has been reloaded (0th is the
initial load). Has extra argument `firstLoad` which is true for the first load of the particular viewer instance.
Called every time the viewer is reloaded.

#### async `tile-source-created` | e: `{viewer: OpenSeadragon.Viewer, originalSource: string|object|OpenSeadragon.TileSource, kind: "background"|"visualization", index: number, tileSource: OpenSeadragon.TileSource, error: null}
Fired when a tile source is created - the protocol connection to a server or service is established.
You can perform additional actions like other initialization dependent on the data source.

#### async `tile-source-failed` | e: `{viewer: OpenSeadragon.Viewer, originalSource: string|object|OpenSeadragon.TileSource, kind: "background"|"visualization", index: number, tileSource: null, error: string}
Fired when a tile source is created - the protocol connection to a server or service failed.

#### `visualization-ready` | e: `{visualization: VisualizationItem}
Fired when a visualization is ready for rendering. Unlike open event, this event
is fired each time a visualization is changed. Visualization can be updated even
if the viewer is not reloaded.

#### `show-demo-page` | e: `{id: string, show: function, htmlError: string|undefined}`
When the viewer does not open any valid data, it shows a demo page. This event allows to use custom UI to show the demo page.
If the viewer captures an error during loading, the error message is included.
The first call wins - other show(...) calls are ignored.

#### `warn-user` | e: `{originType: string, originId: string, code: string, message: string, trace: any}
User warning: the core UI system shows this as a warning message to the user, non-forcibly (e.g. it is not shown in case
a different notification is being shown). Parameters should be strictly kept:
- originType: `"module"`, `"plugin"` or other type of the source
- originId: unique code component id, e.g. a plugin id
- code: unique error identifier
- message: a brief description of the case
- trace: optional data or context object, e.g. an error object from an exception caught
#### `error-user` | e: `{originType: string, originId: string, code: string, message: string, trace: any}
Same as above, an error event.

#### `screenshot` | e: `{context2D: RenderingContext2D, width: number, height: number}
Fired when a viewport screenshot is requested.

### User Input Events

#### `canvas-press`
#### `canvas-release`

#### `canvas-nonprimary-press`
#### `canvas-nonprimary-release`


### Rendering-Related Events

#### `source-marked-faulty` | e: `{ viewer, key, error }`
Fired **once** when a tile source crosses from healthy to faulty — either it failed to instantiate
(its `info.json` / DZI could not be loaded) or it accumulated too many *consecutive* failed tile
requests during viewing (threshold: `faultyTileThreshold`, default 5; reset on any successful tile).
The verdict is persisted per-viewer in a faulty-source registry keyed by source identity, so it
survives renderer rebuilds and visualization switches. This is **warn-only**: the `TiledImage` is
**not** removed — OpenSeadragon keeps requesting tiles so the source may recover. Consumers surface
the warning (navigator tab title, shader-menu alert). `key` is the registry key; `error` is the
human-readable reason.

#### `tiled-image-problematic` | e: [OpenSeadragon[tile-load-failed]](https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html#.event:tile-load-failed)
> **Deprecated.** No longer emitted by the core. Use `source-marked-faulty` instead, which carries a
> persisted faulty verdict rather than a transient time-window heuristic.

#### `visualization-used` | e: _visualization goal_
The event occurs each time the viewer runs a visualization goal (switched between in the visualization setup title select if multiple available), 
including when the first goal loads. The object is the goal setup object from the visualization configuration, 
enriched by (private) properties of the rendering module.

#### `close`
Native OpenSeadragon event called when the canvas gets reloaded or destroyed.

## History events
Called on ``APPLICATION_CONTEXT.history`` object, these events are not related to any specific viewer.
For a full API reference including `currentUndoMeta()`, `currentRedoMeta()`, and `HistoryEntryMeta`, see [HISTORY.md](HISTORY.md).

#### async `register-provider` | e: `{ provider: HistoryProvider }`
This event is fired after a new history provider is registered through ``registerProvider(provider)``.
History providers can override the default undo/redo behavior and are checked before the internal history buffer.
You can use this event to refresh UI that depends on history capabilities, such as Undo and Redo buttons.

#### async `unregister-provider` | e: `{ provider: HistoryProvider }`
Fired after a provider is removed via ``unregisterProvider(provider)`` or via the unregister callback returned by ``registerProvider``.
Use this event to refresh UI that depends on history capabilities.

#### async `change-size` | e: `{ size: number }`
This event is fired after the history buffer size is changed through the ``size`` setter.
The payload contains the requested new size in ``e.size``.
This only changes the configured buffer capacity; it does not truncate existing entries immediately.

#### async `push` | e: `{ meta: HistoryEntryMeta | undefined }`
Fired **after** `forward()` succeeds and the entry is committed to the buffer.
The payload carries the `meta` of the newly committed entry (or `undefined` if no meta was supplied).
At the moment this event fires, `canUndo()` already returns `true` for the new step.
You can use this event to refresh Undo and Redo UI.

#### async `undo` | e: `{ step: HistoryEntryMeta } | { provider: HistoryProvider }`
Fired when an undo operation completes. Two forms:
- **Buffer undo:** `{ step: HistoryEntryMeta | undefined }` — contains the meta of the entry that was just undone.
- **Provider undo:** `{ provider: HistoryProvider }` — the provider that handled the undo step.

This event fires after `backward()` executes and the buffer cursor is moved back.

#### async `redo` | e: `{ step: HistoryEntryMeta } | { provider: HistoryProvider }`
Fired when a redo operation completes. Two forms:
- **Buffer redo:** `{ step: HistoryEntryMeta | undefined }` — contains the meta of the entry that was just redone.
- **Provider redo:** `{ provider: HistoryProvider }` — the provider that handled the redo step.

This event fires after `forward()` executes and the buffer cursor advances.

#### async `clear` | e: options object
Fired after the committed buffer is cleared. The payload is the options object passed to `clear(options)`.
If `options.resetProviders` was `true`, all provider `reset()` calls have already completed when this fires.

#### `history-busy-change` | e: `{ busy: boolean, queued: number, running: number, pending: number }`
Fired whenever the internal promise queue state changes — i.e. when an operation starts queuing, starts running, or finishes.
Useful for showing loading indicators while undo/redo is in progress.
- `busy` — `true` while any operation is actively executing.
- `queued` — number of operations waiting to start.
- `running` — number of operations currently executing (0 or 1 in practice).
- `pending` — `queued + running`.

#### `error` | e: `{ action: string, error: any }`
Fired when any history action (`push`, `undo`, `redo`, `provider.undo`, etc.) throws an unhandled exception.
- `action` — the internal action name string (e.g. `"push"`, `"undo"`, `"provider.undo"`).
- `error` — the thrown error object.

## User Events
Called on ``xOpatUser.instance()`` object, these events support contextualized logging.
By default, contextId undefined (or `core`) is the main viewer auth context. Other contexts
are for arbitrary log-ins against third party services. 

> Note that events with ``*`` asterisk are namespaced. If you have a `custom-context` context,
> the event name fired is ``login:custom-context``.
> You can use ``XOpatUser.instance().getEventName(eventName, 'custom-context')`` to get the event name with namespace.

#### `login`* | e: `{userId: string, userName: string, contextId: string}`
Fired when a user successfully logs in, either as the primary user or within a specific service context.

#### `logout`* | e: `null`
Fired when the user session is terminated, erasing all secrets and resetting the UI to an anonymous state.

#### `secret-updated`* | e: `{secret: any, type: string, contextId: string}`
Fired when a new authentication token (e.g., JWT) is stored for a specific context, allowing the HttpClient to resume pending requests.

#### `secret-removed`* | e: `{type: string, contextId: string}`
Fired when a specific authentication secret is deleted from the user instance.

#### `secret-needs-update`* | e: `{type: string, contextId: string}`
Fired when a component (like HttpClient) encounters an authentication failure and requests the OIDCAuthClient to perform a background or interactive refresh.

#### `user-select` | e: `{userId: string, userName: string}`
Fired when the user interacts with the user panel/icon in the application interface.
