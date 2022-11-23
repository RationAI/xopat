# Convertors
In order to flexibly support many annotation formats, you can implement your own format support by using
`OSDAnnotations.Convertor.register([name], [object|class])`. The class provided must implement `encode` 
(outputting your format from internal representation) or `decode` (vice versa). These functions receive
a list of active objects and a list of presets.

### Supported formats
The default format is the native format. Build-in (lossy) convertors include **GeoJSON** and **ASAP XML** formats. 

To register a new converter, register the converter class after its definition with:

> ``OSDAnnotations.Convertor.register(name, convertorClass)``

Or possibly add the record manually to ``OSDAnnotations.ConvertorCONVERTERS`` map.

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
    sessionID       auto, technical id of the session

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
`[factoryID] ruler` --> `[type] group[line, text]`: a ruler consists of a type hierarchy: a group with one line and a text label
`[factoryID] rect` --> `[type] rect`: a rectangle annotation is simply an identity
`[factoryID] myCustomTool` --> `[type] rect`: a possible new factory that uses a rect primitive to perform a selection

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

Furthermore, you can use ``module.trimExportJSON`` method to trim
all properties automatically, **in depth**
 - top-level objects (i.e. the parent group) are trimmed using ``factory.copyNecessaryProperties``
   - forcefully, `objects`, `left`, `top`, `width`, `height` props are attached
 - all children are copied over only using ``factory.copyInnerProperties``

Note that this function is implemented using factory's ``iterate`` method (that should work
generically for any annotation but also offers the flexibility of overriding).

