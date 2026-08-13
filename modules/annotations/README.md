# Annotations

The complex functionality will be described later. This plugin allows to create, edit and export annotations.

> **Migrating from the legacy `annotation-before-*` event protocol?** See [`MIGRATION.md`](MIGRATION.md). Per-action veto, per-item server sync, and undo/redo all flow through xOpat's generic IO pipeline now ([`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md)).


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


### Comments

Comments are **not** a separate IO resource or sink — they **piggyback on the annotation object**.
Each annotation carries its comment thread inline as `annotation.comments[]` (an
[`AnnotationComment`](EVENTS.md) array: `id`, `author`, `content`, `createdAt`, `replyTo?`,
`removed?`), and `comments` is one of the factory `copiedProperties` (`objects.js`) so it serializes
with the object.

This is deliberate. The generic IO pipeline models flat, independently-bound collections with no
parent/child, cascade, or referential integrity (see [`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md)).
A comment is meaningless without its annotation and shares its lifecycle, so a dedicated
`crud:comment` resource would buy nothing but a foreign-key (`annotationId`) to hand-maintain and a
second binding to route. Instead comments ride the annotation's own persistence:

- **Realtime save.** `addComment` / `deleteComment` (`annotations-canvas.js`) dispatch a
  `{ comments }` patch through `annotationResource.update` — exactly like `changeAnnotationPreset` —
  so a bound `crud:annotation` sink receives the change per-annotation, and it is undoable via
  `APPLICATION_CONTEXT.history`. Deletes are soft (`removed: true`) so the thread stays auditable.
- **Bundle save/export.** `comments` is in **both** `copiedProperties` and `necessaryProperties`, so
  it survives a full-canvas Save/Export (native convertor) **and** the `'necessary'`-scoped clone that
  `_normalizeImportState` / `trimExportJSON` apply on every import/reload. 

The trade-off accepted: a comment edit rewrites the whole annotation payload (shallow-merged wholesale
into the outbox) and there is no per-comment routing or authorization. Only promote comments to their
own resource if they must persist to a **different backend** than annotations or need **per-comment
rights** — neither is true today.

> **Lossy convertors drop comments.** A convertor that emits a fixed property set will **not** carry
> `comments` unless it copies the field explicitly. 
> Persisting under a new lossy sink needs both a convertor extension and backend storage for the field.

### Properties external systems can force

An integration that links annotations to records of its own (a server id, an
ownership marker) has to keep that property attached across serialization. Register it:

```js
const dispose = annotations.registerPersistedProperties("myServerId", "myOwnerType");
```

The registry is honoured everywhere the module serializes: the export whitelist,
**import normalization** (`_normalizeImportState`) and **history capture**
(`_captureImportState`). That last pair is the part worth knowing: the trim runs on
every import and every undo snapshot, so a property that is *not* registered is
silently gone after the first reload or the first Ctrl-Z — not only on a lossy
export. That is exactly how an integration ends up unable to address its own
annotations after hydration.

`forceExportsProp = "name"` is the older single-property setter; it still works and
now feeds the same registry, but it returns no disposer.

### Read-only annotations

`annotation.readOnly` marks an annotation the user may see but not change — an
analysis job's output, a record owned by another scope, anything a rights resolver
locked. It is enforced at the IO checkpoint by a guard the module registers itself,
so **every** mutation path is covered at once: delete, edit commit, preset change,
and entering edit mode. Comments are deliberately still allowed; a locked finding is
still discussable. Visually the object keeps its selection but cannot be dragged and
shows a padlock instead of the `private` toggle.

Set it with `fabric.setAnnotationReadOnly(object, value)` or carry it in from a
convertor. It lives in both `copiedProperties` and `necessaryProperties`, so it
survives export, import and undo — a lock that evaporated on reload would be worse
than no lock at all.

Do not confuse it with `private`, which despite the padlock icon controls **export**,
not mutability.

A read-only annotation can still be **evicted**: `fabric.dropAnnotations(objects)`
removes local copies without dispatching to any sink, running guards, or pushing
history. That is for annotations which are a *projection of remote data* — an
analysis result, a record another system owns — where the canvas copy is a cache and
the record lives elsewhere. Because re-fetching is one query, an owner of such data
can **derive** what is on screen from what it currently wants shown, instead of
storing a hide/show preference it then has to keep in sync (the EMPAIA integration
shows one analysis at a time this way). One coupling to know: a bundle export
serializes the canvas, so evicted objects are absent from it — harmless against an
additive sink, data loss against a destructive one.

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
are special annotations with specific use (e.g. an angle).
 
For most of the behaviour, you can consult ``fabricjs`` documentation, however there are new features available:
 - check main annotations class API there are many functions you would like to use over the fabricjs middleware
 - check other main classes API in the framework, namely ``PolygonUtilities``, `PresetsManager`, and the global App `History` system via `APPLICATION_CONTEXT.history`.
 - inherited from ``fabricjs module`` there is a new function on  `fabric.Object`: `zooming(zoom)` that gets invoked if exists
 - extended by ``annotations module`` there is a new funciton on  `fabric.Object`: `_factory()` memoization that simplifies factory API access


#### The Factory
Factories govern how object behave - it is the module API over annotations. They provide handful
set of methods to create, copy, iterate and process annotations easily.

todo finish description

