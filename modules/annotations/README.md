# Annotations

The complex functionality will be described later. This plugin allows to create, edit and export annotations.


### Formats
The native format used comes from the underlying library and available features. To support multiple formats, 
you can either use supported formats implemented as a build-in convertors, or provide a new convertor. 
Supported formats are `ASAP XML` annotations from the ASAP Viewer, and `GeoJSON` annotations. For Qpath, `qupath`
GeoJSON annotation format is available too. Note that although supported, these are possibly lossy formats.
More information can be found in `convert/README.md`.

### Sending data VIA xOpat API
In plugins/modules readme, you can find how data serialization works. Either you have custom plugin that
inserts its data to annotations via the module API, or you can use built-in POST data technique. The best
way of doing this is drawing some annotations end running ``export as file`` feature, which will in HTML
show you how the structure is expected to look like. In summary, you have to provide a string, serialized
object like this:

> POST key: ``module[annotations]``
> POST value: ``<serialized string>``

where the actual serialized data depends on the target format used. xOpat can detect supported formats automatically, although
it might take a while. So you can do something like ``module[annotations] = "<ASAP_Annotations><Annotations><Annotation Type=\"Polygon\" ..."``.
Using the xOpat _native_ format is recommended if possible as other formats might be slow, or lossy.


### API
Each annotation is handled by its factory that defines its behaviour - details are in the `AnnotationObjectFactory` 
interface and in `convert/README.md`.
For object themselves, two representations are used
 - plain object representation that consists of propeties only - e.g. 'native' format, these can be used to instantiate
 fabric objects
 - class object representation with methods that extends `fabric.Object`.
 
While there might be two annotations with the same type (i.e. of the same `fabric.Object` subclass), 
they might not be of the same annotation type - depends on the associated factory managing the behaviour. Default 
factories available are only 1:1 mapping to the fabric annotation types, except for Groups - these, if used, 
are special annotations with specific use (e.g. a ruler).
 
For most of the behaviour, you can consult ``fabricjs`` documentation, however there are new features available:
 - check main annotations class API there are many functions you would like to use over the fabricjs middleware
 - check other main classes API in the framework, namely ``PolygonUtilities``, `PresetsManager`, `History`.
 - inherited from ``fabricjs module`` there is a new function on  `fabric.Object`: `zooming(zoom)` that gets invoked if exists
 - extended by ``annotations module`` there is a new funciton on  `fabric.Object`: `_factory()` memoization that simplifies factory API access


#### The Factory
Factories govern how object behave - it is the module API over annotations. They provide handful
set of methods to create, copy, iterate and process annotations easily.

todo finish description

