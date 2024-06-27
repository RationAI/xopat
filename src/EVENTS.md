# xOpat - Events

Events in the system are either native OpenSeadragon events, 
or events emitted directly by the viewer. OpenSeadragon events
can occur on various objects within the library, the viewer always
invokes its events on the `VIEWER` instance.

> In case you need more events, 
> let us know. Events are being integrated to the viewer and many useful ones might be missing.


### Events in modules
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
Available is ``VIEWER.tools.raiseAwaitEvent(context, ...)`` that works the same as `context.raiseEvent()`
except that it waits for asynchronous calls to finish. Async functions are not awaited for by default.

Use ``preventDefault`` flag and check for its existence in the event handler to support aborting certain events.

## Event List
Events have their name (for which you register) and when invoked, a parameter is passed
to the handler function that might contain a lot of useful data.
### General Events

#### `open` | e: {source: TileSource, reopenCounter: number}
Fired when the viewer is ready. Note this is not the OSD native event but instead invoked when everything is ready.
It works just like the OSD event, but it also tells you how many times the viewer canvas has been reloaded (0th is the
initial load).

#### async `before-first-open` | e: null
Fired before the first open of the viewer happens. Apps can perform
custom functionality just before the viewer gets initialized.
In this event, you can also override the application rendering configuration,
as it has not been initialized yet. For example, if the application rendering
is missing all the data, you can provide default values for the rendering.
Note that exception thrown in this event is considered as a signal for aborting the rendering.
TODO DOCS
#### `export-data` | e: `{}`
Submit your serialized data to the export event. You should use the data storage instance you
retrieve from ``initPostIO(...)`` call to set your data if you didn't do this already when this event fires.

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

#### `before-plugin-load` | e: `{id: string}
Fired before a plugin is loaded within a system (at runtime).

#### `plugin-loaded` | e: `{id: string, plugin: XOpatPlugin}
Fired when plugin is loaded within a system (at runtime).

#### `plugin-failed` | e: `{id: string, message:string}
Fired when plugin fails to load within a system (at runtime).

#### `module-singleton-created` | e: `{id: string, module: XOpatModuleSingleton}`
Modules generally cannot be monitored as they might be any custom
code used in any context. However, singleton modules are meant for shared
access to functionality, therefore a handler for singletons is available.

#### `module-loaded` | e: `{id: string}
Fired when module is loaded within a system (at runtime).

#### `screenshot` | e: `{context2D: RenderingContext2D, width: number, height: number}
Fired when a viewport screenshot is requested.

### User Input Events

#### `key-down` | e: [KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) + `{focusCanvas: boolean}`
Fired when user presses a key. The event object is extended by one property that tells us whether the
main canvas is in the focus (e.g. not a UI window) at the time. The event happens on the document node
and ignores OpenSeadragon key event.

//todo override openseadragon hotkeys and trigger them ourselves, disable R rotation

#### `key-up` | e: [KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) + `{focusCanvas: boolean}`
Fired when user releases a key. Similar as above.

####

### OpenSeadragon: User Input Events
These are listed just for the reference, for other input events see the OpenSeadragon documentation.
Note that the interaction should be thoroughly tested with annotations plugin. You might also find the annotations API
fully re-usable for your purposes, **using custom annotation objects to perform tasks**.

#### `canvas-press`
#### `canvas-release`

#### `canvas-nonprimary-press`
#### `canvas-nonprimary-release`


### Rendering-Related Events

#### `get-preview-url` | e: `{server: string, image: string, usesCustomProtocol: boolean, imagePreview: null}`
Fired when the UI wants to know what is a slide _preview url_, which can be constructed
from ``server`` on which `image` slide identification lives. If `imagePreview`
is not set to be a valid string or blob value by the event handlers, it is created automatically based on server and image
values using the ``image_group_preview`` configuration specification.

#### `tiled-image-problematic` | e: [OpenSeadragon[tile-load-failed]](https://openseadragon.github.io/docs/OpenSeadragon.Viewer.html#.event:tile-load-failed)
Fired when the corresponding `TiledImage` fails to load multiple tiles within a certain time
so that the viewer believes the `TiledImage` instance is faulty and should be removed.
The removal does not happen on the basic viewer layers but should you add your own `TiledImage`s to
OpenSeadragon, this helps you to react on their misbehaviour.

#### `background-image-swap` | e: `{backgroundImageUrl: string, prevBackgroundSetup: object, backgroundSetup: object, previousTiledImage: OpenSeadragon.TiledImage, tiledImage:OpenSeadragon.TiledImage}`
When a different image pyramid is loaded as a background, the viewer notifies you that the basic 
measurements (aspect ratio, dimensions...) might have changed. It gives you the background setup objects from
the viewer configuration and corresponding `TiledImage` instances.

#### `visualization-used` | e: _visualization goal_
The event occurs each time the viewer runs a visualization goal (switched between in the visualization setup title select if multiple available), 
including when the first goal loads. The object is the goal setup object from the visualization configuration, 
enriched by (private) properties of the rendering module.

#### `close`
Native OpenSeadragon event called when the canvas gets reloaded.




