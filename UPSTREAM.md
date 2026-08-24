# Upstream directives

Changes xOpat needs in a **vendored library**, not in xOpat itself. Per
[`AGENTS.md`](AGENTS.md) §0.6–§0.7 we do not patch `src/libs/*`: the fix belongs in the
library, and this file is where the request is written down until it lands.

Each entry states the library, the change, and what breaks in xOpat while the change is
outstanding.

---

## flex-renderer — drop Font Awesome from `UIControls.IconLibrary`

**Library:** `src/libs/flex-renderer/flex-renderer.js`
**Status:** open
**Raised:** 2026-08-21, when xOpat removed its Font Awesome dependency.

### Why

xOpat no longer ships Font Awesome. Phosphor Light
(`src/libs/phoshor-icons/style.css`, family `"Phosphor-Light"`, classes `ph-light
ph-<name>`) is the only icon font loaded.

`$.FlexRenderer.UIControls.IconLibrary` still defines three Font Awesome sets —
`fa-solid-common`, `fa-regular-common`, `fa-brands-common` — each declaring
`fontFamily: "'Font Awesome 6 Free'"`. They back the shader `icon` control's picker.

### What breaks meanwhile

`_resolveFontClassRenderSpec` mounts a probe element and reads
`getComputedStyle(probe, "::before")`. With no Font Awesome stylesheet loaded the probe
returns `content: none`, `_decodeCssContent` returns `null`, and the entry is dropped —
so in xOpat every icon in those three sets now renders blank. The picker degrades to the
`html-glyphs` set (plain Unicode symbols, always available), which is why this is a
directive rather than a blocker.

### The change

1. **Replace** the three `fa-*` sets with a single `phosphor-light` set:

   ```js
   "phosphor-light": {
       kind: "font-class",
       fontFamily: "'Phosphor-Light'",
       fontWeight: "400",          // Phosphor Light is single-weight; 900 synthesises bold
       items: phosphorLight        // makeClass("<name>", "ph-light ph-<name>", aliases, tags)
   }
   ```

2. **Keep the old `fa-*` names as `aliases`** on the new entries — e.g.
   `makeClass("star", "ph-light ph-star", ["fa-star", "favorite"], ["rating"])`.
   `resolveIconSpec` matches on aliases, and shader `icon` control values are persisted
   inside visualization configs. Dropping the aliases silently breaks every saved
   session that picked an icon.

3. **Change the defaults** from `"fa-solid-common"` to `"phosphor-light"`: the
   `getSet` / `getIcons` / `search` parameter defaults, and the `iconSet` control's
   `default` in the shader-control descriptor.

4. **Do not touch `_resolveFontClassRenderSpec`.** It resolves through a DOM probe and
   computed style, so it is already font-agnostic — a Phosphor set works through it
   unchanged. It is called out here because it looks Font-Awesome-specific and is not.

5. **Add `registerSet(name, set)`** so a host can contribute an icon set without forking
   the library. Today `sets` has to be mutated directly.

6. **Delete the dead `IconLibrary`** object defined earlier in the file — it is
   immediately overwritten by the current one and only adds confusion when searching.

---

## flex-renderer — single- and two-channel float texture pack formats

**Library:** `src/libs/flex-renderer/flex-renderer.js`

### Why

The texture-pack format list is `RGBA8` and `RGBA16F` only. Every quantitative
single-channel layer therefore uploads its one channel as the R of a full RGBA
pack and pays four times the GPU memory for three channels of zeroes.

That was tolerable when the only such layer was a DICOM Parametric Map — a
whole-slide map is one logical tile. It stops being tolerable with radiology
z-stacks (`plugins/dicom/radiology-tile-source.mjs`): a CT plane is a single
512×512 tile, and the core's plane cache keeps `zPlaneCacheMaxItems` of them.
At the shipped default of 400 that is **~800 MB of texture memory, ~600 MB of it
padding**, for one scrubbed series.

### What breaks meanwhile

Nothing renders incorrectly. Deployments showing radiology have to lower
`zPlaneCacheMaxItems` (the plugin README suggests 120), which costs re-fetches
when scrubbing back over a range, and the source warns when a series' plane
budget looks large.

### The change

Add `R16F` and `RG16F` to the accepted pack formats, mapped to the WebGL2
internal formats `gl.R16F` / `gl.RG16F` with `gl.RED` / `gl.RG` and
`gl.HALF_FLOAT`. Both are colour-renderable in WebGL2 with
`EXT_color_buffer_half_float`, which the renderer already requires for the
existing `RGBA16F` path, so the capability gate does not change.

`sampleChannel(..., {baseChannel})` already addresses channels by index; the
only additional requirement is that a pack declaring fewer than four channels
reports its own channel count so the sampler does not read past it.
