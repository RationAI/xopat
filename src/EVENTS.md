# xOpat - Event System

Events are un UI system the most powerful feature: allows to react to events
happening all over the place without weird dependencies. Note hover, 
that using events without consideration might lead to unpredictable behaviour, 
like explosion of events or looped calling.

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
#### async `before-first-open` | e: {data: [string], background: [BackgroundItem], visualizations: [VisualizationItem], fromLocalStorage: boolean}
Fired before the first open of the viewer happens. Apps can perform
custom functionality just before the viewer gets initialized.
``fromLocalStorage`` is true when the data was loaded from the user browser cache, but the viewer
was not opened with a session spec. You can use this flag to monitor whether the viewer
was properly opened, or just shows cached session and possibly replace it with more relevant one.
Note that exception thrown in this event is considered as a signal for aborting the viewer loading.

#### async `before-open` | e: {data: [string], background: [BackgroundItem], visualizations: [VisualizationItem], bgSpec: [number|number[]|undefined|null], vizSpec: [number|number[]|undefined|null]}
Unlike `before-first-open`, this event is invoked for each viewer that is opened. It is meant primarily
as a place where you can also override the application rendering configuration,
as the viewer is still loading. For example, if the application rendering
is missing all the data, you can provide default values for the rendering. This data can be set
to the respective elements: data / background / visualization arrays.
Spec objects define what are active indexes to open. They are sometimes undefined - in that case,
the initialization parses this information from the session information.

#### async `after-open` | e: {}
This event is fired once all viewers are opened and set up. There is no data since
you can read everything from the xOpat API, as the state was updated to reflect the current viewing session.
This event fires like ``before-open`` every time the whole viewing session is changed.

#### `viewer-create` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}
New viewer is added at position ``index`` in the screen.

#### `viewer-reset` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}
Existing viewer data has been reset, the uniqueId value will change. This event fires with the
old value. New value can be retrieved once the viewer is reloaded.

#### `viewer-destory` | e: `{uniqueId: string, index: Number, viewer: OpenSeadragon.Viewer}
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

#### `export-data` | e: `{}`
Submit your serialized data to the export event. Direct use is not advised. You should use the data storage instance you
retrieve from ``initPostIO(...)`` call to set your data if you didn't do this already when this event fires.
Note that this can be both viewer independent and viewer-contextualized export, see the docs on initPostIO.

## OpenSeadragon: User Input Events
These are listed just for the reference, for other input events see the OpenSeadragon documentation.
Note that the interaction should be thoroughly tested with annotations plugin. You might also find the annotations API
fully re-usable for your purposes, **using custom annotation objects to perform tasks**.

### Viewer-Local Events: ``VIEWER/viewer``

#### `open` | e: {source: TileSource}
Fired when the viewer is ready. Note this is not the OSD native event but instead invoked when everything is ready.
It works just like the OSD event, but it also tells you how many times the viewer canvas has been reloaded (0th is the
initial load). Has extra argument `firstLoad` which is true for the first load of the particular viewer instance.
Called every time the viewer is reloaded.

### async `tile-source-created` | e: `{viewer: OpenSeadragon.Viewer, originalSource: string|object|OpenSeadragon.TileSource, kind: "background"|"visualization", index: number, tileSource: OpenSeadragon.TileSource, error: null}
Fired when a tile source is created - the protocol connection to a server or service is established.
You can perform additional actions like other initialization dependent on the data source.

### async `tile-source-failed` | e: `{viewer: OpenSeadragon.Viewer, originalSource: string|object|OpenSeadragon.TileSource, kind: "background"|"visualization", index: number, tileSource: null, error: string}
Fired when a tile source is created - the protocol connection to a server or service failed.

### `visualization-ready` | e: `{visualization: VisualizationItem}
Fired when a visualization is ready for rendering. Unlike open event, this event
is fired each time a visualization is changed. Visualization can be updated even
if the viewer is not reloaded.

### `show-demo-page` | e: `{id: string, show: function, htmlError: string|undefined}`
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

#### `tiled-image-problematic` | e: [OpenSeadragon[tile-load-failed]](https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html#.event:tile-load-failed)
Fired when the corresponding `TiledImage` fails to load multiple tiles within a certain time
so that the viewer believes the `TiledImage` instance is faulty and should be removed.
The removal does not happen on the basic viewer layers but should you add your own `TiledImage`s to
OpenSeadragon, this helps you to react on their misbehaviour.

#### `visualization-used` | e: _visualization goal_
The event occurs each time the viewer runs a visualization goal (switched between in the visualization setup title select if multiple available), 
including when the first goal loads. The object is the goal setup object from the visualization configuration, 
enriched by (private) properties of the rendering module.

#### `close`
Native OpenSeadragon event called when the canvas gets reloaded or destroyed.




