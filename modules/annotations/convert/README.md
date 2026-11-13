# Annotation formats
Annotation formats are entries of the core format registry, `IO_PIPELINE.formats`, under the domain
`"annotations"` (see [`src/IO_PIPELINE.md` → Formats](../../../src/IO_PIPELINE.md#formats)). A format converts
between the **native model** `{ objects, presets }` (described below) and a string or bytes:

```js
IO_PIPELINE.formats.register({
    domain: "annotations",
    id: "my-format",
    title: "My Format",
    extensions: [".awesome"],
    contentType: "application/json",
    // What the model handed to encode() must contain. All default to true:
    //   allProps  every property of each object, or only its factory's necessary ones
    //   props     extra property names to keep when allProps is false
    //   objects / presets   whether the format can carry them at all
    traits: { allProps: false },
    encode(model, fctx) { return myStringify(model.objects, model.presets); },
    decode(data, fctx)  { return { objects: [...], presets: [...] }; },
    sniff(data, hint)   { return hint.json?.myMarker ? 0.9 : 0; },   // optional, 0..1
});
```

It can be registered from anywhere — this module, a plugin, a module loaded before or after this one — and it
immediately shows up in the import/export dialog and can be required by an IO sink or pinned on a binding.

`fctx.options` are the export options (the module's `convertors` arguments, the user's values for the format's
own declared `options`, and `exportsObjects` / `exportsPresets` saying what was asked for); `fctx.context` is the
viewer's canvas wrapper (absent for a conversion with no viewer behind it — use `OSDAnnotations.instance()` for
factories then); `fctx.io` is the IO dispatch when the pipeline is the caller.

#### Converting directly

```js
const text = await fabricWrapper.export({ format: "geo-json" });            // the canvas, encoded
await fabricWrapper.import(data, { format: "auto", filename: file.name });  // detect and load
const model = fabricWrapper.toModel({ format: "geo-json", scopeSelected: true });   // un-encoded
const text2 = await IO_PIPELINE.formats.encode("annotations", "geo-json", model, { context: fabricWrapper });
const feature = IO_PIPELINE.formats.encodeItem("annotations", "geo-json", oneNativeObject);
```

#### The previous API (deprecated)

`OSDAnnotations.Convertor.register(id, class extends OSDAnnotations.Convertor.IConvertor {…})` — a class with
`encodePartial` + a static `encodeFinalize` and/or `decode` — still works: the class is adapted into a registry
format. The static helpers (`encodePartial`, `encodeFinalize`, `decode`, `get`, `formats`, `getSuffix`) and
`fabricWrapper.exportPartial` / `exportFinalize` delegate to the registry. Two differences to be aware of: for a
format that is *not* a legacy class, the "partial" output is the native model rather than a per-format
intermediate, and option values are per call (set through `module.setFormatOption(format, name, value)`) rather
than static properties of the class.


### Supported formats
The default format is the native format. Build-in (lossy) convertors include 
**GeoJSON** (with support for Qpath) and **ASAP XML** formats. 

Format IDs are exact — no aliasing is performed. Built-in IDs:

| ID | Format |
|----|--------|
| `native` | xOpat native (lossless) |
| `asap-xml` | ASAP XML |
| `geo-json` | GeoJSON |
| `qupath` | QuPath GeoJSON |
| `dicom` | DICOM SR (binary), contributed by `plugins/dicom` when loaded |
| `empaia` | EMPAIA Workbench annotations, contributed by `modules/empaia-workbench` when loaded |

`auto` means "detect from the file name and the content" and is valid for import only.

#### Where the default comes from

There are two formats, and they are deliberately separate:

- the format of the **user's own file import/export**, shown in the annotations dialog; and
- the format the **module uses for IO** — the bundle an unpinned IO sink (the session `post-data` export, a
  repository) receives. A pick made in the dialog does not change it; configuration (2–4 below) does. A sink that
  needs a specific format, or a binding that pins one, overrides it for that destination only.

The dialog's format is resolved with this precedence (highest first):

1. the format explicitly picked in the annotations UI — stored as a **per-browser
   preference** under the plugin cache key `ioFormat`;
2. `APPLICATION_CONTEXT.config.plugins["gui_annotations"].ioFormat` (session bundle / URL params);
3. `ENV.plugins.gui_annotations.ioFormat` (deployment, plugin scope);
4. `ENV.modules.annotations.convertors.format` (deployment, module scope — merged over
   `modules/annotations/include.json`);
5. `native`.

An unknown ID at any level is reported once in the console and downgraded to `native`.

Because (1) outranks all configuration, a deployment default will not take effect in a
browser where a user once picked a format by hand. That preference is only written on an
explicit pick — never on plugin init — so clearing the `ioFormat` cache entry restores the
configured default.


### Generic polygon / multipolygon representation

You can abstract from understanding the object internals, which is useful in case of export to some
format that does not support the target annotation type.

````js
const poly = factory.toPointArray(object, OSDAnnotations.AnnotationObjectFactory.withArrayPoint, 0);
````
When polygon is retrieved, it can be either a polygon or a nested polygon (when multipolygon appears).
You need to somehow store this object, preferably along with ``factoryID``. Later, you can re-import
it using:

````js
const factory = this.context.getAnnotationObjectFactory(type);
const annotation = factory.create(factory.fromPointArray(poly, 
    OSDAnnotations.AnnotationObjectFactory.fromArrayPoint), this.context.presets.getCommonProperties());
````
The application can consume both JSON-exported representations or fully fabric objects coming from ``factory.create(..)``.
We don't need to call ``getCommonProperties`` with preset instance as this will be handled during annotations import -
we now care about correct geometry / instance creation. The properties also carry information like zoom level and so on.

> The downside is that in the given format, the annotation itself might not be well understood or represented! 

### Native Format
This format is used when rendering annotations, and any other format is sooner or later converted to this
format. It includes the most detailed export data. The output is a JSON object with three
major keys: ``metadata``, `objects` and `presets`. Metadata includes a timestamp and a version.

#### IDs
There are three ID types:
 - ``id``: unused property, left for integration with other logics: gives the annotation identity of the 
 external (often storage) system
 - ``incrementId``: unique ID per annotation memory object, even if object is perceived by user the same
 after e.g. modification, it has different increment ID
 - ``internalID``: consistent ID of annotation as perceived by a user, internal value not to be exported
 and copied over between objects - the system manages this internally

### Native Format: objects
The objects build on fabricJS objects, extending them with multiple properties. You can use any fabricJS properties, 
however, a common behaviour is ensured by keeping the following property policies. `auto` keyword means this property
is managed internally and is not advised to set. `preset` keyword means this property is driven by a preset - a preferred way.


    fill            auto, the object fill
    stroke          auto, the object stroke
    strokeWidth     auto, adjusted on zoom if applicable
    opacity         auto, adjusted by general controls
    scaleX          auto, should be 1, used with implicit object modifications
    scaleY          auto, should be 1, used with implicit object modifications
    originalStrokeWidth auto, default stroke with used
    isLeftClick     auto, stores whether the object was created with a left or right mouse click
    selectable      auto, stores whether the object can be interacted with
    hasRotatingPoint auto, prevents annotation rotation which we do not want to support
    borderColor     auto, the annotation fabricjs controls border color
    cornerColor     auto, the annotation fabricjs controls corner color
    borderScaleFactor auto, the annotation fabricjs controls scale factor
    hasControls     auto, disables fabricjs buildin controls, internally enabled if the system decides to
    lockMovementX   auto, disables the annotation movement in X
    lockMovementY   auto, disables the annotation movement in Y
    sessionID       auto, technical id of the session, annotation is not interactive if not set

    color           preset, defines the annotation color
    zoomAtCreation  creation time zoom level - the value comes from fabric.canvas
    type            fabricjs object type - drives which object will be internally created (rect -> fabricjs.Rect)
    factoryID       xopat annotation type - drives which xopat annotation factory implementation will be taking 
                        care of the annotation object; these define what object can or cannot do and how (convert to 
                        explicit/polygonize, modify with free form tool...), 'Unknown Annotation' means this property 
                        has no registered factory active for the given factoryID 
                        example: polygon -> PolygonFactory
    meta            custom metadata, unlike with presets this is only an override value: it is a {id: any} map
    presetID        a numerical preset id binding
    layerID         a numerical layer id binding, experimental
    id              annotation ID, can be undefined, unused by the core module, supported for external use
    author
    created

This does not list all the properties though.
The geometric properties are directly dependent on `type` and `factoryID` used. The `factoryID` is HAS-A relationship
to the `type` hierarchy. Each factory defines which fabricjs type is supported (top level only in case of hierarchies). 

> In case of hierarchical annotations (based on _groups_), the top-level group should contain all _non-auto_ properties
>  (see exporting in depth explanation)

Mostly, it is 1-1 mapping.
Multiple factories can use the same fabricjs type as they can have different purposes (a rect annotation and a tool selection
with a rect shape that is removed upon completion and the obtained area coordinates are sent as a request for further processing...).

> Each factory defines ``exports()`` and `exportsGeometry()` to get custom props and geometry props keys respectively.

Examples: 
`[factoryID] angle` --> `[type] group[polyline, text, path]`: an angle consists of a type hierarchy: a group with a polyline, a text label and an arc path
`[factoryID] rect` --> `[type] rect`: a rectangle annotation is simply an identity
`[factoryID] myCustomTool` --> `[type] rect`: a possible new factory that uses a rect primitive to perform a selection

##### IDs
``ID`` property is not internally used by default, but is supported due to its frequent usage. You have to set it manually, it
is by default undefined.

``sessionID`` property not only marks the current annotation session identification, it also acts as an interactivity flag - 
if it is missing, the given annotation is not modifiable.

``layerID`` not currently used, prepared for layers support. TODO update docs once ready.

``presetID`` ID for the metadata group (a class) that describes the annotation. Presets are class templates
that are defined once, and used repeatedly.

##### Available exporting
The module can export objects with all props or necessary props only (i.e. not an `auto` value). But fabric exports
by default many other properties, the list above only lists _guaranteed_ properties. Convertor can specify 
``static includeAllAnnotationProps = false;`` to not to force `auto` props inclusion, however, many will still be present.
In order to extract necessary properties when exporting, call

````
const factory = module.getAnnotationObjectFactory(object.factoryID);
object = factory.copyNecessaryProperties(object); //automatically incluses exports*() factory props
````

#### Native objects: geometry properties
Each `type` supports its own geometry-related properties. These are defined in respective factory `exportsGeometry`
method and only basic ones are listed here:

##### rect
    left        left-top corner X coord
    top         left-top corner Y coord
    width       width
    height      height
##### ellipse
    left        left-top corner X coord 
    top         left-top corner Y coord 
    rx          radius in X direction 
    ry          radius in Y direction 
    angle       rotation, default 0, not supported with controls by default
##### polygon
    points      an array of point objects {x:number,y:number}


### Native Format: presets
Presets are groups of annotations: they define the property of newly created annotations and group
information/description/metadata for all the annotations they 'include'. If an annotation differs with its
metadata, it is stored in the annotation `meta` field.

##### Preset variables         
    color       the annotation color, a group update on annotations will be overriden by this value
    factoryID   the associated factory the preset uses to create annotations, #todo provide general fallback implementation
    presetID    the id of this object to be paired with annotations
    meta        a map: {<id>: {name: string, value: any}} that adds custom meta to the group: name is a
                    human-readable label, the value can be any JSON-friendly value

##### Preset variables: a live object
The live object properties differ from those described above, for example factoryID is paired with an appropriate
factory instance to provide its features.

### Gotchas
In general, `type` is the only general property an annotation object must provide when importing (but you should
provide all **geometry properties**), other things
will be set up for you automatically. However, doing so mean two subsequent imports of the same annotations are 
type-and-id-wise different, although they look identically.

By default, a ``polygon`` factory is always available, so that you can use polygon and its factory as a fallback. 
Other factories might not be available on the current session: for safety, check their presence with the OSDAnnotations API.

### Exporting in depth
Raw exporting can be done via `toObject` method, this method simply
exports all or necessary properties of each annotation objects. This
**does not mean the export contains only these properties**, but
it guarantees their presence. To trim down the properties, you can
use an object own factory methods that correspond to the categories below:

There are three levels of exports:
 - **all** (``factory.copyProperties``) - creates a shallow copy that contains all properties defined by the
static object describing module-recognized properties as well as below
 - **necessary** (``factory.copyNecessaryProperties``) - creates a shallow copy that contains all properties defined by the
static object describing necessary content for exporting as well as below
 - **inner** (``factory.copyInnerProperties``) - creates a shallow copy that copies over only properties defined in the factory's 
`exports()` and `exportsGeometry()` methods

Furthermore, you can use ``module.fabric.trimExportJSON`` method to trim
all properties automatically, **in depth**
 - top-level objects (i.e. the parent group) are trimmed using ``factory.copyNecessaryProperties``
   - forcefully, `objects`, `left`, `top`, `width`, `height` props are attached
 - all children are copied over only using ``factory.copyInnerProperties``
 - properties registered via ``module.registerPersistedProperties(...)`` are kept
   as well, on top of whatever the caller passed as `keeps`. That registry is what
   external systems use to keep their linkage (a server id, an ownership marker)
   attached to an annotation; the trim runs on every import and every history
   capture, so a property it drops is gone after the first reload or undo.

Note that this function is implemented using factory's ``iterate`` method (that should work
generically for any annotation but also offers the flexibility of overriding).

