# Upstream directives

Changes xOpat needs in a **vendored library**, not in xOpat itself. Per
[`AGENTS.md`](AGENTS.md) §0.6–§0.7 we do not patch `src/libs/*`: the fix belongs in the
library, and this file is where the request is written down until it lands.

Each entry states the library, the change, and what breaks in xOpat while the change is
outstanding.

> **flex-renderer, build `2026-09-02`.** Six entries filed against this library landed and were
> removed from this file: the failed-relink / dead uniform locations, `SecondPassProgram.use()`
> self-heal, `static requiresInteraction()`, the unguarded control mount nodes, the hover-only
> lens (`buttonMask: -1`), the covered interaction event target (`interaction.eventTarget`, now
> defaulting to the viewer container), the destructive `runRebuild` catch (now the
> `shader-program-failed` event), and the silently-accepted invalid `params`. **The banner
> version did not move** (`0.0.2`, same commit hash, only the build date changed), so nothing can
> feature-detect the update by version — probe for the capability instead
> (`typeof ShaderLayer.requiresInteraction === "function"`, `typeof drawer.setInteractionOptions`).
> A later re-vendor also fixed the `grid` / `gridheatmap` device-pixel scale: they positioned
> themselves in framebuffer pixels but scaled themselves in CSS pixels, drawing cells at
> `1/devicePixelRatio` of the configured size (measured 426.7 px for a configured 512 at DPR 1.2).
> The fix adds a `u_devicePixelScale` uniform, divides `gl_FragCoord` by `pixelSize *
> devicePixelScale`, lifts `line_width` to framebuffer pixels so apparent thickness is unchanged,
> and deliberately leaves `adaptive_lod` on the CSS scale so its merge threshold stays
> perceptual. Probe with `typeof drawer.renderer.getPresentationCanvas === "function"` and a
> rendered-period check rather than by version.
>
> What remains open below is what did *not* land.

> **openseadragon, build `2026-09-04`.** Two entries landed and were removed from this file.
> *The queued `BatchImageJob` was dropped without releasing its tiles*: `abort` now lives on
> `BatchImageJob.prototype` (so `ImageLoader#clear`'s `typeof job.abort === "function"` guard is
> structurally true for batches and cannot silently miss one again), `BatchImageJob#fail`
> returns early when the wrapped child completion already settled the batch, and
> `completeBatchJob` releases its slot through a `releaseSlot` clamped at zero. The re-vendor
> went further than the request: batch completions now also drain the queue via a shared
> `pumpQueue`, which previously only single-job completions did — a loader whose outstanding
> work was all batches could leave `jobQueue` stalled, a second starvation source on the same
> path. *`whenFullyLoaded` resolved on the un-loaded edge*: both the `Viewer` and `TiledImage`
> methods now delegate to `$._whenFullyLoaded`, which re-checks the flag inside the handler,
> guards against settling twice, and takes an optional `timeout`.
> **The banner version did not move** (`6.1.0`; only the build date and commit hash changed), so
> probe the capability — `typeof OpenSeadragon.BatchImageJob.prototype.abort === "function"` and
> `typeof OpenSeadragon._whenFullyLoaded === "function"`.
> `test/suites/unit/osd-batch-job-release.test.mjs` arms itself on the first of those.

---

## web-tiff — plane stacking landed; what did not

**Library:** `modules/webtiff/dist/web-tiff.mjs` (web-tiff `0.1.0`).
**Status:** the request below **landed** in the re-vendor of 2026-09-03. Three loose ends
remain open; the original request is kept underneath because it is what the entries refer to.
**Raised:** 2026-09-03, on the `viz-flex-multichannel` demo.

### What landed

Levels carry `planes: [{dir, subifd}, …]` and `readTile` sends them as one request; the
descriptor describes the stack (`samplesPerPixel` is the total, `interpretationResolved` is
`"data"` for any stack); OME-XML `Name=`/`Color=` are attached to `encoding.channels[i]`;
`layout.prefer` was removed, leaving `layout.planeIndex` as the single opt-out; and the
resolver now warns when it stacks. Measured on `test/fixtures/data/slides/LuCa-7color_Scan1.ome.tiff`:
six levels of five planes, `samplesPerPixel: 5`, `readTile` → `channelCount 5` in two packs
(`[0,1,2,3]`, `[4,-1,-1,-1]`), `readRegion` → five bands.

### Still open

1. **`VERSION` did not move.** It is `"0.1.0"` before and after, although `dist/README.md`
   now asks for a bump on every change, so nothing can feature-detect the re-vendor. Probe
   the capability instead — `Array.isArray(file.levels?.[0]?.planes)`.
2. **`rgba8` over a stack is undocumented.** It resolves the read as an *image*: one pack of
   the first three channels with an opaque alpha lane (`mode: "image"`, `channels:
   [0,1,2,-1]`), whatever the stack's own interpretation. That is the right answer and xOpat
   now depends on it for slide-list cards — it belongs in the README rather than in a
   consumer's memory.
3. **Decoder warnings carry no subject.** `[web-tiff] A SubIFD offset did not resolve` and
   `No sample encoding for channel 0 (file declares 0)` arrive through the worker with no
   file, directory or handle on them, so in a multi-slide session nothing says which slide
   warned — `modules/webtiff/index.mjs` can only print them verbatim and dedupe by text.

### Why (the original request)

A multi-channel OME-TIFF routinely stores each channel as its own **full-size IFD** with
`SamplesPerPixel = 1`, with the pyramid hanging off each plane as SubIFDs. Verified on
`test/fixtures/data/slides/LuCa-7color_Scan1.ome.tiff`: pages 0-4 are 34560 × 24960, `spp = 1`,
photometric `MinIsBlack`, 5 SubIFD levels each; pages 5-7 are small RGB macro/label/overview
images. The OME-XML names the five channels `DAPI`, `FITC`, `CY3`, `Texas Red`, `CY5` and
gives each a `Color`.

The decoder reads exactly one of them. Three steps compound:

1. `ge()` classifies. The RGB extras break the aspect-ratio test in `$()` (1.385 vs 1.931),
   so `u` is false; the file declares SubIFDs, so the strategy is `"subifd"` and
   `chosenPlane = planes[planeIndex ?? 0]`.
2. `pe()`'s `subifd` branch builds every level from that one plane — `dir: o.index` for all
   of them — and, unlike the `ifd` and `single` branches, **emits no warning** that four
   same-size planes were passed over.
3. `readTile` sends a single `dir` scalar (`i[a + 0] = t.dir`), so planes 1-4 are never
   fetched, never decoded, and never mentioned.

The one plane that is read is 8-bit grey, so `Qe()` matches `(BlackIsZero) && n === 1` and
resolves `interpretation: "image"` — grey replicated across RGB with `padAlpha` in lane 3.

`layout.prefer: "stack"` does not help: it only downgrades `"ifd"` → `"single"` (`:273`),
still one plane. There is no request shape that asks for more than one directory.

### What breaks meanwhile

A five-channel slide renders as `channelCount: 4`, one pack. Every consumer downstream is
correct and therefore consistently wrong:

- `use_channel_base0: 0 | 1 | 2` all sample the same DAPI grey (the RGB replication), so
  three different markers draw identical content in three different tints.
- `use_channel_base0: 3` samples the pad alpha — a constant `1.0` — so that layer is a flat
  wash of its tint. This is what the defect looks like from the viewport, and it reads as a
  shader bug rather than a layout decision.
- `getDisplayMetadata()` reports `channels: 1`, and the render debugger shows one first-pass
  layer, which are the only two places the truth is currently visible.
- `auto-config.mjs` takes `interpretation === "image"` as "display-ready" and leaves the
  background on the implicit `identity`, so nothing auto-configures either.

`modules/geotiff` has the same limitation (`dist/geotiff-tilesource.lite.mjs:4229-4241`) but
at least *says so*; that module is deprecated, so web-tiff is the only path forward.

### The change

Three parts, in descending order of importance.

**1. Stack planes.** Let a level name more than one directory. The request struct carries a
`dirs[]` (or a `dirCount` + array tail) instead of the single `dir` scalar; one read decodes
N planes and packs them packs-of-4, so a 5-channel tile is two `RGBA8` packs with
`header.channelCount = 5`. This must be **one** request, not N: the planes' tile data live at
N different file offsets either way, so the network cost is identical, but a single call
avoids N decoder round-trips and an N-way JS merge in the consumer.

Kick in by default — a file with more than one same-size full-resolution directory is a
channel stack, and rendering plane 0 of it is never what the caller wanted. Keep
`layout.planeIndex` as the opt-out (pin one plane) and `format.channels` as the narrower one
(pick a subset), both of which already exist and already work; xOpat now routes a slide's
`options` block to both (`decoderOptionsFrom` in `modules/webtiff/tile-source.mjs`).

**2. `descriptor` must describe the stack.** `samplesPerPixel` becomes the stacked channel
count, `encoding.channels` gains one entry per plane, and `interpretationResolved` follows
from that — with `n = 5`, `Qe()` already returns `"data"` without any change to its logic.

**3. Carry OME-XML channel metadata.** Parse `Name=` and `Color=` off the OME-XML in
`ImageDescription` into `encoding.channels[i].name` / `.color`. Nothing in xOpat needs to
change to consume this: `tiff-metadata.mjs:107-124` already maps them to
`descriptor.channelNames` / `channelColors`, and `auto-config.mjs:207-223` already prefers
them over `FALLBACK_TINTS` and sets each layer's `name`. Today a fluorescence stack gets
`ch0…ch4` in arbitrary tints; with this it gets `DAPI`/`FITC`/`CY3`/… in the acquisition
colours, with no session authoring at all.

**And restore the warning.** Whatever the resolver ends up choosing, the `subifd` branch of
`pe()` should push the same kind of message the other two branches do when it passes over
`planes.length > 1` — `modules/webtiff/index.mjs` already surfaces `getWarnings()` to the
console on open, so the fix is one `t.push(...)`, and it is what would have made this a
five-minute diagnosis instead of an investigation.

### Nothing downstream needs to change

Worth stating explicitly, because it bounds the work: `flex-renderer.js:14055` already
uploads the true `channelCount` into `u_tiInfo.z` and `osd_channel_count()` prefers it over
`packCount * componentsPerPack`, so channels 5-7 of a two-pack tile correctly read `0.0`;
`buildAutoShaders()` already emits a tinted `single_channel` group for `count > 4`; and
`getDisplayMetadata()` already reads `descriptor.samplesPerPixel`. The consumer side has been
ready for this the whole time.

---

---

## openseadragon — an image that drew one tile stops loading the rest

**Library:** `src/libs/openseadragon.js` (openseadragon `6.1.0`, build `2026-09-04`) —
`TiledImage#setDrawn` (`:29580`), read by `World#draw` (`:34231`) and `World#needsDraw`
(`:34242`).
**Status:** open, but **not** the cause of the stalled-slide symptom it was found next to.
Applying the change below was measured to make no difference; the slide still stopped
refining. The flag disagreement described here is real and worth fixing, but what actually
stalls the slide is the `drawWorld` regression in the entry below.
**Raised:** 2026-09-04, on an IDC slide whose tissue stayed coarse under sharp overlays.

### Why

```js
setDrawn: function(){
    this._needsDraw = this._isBlending || this._wasBlending ||
        (this.opacity > 0 && this._lastDrawn.length < 1);
    return this._needsDraw;
},
```

`_fullyLoaded` is not in that expression. Drawing a single tile is enough to clear
`_needsDraw`, and `World#draw` folds every item's `setDrawn()` into the world's own flag,
which is what the viewer's `updateOnce` consults before calling `world.update()`. So an
image with unloaded tiles still in the viewport is dropped from the update loop the moment
it renders anything.

`TiledImage#update` already has the right gate (`:29557`):

```js
if (updated || viewportChanged || !this._fullyLoaded){
    const fullyLoadedFlag = this._updateLevelsForViewport();
```

`!this._fullyLoaded` would keep the pass running — but `update()` is never called, so it
never runs. The two flags disagree about whether there is work left, and the one that wins
is the one that does not know about loading.

Measured on a DICOMweb slide, at rest, with nothing in flight:

```
L4: 255 tiles, 7 loaded, 0 loading | full=false needsDraw=false buckets=0 inFlight=0
```

A single forced `tiledImage.update(true)` dispatched the missing tiles and visibly sharpened
the viewport, which is the whole proof: the work was available, nothing was broken about
selecting or fetching it, and the only thing missing was another pass.

### What breaks meanwhile

While the user pans or zooms, `viewportChanged` forces passes and tiles arrive normally.
The defect only shows once motion stops — the slide freezes at whatever it had, with no
error, no pending request and no way to recover but to nudge the viewport. It reads as "the
image sometimes loads and sometimes just stays blurry".

Sources whose dispatch is deferred are hit hardest, because their tiles are still staged
when the frame ends. `plugins/dicom`'s `DICOMWebTileSource` batches with a 12 ms bucket
(`batchTimeout`), so on a case with SEG / parametric-map overlays the unbatched derived
layers dispatch inline and reach full resolution while the batched base slide stalls
underneath them — sharp masks over coarse tissue.

Because the image never reports `getFullyLoaded()`, `Viewer#_areAllFullyLoaded`,
flex-renderer's `areImagesFullyLoaded` and `modules/pathology-foundation`'s awaited region
renders all fall through to their stall/timeout paths.

### The change

`setDrawn` must keep the image in the loop while it still has loading to do:

```js
this._needsDraw = this._isBlending || this._wasBlending ||
    (this.opacity > 0 && (this._lastDrawn.length < 1 || !this._fullyLoaded));
```

Keep the `opacity > 0` guard — a hidden image should not spin the loop. Worth checking two
neighbours while there: `_updateLevelsForViewport` sets `_needsDraw = true` only on the
branch that dispatched candidates (`:30784`), so a pass that leaves unloaded tiles behind
because the per-frame cap was reached does not re-arm itself either; and `World#needsDraw`
could consult `getFullyLoaded()` directly rather than depending on every item's `setDrawn`
having remembered to.

**Feature probe for the re-vendor** (the banner version does not move on a fork rebuild):

```js
/_fullyLoaded/.test(OpenSeadragon.TiledImage.prototype.setDrawn.toString())
```

`test/suites/unit/osd-needs-draw-completion.test.mjs` skips on that probe today and arms
itself when the fix lands.

---

## openseadragon — `drawWorld` clears the loader every frame (REGRESSION)

**Library:** `src/libs/openseadragon.js` (openseadragon `6.1.0`, build `2026-09-04`) —
`drawWorld` (`:12963`).
**Status:** open — a **regression**: the build of `2026-08-13` had the guard, the re-vendor
of `2026-09-04` dropped it.
**Raised:** 2026-09-04, chasing a DICOM slide that stayed coarse under fully-resolved
SEG / parametric-map overlays.

### Why

```js
function drawWorld( viewer ) {
    viewer.imageLoader.clear();
    viewer.world.draw();
```

The previous build guarded that call, and carried the reason in a comment that describes
the present failure exactly:

```js
function drawWorld( viewer, viewportChanged ) {
    // Queued jobs are tiles that were selected for the view as it was when they were queued, so they only go
    // stale when the view moves. Clearing unconditionally aborts jobs that are still wanted, and they can then
    // only be re-selected at the per-frame rate, which starves the loader whenever imageLoaderLimit is set.
    if ( viewportChanged ) { viewer.imageLoader.clear(); }
```

The regression is worse than the original bug it re-introduces, because the batching fix
shipped in the *same* re-vendor made `clear()` effective: it now walks queued
`BatchImageJob`s and staged buckets and calls each child's release. So for a source that
batches, every frame runs this cycle:

1. `_updateLevelsForViewport` selects candidates and calls `_loadTile`,
2. `ImageLoader.addJob` stages them in a bucket behind `source.batchTimeout()`,
3. the next frame's `drawWorld` calls `clear()`, which aborts the bucket and resets
   `tile.loading = false`,
4. the tiles are selected again, and the cycle repeats.

Worse, steps 1 and 3 are the **same frame**. `updateOnce` selects at `:12875`
(`viewer.world.update(viewportChange)`) and draws at `:12918`, both synchronously, so a
bucket staged during selection is cleared before its timer can possibly fire. A batched
tile therefore loads only when its bucket happens to fill to `batchMaxJobs()` *during* that
frame — which happens only while the post-viewport-change boost raises
`_currentMaxTilesPerFrame` to 40. At rest the cap is back to `maxTilesPerFrame` (4 on
desktop), buckets never fill, and those tiles are re-selected and re-cleared every frame
indefinitely. Measured: 7 of 255 tiles at the finest level ever arrived, all of them during
boosted frames.

Sources that do not batch are untouched: `addJob` starts them immediately, so they are
never in `jobQueue` or a bucket when `clear()` runs.

### What breaks meanwhile

On a DICOM case with derived overlays, the unbatched `DICOMDerivedTileSource` layers reach
full resolution while the batched `DICOMWebTileSource` base slide stalls underneath them —
sharp nuclei masks over blurred tissue, with no error, nothing in flight, and no failed
tile. Measured at rest on the finest level: 255 tiles, 7 loaded, 0 loading, 0 in flight.

More generally this starves any deployment with `imageLoaderLimit` set (xOpat sets 6 on
desktop, 4 on mobile), since anything that has to queue is discarded before it can start.

### The change

The minimal revert restores the guard and passes the flag `updateOnce` already computes at
`:12874` — keep the comment, it is the only thing that stopped this being re-introduced
once already:

```js
    drawWorld( viewer, viewportChange );                       // :12918
...
function drawWorld( viewer, viewportChanged ) {                // :12963
    // Queued jobs are tiles that were selected for the view as it was when they were queued, so they only go
    // stale when the view moves. Clearing unconditionally aborts jobs that are still wanted, and they can then
    // only be re-selected at the per-frame rate, which starves the loader whenever imageLoaderLimit is set.
    if ( viewportChanged ) {
        viewer.imageLoader.clear();
    }
    viewer.world.draw();
```

**Preferred: clear before selecting, not after.** The revert still discards selections made
earlier in the same frame whenever the viewport moved; it only works in practice because
the boost fills buckets during motion. Dropping stale jobs *before* `world.update()` picks
the new ones removes the ordering hazard entirely — in `updateOnce`, ahead of `:12875`:

```js
    if (viewportChange) {
        viewer.imageLoader.clear();
    }
    let animated = viewer.world.update(viewportChange) || viewportChange;
```

leaving `drawWorld` with no `clear()` at all.

Worth a regression test in the fork: with a stationary viewport, a job queued past
`imageLoaderLimit` survives across frames; and with a moving viewport, tiles selected this
frame are still queued after the draw.

**Feature probe for the re-vendor:**

```js
OpenSeadragon.TiledImage && /viewportChanged/.test(String(OpenSeadragon.Viewer.prototype.forceRedraw))
```

is not usable — `drawWorld` is module-private. Probe behaviourally instead: enqueue past
`imageLoaderLimit`, draw a frame without moving the viewport, and assert `jobQueue.length`
is unchanged.

---

## flex-renderer — `registerProgram` publishes the new implementation before it is known to link

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `FlexRenderer#registerProgram`
(`:2051` vs the throws at `:2086` / `:2094`).
**Status:** open — narrow remainder of the fixed *"failed relink leaves the second pass uploading
through dead uniform locations"* entry.
**Raised:** 2026-09-02, while verifying that fix.

### Why

The rewritten `registerProgram` is correct about GL objects — it links into a scratch program
(`:2089`) and deletes the previous one only after a successful link (`:2098`). But it assigns the
**JS implementation** into the map before building:

```js
this._programImplementations[key] = program;   // :2051, before build()/link
…
throw new Error(errMsg);                       // :2086 / :2094 — `previous` is never put back
```

When the caller passes a *fresh* implementation instance for an already-occupied key and the link
fails, the map ends up naming the unlinked instance while the still-live GL program of `previous`
is unreferenced.

### What breaks meanwhile

Nothing today: every post-setup call site passes `null` (so `program === previous` and the write is
a no-op), and the only fresh-instance calls (`:11642`-`:11644`) use unoccupied keys. Filed because
the invariant the rest of the method now upholds — "a failed link changes nothing" — is not
upheld by this line, and a future call site would not know that.

### The change

Restore `previous` into `_programImplementations[key]` on both throw paths, or move the assignment
after the successful link.

---

## flex-renderer — `rebuild()` dereferences the navigator drawer without a guard

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `FlexDrawer#rebuild` (~`:16001`).
**Status:** open
**Raised:** 2026-09-02 (previously only a code comment in xOpat).

### Why

```js
rebuild() {
    if (this.options.handleNavigator) {
        this._syncNavigatorShaderState();
        this.viewer.navigator.drawer.rebuild();   // <-- no null guard
    }
    return this._requestRebuild();
}
```

The OpenSeadragon navigator — and therefore its drawer — is created asynchronously. Any rebuild
that fires before the navigator drawer is wired throws `Cannot read properties of undefined`.

### What breaks meanwhile

`src/classes/app/setup-isolated-viewer.ts` sets `handleNavigator: false` for every isolated /
playground viewer purely to avoid this, which means the shader pipeline is not mirrored into their
navigators at all. The main viewer survives only because its rebuilds happen later.

### The change

Guard the dereference (`this.viewer?.navigator?.drawer?.rebuild()`), or skip navigator mirroring
until the navigator drawer exists and re-run it when it appears.

---

## openseadragon — a flip is honoured when drawing but not when converting coordinates

**Library:** `src/libs/openseadragon.js` — `TiledImage#_imageToViewportDelta` (~`:29613`),
`TiledImage#imageToViewportCoordinates` (~`:29627`), `Viewport#_pixelFromPoint` (~`:28456`).
**Status:** open
**Raised:** 2026-08-31, while honouring DICOM `ImageOrientationSlide`.

### Why

Rotation is applied on both sides. `TiledImage#imageToViewportCoordinates` ends with

```js
return point.rotate(this.getRotation(current), this._getRotationPoint(current));
```

and `Viewport#_pixelFromPoint` rotates likewise. **Flip is applied on neither.** `flipped` reaches
the drawer (`_setRotations`, `tile.flipped`) and nothing else: `_imageToViewportDelta` is a pure
scale, with no mirroring term for either `TiledImage#flipped` or `Viewport#flipped`.

So a flipped image renders mirrored while every coordinate query answers as though it were not.

### What breaks meanwhile

Anything that maps image coordinates onto a flipped image lands on the wrong pixel. Concretely the
Fabric annotation overlay, which derives its whole affine from three image-space basis points routed
through `imageToViewportCoordinates` (`modules/fabricjs/openseadragon-fabricjs-overlay.js:978`):
under a flip it would place every annotation unmirrored on top of mirrored pixels. The same applies
to the virtual-viewport `transform.flip` path (`src/classes/app/viewer-open-pipeline.ts`).

xOpat therefore **never asks for a flip**. `TileSource#getIntrinsicPlacement` returns rotation only,
and the DICOM source honours `ImageOrientationSlide` for display only when it resolves to a proper
rotation on screen (`plugins/dicom/slide-orientation.mjs#displayRotation`). The common case does —
`[0,-1,0,-1,0,0]` is a 180° turn once the slide axes are read correctly — so this is not blocking
anything today.

What it does mean: a file whose orientation resolves to a MIRROR is rendered as stored rather than
mirrored, and the plugin says nothing about it beyond the absent log line. If flip becomes honest in
the coordinate math, `displayRotation` can return `{degrees, flipped}` and the renderer can be
trusted with the whole tag.


---

## flex-renderer — basic UI controls carry no DaisyUI classes, and no hook to add them

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `UIControls.renderControl` / `renderInput`
(~`:6173` / `:6179`), the `_items` control definitions (`number` `:6191`, `range` `:6230`,
`color` `:6268`, `bool` `:6312`, `select` `:6363`), `ColorMap` (`:7368`, `:7498`, `:7615`,
`:7640`), `AdvancedSlider` (`:8154`, `:8232`, `:8334`), `Button` (`:8529`, `:8565`),
`Image` (`:8790`), `Icon` (`:9948`).
**Status:** open
**Raised:** 2026-09-01, from shader layer controls rendering half-styled in the side menu.

### Why

The library emits its own BEM namespace (`er-control__input--select`, `--bool`, `--colormap`,
`er-control__button--action`, `er-control__widget--advanced-slider`) and puts **no DaisyUI class on
the input element itself**. The host has no way to add one either: `renderControl(type, title,
bodyHtml, classes, columns, extraAttrs)` lands `classes` on the **outer** `.er-control` wrapper, and
every control's `html()` / `toHtml(classes, css)` threads only that one channel.

The migration was started and abandoned mid-way: `Icon.toHtml` (`:9948`) does emit
`btn btn-square btn-outline`, `card`, `input input-bordered input-sm`, `badge`, and the library's own
`ShaderConfigurator` (`:27266`) wraps controls in `card bg-base-200 border border-base-300`. The
*basic* controls were never converted.

Seven distinct defects, in rough order of how much they cost the host:

1. **No per-input class hook.** Add an `inputClasses` / `inputCss` channel threaded through
   `toHtml` → `html()` → `renderControl` → `renderInput`, so a host can supply
   `select select-bordered select-sm`, `checkbox checkbox-primary`, `btn btn-sm btn-outline`
   without a stylesheet shim. Better still, finish the `Icon`-style migration and emit them by
   default.
2. **The colormap gradient is written inline onto the `<select>`.** `ColorMap.updateColormapUI`
   (`:7498`) and `ColorMap.set` (`:7615`) do `node.style.background = this.cssGradient(...)`. An
   inline declaration outranks every stylesheet rule, so the host cannot retheme it without
   `!important`, and the palette painted across the full element makes the option label unreadable.
   Write the gradient to a custom property (`node.style.setProperty('--er-colormap', …)`) or to a
   sibling preview element, and let the host decide how to paint it.
3. **The mask colour is both inline and semantically backwards.**
   `AdvancedSlider._updateConnectStyles` (`:8232`) and the `toggleMask` mouseup handler (`:8154`)
   set `pips[i].style.background = "oklch(var(--er))"`. `--er` is the theme's **error** colour, used
   here to mean "this interval is visible". Toggle a class (`er-slider__connect--active`) instead of
   an inline colour, so the host can retheme it without destroying the state signal.
4. **Buttons carry no `btn`.** `Button.toHtml` (`:8565`) and the `Image` upload button (`:8790`)
   emit `<button class="er-control__button…">`; a Tailwind host's preflight zeroes background and
   border, leaving unstyled text. `Button.toHtml` also hard-codes an inline `float: right`, which is
   meaningless inside the grid cell `renderControl` puts it in and can only be undone with
   `!important`.
5. **`layoutColumns` is declared and then ignored.** `Button` and `Icon` override
   `get layoutColumns() { return 1 }` (`:8571`, `:9973`) but call `renderControl(...)` **without**
   the `columns` argument (`:8567`, `:9970`), so `resolvedColumns` falls back to `2`.
6. **A titled button renders its label twice.** `Button.init` (`:8529`) sets
   `node.innerHTML = this.params.title` while `renderControl` already rendered an
   `.er-control__title` span with the same text.
7. **A literal newline inside a `class` attribute.** `renderControl` (`:6175`) emits
   `class="er-control__body\n  er-control__body--TYPE"`. Harmless to the HTML parser, but it makes
   the markup hard to grep and hard for a Tailwind-style content scanner to reason about.
8. **Hardcoded user-facing English.** `Image.toHtml` (`:8788`, `:8791`) ships
   `"The atlas starts empty. Upload an image to create a new atlas entry."` and `"Upload Image"` as
   literals, and `Icon`'s picker does the same. A multi-language host cannot translate them. Route
   control chrome text through an injectable translator (the host already has one) or expose the
   strings as overridable params.

### What breaks meanwhile

Every basic control renders half-styled: `select`/`input` reach the host's `@layer base`
normalisation as bare elements, and `input-bordered` alone sets only `border-color` on an element
preflight already gave `border-width: 0` — coloured border of zero width, no radius, no height, no
background. `input[type=checkbox]` matches nothing at all and renders native.

xOpat re-skins them from `src/assets/tailwind-spec.css` (`@layer components`, `.er-control__*`) and
`src/assets/style.css` (`.noUi-*`, which Tailwind cannot see because the class names live only in
`nouislider.min.js`). That skin is pinned by a `safelist` in `tailwind.config.js`, because its
survival otherwise depends on those class names staying **literal** in this library's source — a
control switching to the generic `renderInput()` helper (template-literal class) would silently
purge its own styling. The colormap gradient is reduced to a strip along the bottom edge using four
`!important` geometry longhands, leaving `background-image` — the palette itself — untouched so the
library's live updates keep working. The error-red mask bars are left as-is: no honest host-side
override exists that preserves the masked-vs-unmasked distinction.

### The change

Items 1–7 above. Item 1 is the one that removes the need for the shim; items 2 and 3 are what force
`!important` and an explicit non-goal on the host side.

---

## flex-renderer — with every layer hidden the assembled program may not compile

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `getShaderLayerComputeDefinition`
(~`:11723`), `getShaderLayerPlaceholderDefinition` (~`:11705`), and the
`if (${control.sample()}) {` templates (~`:20948, 21840, 22001, 22268, 22626, 23503, 24200`).
**Status:** open — the one part of the *"a rebuild failure destroys the external configuration"*
entry that did not land with the `2026-09-02` build.
**Raised:** 2026-09-02, after a hand-written 4-layer visualization died permanently mid-session.

### Why

`visible: 0` swaps a layer's body for a placeholder. With every layer hidden the assembled source
is the prime suspect for the observed `FRAGMENT_SHADER: ERROR: 0:621: '{' : syntax error` — an
empty interpolation landing in one of the `if (${control.sample()}) {` templates. Nothing in the
`2026-09-02` diff touches this path, and there is no regression test for it.

### What breaks meanwhile

The failure itself is now survivable: `runRebuild`'s catch keeps the previously linked program and
raises `shader-program-failed`, and xOpat re-applies its last-good snapshot from
`src/classes/app/live-config-sync.ts`. So the user sees "the change was not applied" instead of a
dead viewport — but the change they asked for (hiding the last visible layer) still cannot be made.

### The change

Make the all-hidden case produce a valid program, and add the regression test: N layers, all
hidden, program links.

---

## flex-renderer — a deferred rebuild calls `forceRedraw()` on a destroyed viewer

**Library:** `src/libs/flex-renderer/flex-renderer.js` — the deferred rebuild timer behind
`_requestRebuild` / `redrawCallback`.
**Status:** open
**Raised:** 2026-09-02 (previously only a code comment in xOpat).

### Why

A rebuild scheduled with a timeout can fire after `viewer.destroy()` has deleted OpenSeadragon's
private per-viewer state slot (`THIS[hash]`). `Viewer#forceRedraw` then throws
`Cannot set properties of undefined`. The timer is neither tracked nor cancelled on drawer
destruction.

### What breaks meanwhile

`src/loader.ts` (~`:4271`) monkey-patches `OpenSeadragon.Viewer.prototype.forceRedraw` with a
try/catch that swallows the throw — a global patch on a vendored class, made for one library's
deferred timer. It stays until the timer is tracked and cancelled in `destroy()`.

---

## flex-renderer — `MVTTileSource` cannot describe a non-square world

`MVTTileSource.configure` (`src/libs/flex-renderer/flex-renderer.js` `~:25440`) derives
the image extent purely from the tiling parameters:
`width = height = Math.pow(2, maxLevel) * tileSize`. TileJSON has no way to say
otherwise, so every MVT source is square.

### Why

Web-map tiling is square because the Web Mercator world is. A pathology slide is not:
`slide.tif` in the demo data is 105185 × 221772, an aspect of 1 : 2.108. OSD normalizes
every tiled image to viewport width 1, so a square MVT layer aligned 1:1 with that
slide covers only its top 47% — there simply are no tiles below. Rescaling to cover the
full height instead puts the vector layer at 2.108× the slide's scale, which looks
plausible and is wrong, which is worse.

### What xOpat does meanwhile

`modules/demo-vector-layers` registers a **factory** slide protocol that constructs
`new OpenSeadragon.MVTTileSource({width, height, template, tileSize, minLevel, maxLevel, extent, style})`
directly. `AbstractMVTTileSource` passes its options straight to `super()`, so
`configure()` — and its square-world derivation — is bypassed entirely and the layer
aligns exactly. That works, but it means any consumer wanting non-square MVT must own
a factory instead of pointing at a TileJSON URL.

### The change

Let TileJSON declare the world: honour `width`/`height` (or a `bounds`-derived extent)
in `configure`, falling back to the square derivation when absent.

Note the fix is not one line. `getTileUrl` (`~:25459`) computes the TMS y-flip as
`n = 1 << z; flippedY = n - 1 - y`, which assumes `2^z` rows. Once the world can be
non-square that must come from the real per-level row count (`getNumTiles(level).y`),
or `scheme: "tms"` sources silently request the wrong row.

### Two consequences of the same assumption, now FIXED upstream (2026-09-03)

Both landed in the library and are in the current vendored build — recorded here because
they are the same root cause resurfacing, and because the third item below is *not*
fixable in the library at all.

**1. Vector meshes were normalized to the nominal tile, drawn into the clipped one.**
The MVT worker divided vertices by `layer.extent`, so a tile's mesh always spanned
UV 0..1 across a whole `tileSize`. `FlexDrawer._updateTileMatrix` maps UV 0..1 onto
`Tile.positionedBounds`, which OSD **clips** at the level's right/bottom edge. The two
agree only when the world is an exact multiple of the tile size — true for every square
web-mercator pyramid, false for a slide. The raster path had always compensated by
scaling texcoords (`_computeTilePosition`'s `sourceWidthFraction`); a vector tile has no
texcoords, so nothing did. `GeoJSONTileSource` was unaffected because its worker
normalizes to the clipped rect (`getTileLevelRect` / `imageToTileUv`) — clipped-tile UV
space was already the convention and MVT was the outlier.

Measured on the demo pyramid (105185 × 221772, tileSize 512, maxLevel 9): z0's single
tile covers 206 × 434 of a 512 × 512 tile, squeezing the whole layer **2.49× in x and
1.18× in y**; at z9 the last column is 225/512 and the last row 76/512. Decoding
`0/0/0.pbf` confirmed the data was right and the normalization wrong — its geometry
maxima (u 0.352, v 0.842) sit just inside the image's share of the nominal tile
(0.4013, 0.846).

Fix: `AbstractMVTTileSource._tileUvScale(tile)` derives nominal ÷ clipped from OSD's own
`getTileBounds(level, x, y, true)` and ships it to the worker per tile as
`uvScaleX`/`uvScaleY`; the worker folds it into the extent divisor for every mesh kind
(fills, stroked lines, native line primitives, points, icons). Absent or non-finite it
degrades to 1, so square pyramids are byte-identical.

**2. The worker's `config` handler replaced `STYLE` instead of merging it.**
`STYLE = msg.style || STYLE` dropped `STYLE.fallback` whenever the caller passed a style
declaring only `layers` — which is exactly what a TileJSON-derived style looks like. Any
layer whose name was not in the map then dereferenced `undefined.type` and the tile
failed as a worker throw rather than rendering with the default style. Now merged.

### What TileJSON still cannot say, and what xOpat does about it

**A sparse pyramid.** TileJSON assumes every tile in the zoom range exists. The demo
pyramid stores only tiles carrying geometry — 1981 of ~119 000 — so the rest 404. The
library is right to treat that as a failure (a client cannot tell a missing tile from a
broken server), and `ViewerFaultySourceRegistry` is right to flag a source whose tiles
keep failing. Teaching the worker to swallow 404s would trade a loud correct error for a
silent wrong one.

So the layout is **declared**, not discovered: `test/harness/data/derive.mjs`
emits a `tileIndex` (per-level base64 row-major bitmask) into `tiles.json`, and
`modules/demo-vector-layers` turns it into a `tileExists(level, x, y)` predicate — which
OSD consults in `TiledImage._getTile`, before a tile is ever scheduled. A malformed or
absent index degrades to "ask the server".

If the library ever wants this generically, the shape is `AbstractMVTTileSource`
accepting a `tileIndex` predicate (or bitmask) option and overriding `tileExists` from
it; TileJSON itself would need a new key, which is why it stays a consumer concern for
now.

---

## flex-renderer — shared-context presentation reads every frame back to the CPU

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `WebGL2 backend
#presentColorTargetToCanvas` (~`:12198`) and `#_readColorTargetToCanvas` (~`:12215`).
**Status:** open
**Raised:** 2026-09-02, from a DevTools profile of an EMPAIA session.

### Why

When `sharedContextKey` is set, the shared WebGL canvas is off-DOM and the renderer
allocates a separate 2D canvas as its drawing element. Moving the frame between them is
implemented one way only:

```js
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, scratch.pixels);
for (let y = 0; y < height; y++) { /* full-image row flip */ }
scratch.imageData.data.set(scratch.flippedPixels);
context.putImageData(scratch.imageData, 0, 0);
```

`presentColorTargetToCanvas` has no second branch — it is an unconditional delegation —
and `_readColorTargetToCanvas` is documented as `@returns {string} Always "read-pixels"`.
There is no option, no `transferToImageBitmap`, no `bitmaprenderer` path.

`readPixels` is a synchronous GPU→CPU stall, and it is followed by two O(W·H·4) CPU
copies and a `putImageData`. In a profiled 22.6 s session it was **the single largest
cost in the trace**: `readPixels` alone 3,577 ms (15.8% of wall clock) self time, 4,107 ms
(18.2%) including the transfer, at a 2141×1892 canvas — 16.2 MB per frame, ~13.8 GB over
852 frames. `render()` then calls `gl.finish()` immediately after, so the stall is not
even amortised.

The stated rationale is one comment: *"Shared-context presentation uses readPixels
because the WebGL default framebuffer is not a reliable intermediate transfer target
across browsers and context configurations."* That is a real concern about
`preserveDrawingBuffer`, but it does not require a CPU round trip.

### What xOpat does meanwhile

`src/classes/app/flex-renderer-context.ts` hands out **private** contexts
(`sharedContextKey: null`, where the presentation canvas *is* the WebGL canvas and no
transfer exists) up to a budget, falling back to the shared key beyond it. That fixes
the common one-to-few-viewer deployment and leaves the readback in place for exactly the
case the shared context exists for — many viewers on one page, i.e. the case where the
per-frame cost hurts most.

### The change

Keep the transfer on the GPU. Blit the color target into the shared canvas' default
framebuffer (`gl.blitFramebuffer`, already used internally at ~`:3820`) and let the
presentation canvas take it with `ctx2d.drawImage(webGLCanvas, 0, 0)` — a texture copy in
every current engine, which also yields the y-flip for free instead of the CPU row loop.
Done inside the same task as the render, this is well-defined without
`preserveDrawingBuffer`, because each renderer draws and presents before the next one
touches the shared context — which is already the required ordering.

If a fallback is still wanted for a configuration where that misbehaves, make it a
fallback: probe once and keep `readPixels` as the slow path, rather than making the slow
path the only path. Either way the return value of `presentColorTargetToCanvas`
(`"read-pixels"` today) should name which route ran, so a consumer can tell.

---

## flex-renderer — `devicePixelScale` is one scalar, but the framebuffer scale is per-axis

Follow-up to the grid device-pixel fix, which is otherwise correct. The uniform is
uploaded from the X axis only (`~:18233`):

```js
devicePixelScale: sx,
```

as a `uniform1f` (`~:13930`). But the origin's two components are built from
*different* scales (`~:18199-18202`):

```js
imageOriginPx[0] = cssPt.x * sx;
imageOriginPx[1] = canvas.height - cssPt.y * sy;
```

so `imgCoord.y = (gl_FragCoord.y - imageOriginPx[1]) / (pixelSize * sx)` divides a
numerator built with `sy` by a denominator built with `sx`.

### Why it is not zero

`sx` and `sy` are only equal when the framebuffer dimensions are exact multiples
of the CSS ones. They are integers, rounded per axis:

```
canvas 1961 x 1903, container inner 1634 x 1586, devicePixelRatio 1.2
1634 * 1.2 = 1960.8 -> 1961    sx = 1.200122399
1586 * 1.2 = 1903.2 -> 1903    sy = 1.199873897
sx / sy = 1.000207107
```

So the grid's vertical period is `512 * 1.000207 = 512.106` image pixels for a
configured `cell_y: 512`. The error is zero at the anchor image's origin and grows
linearly: measured against a 105185 x 221772 slide, **11.5 px** a quarter of the
way down, **23.0** at the middle, **45.9** at the bottom. X is exact, because
there `sx` appears in both the numerator and the denominator and cancels.

At DPR 1 the two scales are both exactly 1, which is why this survives alongside
the original fix — and why it presents as *vertical-only* drift that looks like an
accumulating precision problem rather than a scale error.

### What breaks meanwhile

The same thing the first fix addressed, an order of magnitude smaller: `grid` and
`gridheatmap` cannot be trusted as a measurement near the far edge of a large
image. On the xOpat demo the overlay's 512-px prediction squares are placed
exactly (verified: `cellX` 512, `cellY` 512.0000000000001) while the grid claims
512.106, so the two visibly separate toward the bottom of the slide.

### The change

Make the uniform per-axis — `uniform vec2 u_devicePixelScale`, uploaded as
`(sx, sy)`, and divide componentwise:

```glsl
vec2 scaleFb = scale * dps;                       // dps now vec2
vec2 imgCoord = (gl_FragCoord.xy - imageOriginPx) / scaleFb - vec2(offsetX, offsetY);
```

The two scalar uses downstream can take either component — `minDistFb` and
`halfWidth` differ by 0.02 % between axes, which is far below a pixel — but they
should pick one deliberately rather than by accident. `scale` (`pixelSize`) itself
stays isotropic and correct: it is CSS-px per image-px, and image pixels are
square; only the CSS→framebuffer conversion is anisotropic.

---

## flex-renderer — the published shader-layer schema omits keys the runtime reads

**Library:** `src/libs/flex-renderer/flex-renderer.js` — `ShaderConfigurator#_compileShaderLayerJsonSchema`
(`:29056`-`:29141`), against the runtime reads at `:1111` / `:1147` and the typedef at `:4576`.
**Status:** open.
**Raised:** 2026-09-04, while tracking a DICOM parametric-map regression.

### Why

`_compileShaderLayerJsonSchema` builds each shader entry with `additionalProperties: false`
(`:29107`-`:29111`) over exactly:

```
id, name, type, visible, fixed, tiledImages, dataReferences, cache, params
(+ order, shaders for `group`)
```

`precision` is missing, yet it is a documented, honoured config key:

```js
// :4576 — the ShaderLayerConfig typedef
* @property {"float16"|"unorm8"} [precision] per-instance override of the first-pass color
*      target precision, honored only while the renderer option `precision` is `"auto"`.

// :1111 / :1147 — the runtime, reading it
if (config && config.precision === "float16") { return true; }
if (config && config.precision === "unorm8")  { return describe(); }
```

`_controls` has the mirror-image problem: the prose descriptor `_compileBaseShaderConfigSchema`
(`:28915`-`:28982`) lists it, the JSON schema does not, so a persisted session carrying it is
rejected too.

A second, smaller divergence sits next to it: `_compileCustomParamJsonSchema` (`:29313`-`:29323`)
never applies `_withNullableSchema`, unlike its built-in sibling at `:29300`-`:29302`. A custom
param declared `{type: "string", default: null}` therefore publishes as strictly required, and
`_synthesizeExampleParamsFromDefaults` (`:29523`) will happily emit `null` into an example that
then fails its own schema. Declaring `"string|null"` works around it.

### What breaks meanwhile

Nothing renders wrong — the host's validation of this is advisory
(`src/classes/app/viewer-visualization-runtime.ts:264`-`270`: these findings never drop a layer).
But every DICOM parametric-map overlay emits `must NOT have additional properties
{"additionalProperty":"precision"}` on every open, and `allErrors: true` over a `oneOf` across
every registered shader type multiplies it, so a two-overlay study logs dozens of findings. That
noise is what a real finding has to be spotted among.

xOpat keeps emitting `precision` (`plugins/dicom/index.workspace.mjs`) because it works; the
schema is what is wrong, and filtering the finding host-side would also hide a genuine typo in
the same key.

### The change

Add `precision: { enum: ["float16", "unorm8"] }` and `_controls: { type: "object" }` to the
`properties` map in `_compileShaderLayerJsonSchema`, and make `_compileCustomParamJsonSchema`
apply `_withNullableSchema` when `item.default === null`, as the built-in path already does.

---

## EMPAIA annotation-service — reading a pixel map destroys it

**Service:** `annotation-service` `pixelmapd` —
`annotation_service/ctl/pixelmap/pixelmap_file.py:30` (`PixelmapFile.__init__`),
`annotation_service/ctl/pixelmapd.py:105`-`120` (`_worker_process`),
`annotation_service/ctl/pixelmap/worker_cache.py:3` (`EXPIRATION_TIME_SECONDS = 300`).
**Seen in:** annotation-service 0.23.1, as shipped by EATS 3.7.0.
**Status:** open
**Raised:** 2026-09-04, diagnosing a TA13 overlay that rendered nothing.

### Why

`PixelmapFile.__init__` opens the HDF5 store with an unconditional truncate:

```python
self._file = h5py.File(self._file_path, mode="w")     # "w" = create/TRUNCATE
```

`_worker_process` constructs one on **every** worker spawn, and a worker is spawned for
reads as readily as for writes — the two paths are not distinguished. Workers expire after
`EXPIRATION_TIME_SECONDS = 300`, refreshed on each access, so the store survives only while
its writing worker happens to still be alive.

### What breaks

A pixel map read more than five minutes after its last access is **truncated to 0 bytes** by
the very request trying to read it. Two tile requests arriving together after that window
spawn two workers that race the same file, and one raises

```
BlockingIOError: [Errno 11] Unable to synchronously create file (unable to lock file)
```

after which every tile answers `500 {"detail": "Could not connect to pixelmapd."}`.

Observed on TA13's `tissue_nuclei_map`: the job wrote **74,882,469 bytes**, the store served
correct gzip-encoded `256×256×2` tiles minutes later, and one hour after that — on the first
tile request of a fresh viewer session — the same file was **0 bytes** with a new worker line
and the lock error in the log. Re-running the analysis reproduces it every time.

### What xOpat does meanwhile

Nothing can be done client-side: the data is gone before the request that wanted it returns.
The viewer now at least reports it — `EmpaiaPixelmapTileSource.getTileHealth()`
(`modules/empaia-workbench/pixelmap-tile-source.ts`) counts served / failed / blanked tiles,
and `plugins/empaia-app-ui/sections/pixelmaps.mjs` says the map's data could not be read
instead of showing a legend beside an invisible layer. For a demo, view the map within five
minutes of the job finishing and keep interacting, which slides the worker's TTL.

### The change

Open readers with `mode="r"` and writers with `mode="a"`, rather than `"w"` for both;
`"w"` is correct only when a map is first created. Serialising worker creation per pixel map
id would additionally remove the lock race.
