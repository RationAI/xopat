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

### The label is a value slot

The pill drawn next to an annotation — the same text the annotation board's row
shows — is **not** a measurement readout. It resolves in this order, first
non-empty wins:

| | |
|---|---|
| `annotation.displayValue` | instance override |
| `preset.meta.labelSource` | names which of the annotation's own `meta` keys to render |
| area, else length | the default; unchanged for everything untouched |

```js
// one shape: a prediction instead of its area
object.displayValue = "0.62";

// a whole class of shapes: every object of this preset shows its own meta value
preset.meta.labelSource = { name: "Label source", value: "Tumor ratio" };
object.meta["Tumor ratio"] = 0.62;
annotations.invalidateAnnotationLabel(object);   // only needed for the meta route
```

Read it back with `annotations.getAnnotationLabel(object)` → `{text, source}`,
where `source` is `'value' | 'area' | 'length' | ''` so a list can pick an icon
without re-deriving where the text came from. `getMeasurementLabel(object)` is
the text alone.

Three things worth knowing:

- **The value wins over `supportsMeasurements()`.** That opt-out means "this
  shape's extent carries no meaning" (a pointer arrow) — a statement about
  geometry, which must not suppress a value someone deliberately attached.
- **`displayValue` is derived and is NOT persisted.** It is deliberately absent
  from `copiedProperties` / `necessaryProperties`, so an exported bundle never
  carries a value whose source no longer exists. Whoever attaches it re-attaches
  it, and removes it when its source goes away. Do not register it via
  `registerPersistedProperties` unless you genuinely own the value for good.
- **The overlay caches label text per object**, on a token covering geometry,
  `displayValue` and `presetID` — so setting `displayValue` needs nothing extra.
  Changing a **meta** value the preset route reads does need
  `invalidateAnnotationLabel(object)`: hashing `meta` on a path that runs every
  frame for every labelled object would cost more than the area math the cache
  exists to avoid.

`0` and `false` are values, not absences — only `undefined`, `null` and `""` fall
through to the next rule.

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

### Hiding annotations a feature owns: visibility gates

Eviction is right when the canvas copy is a cache. It is wrong for **the user's
own** annotations — those must come back exactly as they were, and re-fetching
them is not a given. For those, register a gate:

```js
const dispose = annotations.registerVisibilityGate(this.id, object => !shouldHide(object));
// state changed and the answer may differ now:
annotations.reapplyVisibility();
```

A gate answers "may this be on screen right now?" for a reason only its owner
knows. It is consulted on every visibility evaluation, next to the user's filters
and the layer switch; any gate answering `false` hides the object (and blocks
selection and editing with it).

Two things it deliberately is not:

- **not `object.visible = false`** — visibility is *derived* in
  `_applyAnnotationVisibilityState`, so a directly written flag is overwritten by
  the next filter pass, layer toggle or edit. The gate is the only durable way to
  state a reason.
- **not an annotation filter** — `setAnnotationFilters` is the *user's*
  declarative, serializable selection, displayed and cleared as such in the UI. A
  feature hiding its own records must not appear in that set, nor be cleared with
  it.

Gates run per object per evaluation, so keep them cheap and side-effect free; a
throwing gate is treated as "no opinion" rather than blanking the canvas. EMPAIA
uses one to keep the regions an analysis consumed on screen only while that
analysis is shown — hiding every run would otherwise leave a slide full of
locked ROIs the user can neither read past nor delete.

### Constraining the class vocabulary

A destination whose set of annotation classes is **closed** — EMPAIA accepts only
the class values in its EAD namespace, and answers `400` for anything else —
declares that set once:

```js
const dispose = annotations.presets.setVocabulary({
    ownerUid: this.uid,            // also the guard owner, so `io.disabled` can silence it
    metaKey:  "empaiaClass",       // preset meta key carrying the class value
    values:   [{ value: "org…classes.tumor", label: "Tumor", color: "#c33" }, …],
    allowFreeform:     false,      // a class outside `values` is refused
    allowUnclassified: true,       // a preset with no class is fine (the default)
});
```

Enforcement is at the **IO checkpoint**, not in the UI: presets already dispatch
through `crud:preset` (`PresetManager._mutate`), so one guard covers the preset
editor, scripting and anything added later, and a refusal surfaces through the
pipeline's normal toast path. UI that offers class creation listens for
`preset-vocabulary-changed` and reads `presets.unusedVocabularyEntries()`; the
shipped editor swaps its "new class" button for a picker over that list.

The reason this exists: without it, a user could type any class, the integration
dropped the unknown value on the way out, and the annotation was stored *without*
its classification — a loss nothing in the UI revealed.

Three companion calls:

- `presets.addVocabularyPreset(classValue, id?, factory?)` — create the preset
  **and** its class in one dispatch. `addPreset` + `addCustomMeta` is two guard
  runs and two outbox entries for one gesture, with a window in which the preset
  exists without its class.
- `presets.extendVocabulary(entries)` — admit a value that came *from* the
  destination. Defaults to `creatable: false`: accepted everywhere, offered
  nowhere. Import needs this, because data already stored upstream may carry
  classes this session may not author (a job's own output classes).
- `presets.classValueOf(presetOrId)` — the class a preset carries, or `undefined`.

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


#### Writing a mode

A mode extends `OSDAnnotations.AnnotationState` and is registered with `setModeUsed(id)` (built-in)
or `setCustomModeUsed(id, ModeClass)` (anything else, including modes shipped by a plugin).

The one contract that is easy to get wrong is **`handleClickUp`'s return value**:

- `AnnotationState.CLICK_CONSUMED` (`true`) — the mode acted on the release; the canvas does
  nothing else.
- `AnnotationState.CLICK_NOT_CONSUMED` (`false`) — the canvas performs its default handling:
  select the annotation under the cursor (or clear the selection) and raise `canvas-release`.

**A mode that started a gesture and then discarded it must report NOT_CONSUMED.** Nothing was
created, so from the user's point of view the release was a plain click, and a plain click
selects. Reporting CONSUMED there is what used to make clicking an existing annotation in a
drawing mode do nothing at all. Use the `clickUpResult(produced)` helper rather than a bare
boolean:

```js
handleClickUp(o, point, isLeftClick, objectFactory) {
    if (!objectFactory) return OSDAnnotations.AnnotationState.CLICK_NOT_CONSUMED;
    return this.clickUpResult(this._finish(this._lastUsed));  // false when discarded
}
```

`OSDAnnotations.StateCustomCreate` and `OSDAnnotations.FixedAreaMode` are the reference
implementations; `plugins/sam-segment-tool-experimental/samState.ts` shows the same rule applied
to a plugin-owned mode. Modes whose short click does real work (the free-form-tool brushes, the
magic wand, viewport segmentation) legitimately consume every release.

`objectSelected(event, object)` is the per-mode veto over a selection the canvas is about to make —
return `false` to refuse it. It is consulted only on the NOT_CONSUMED path.

#### The Factory
Factories govern how object behave - it is the module API over annotations. They provide handful
set of methods to create, copy, iterate and process annotations easily.

todo finish description

