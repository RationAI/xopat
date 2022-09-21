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

    color           preset, defines the annotation color
    zoomAtCreation  creation time zoom level - the value comes from fabric.canvas
    type            fabricjs object type - drives which object will be internally created (rect -> fabricjs.Rect)
    factoryId       pathopus annotation type - drives which pathopus annotation factory implementation will be taking 
                    care of the annotation object; these define what object can or cannot do and how (convert to 
                    explicit/polygonize, modify with free form tool...), example: polygon -> PolygonFactory
    meta            custom metadata
    presetID        a numerical preset id binding
    layerId         a numerical layer id binding, experimental

The geometric properties are directly dependent on `type` and `factoryId` used. The `factoryId` is HAS-A relationship
to the `type` hierarchy. Each factory defines which fabricjs (hierarchical) type is supported. Mostly, it is 1-1 mapping.
Multiple factories can use the same fabricjs type as they can have different purposes (a rect annotation and a tool selection
with a rect shape that is removed upon completion and the obtained area coordinates are sent as a request for further processing...).

Examples: 
`[factoryId] ruler` --> `[type] group[line, text]`: a ruler consists of a type hierarchy: a group with one line and a text label
`[factoryId] rect` --> `[type] rect`: a rectangle annotation is simply an identity
`[factoryId] myCustomTool` --> `[type] rect`: a possible new factory that uses a rect primitive to perform a selection

#### Native objects: type-dependent properties
Each `type` supports its own geometry-related properties. These are directly from favricjs documentation and only
the basic ones are described also here:

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
    factoryID   the associated factory #todo provide general fallback implementation
    presetID    the id of this object to be paired with annotations
    meta        a map: {<id>: {name: string, value: any}} that adds custom meta to the group: name is a
                human-readable label, the value can be any JSON-friendly value

##### Preset variables: a live object
The live object properties differ from those described above, for example factoryID is paired with an appropriate
factory instance to provide its features.

### Gotchas
In general, `type` is the only general property an annotation object must provide when importing (but you should
provide all **type-dependent properties**), other things
will be set up for you automatically. However, doing so mean two subsequent imports of annotations are type-and-id-wise
incompatible, although they look identically.

By default, a ``polygon`` factory is always available, so that you can set this value as a fallback. Other factories
might not be available on the current session: for safety, check the presence with the OSDAnnotations API.



