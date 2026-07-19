This page collects the terms and concepts you will meet throughout the xOpat
documentation. If something in another chapter is unclear, look it up here first.

## Imaging concepts

### WSI (Whole-Slide Image)
A digitized microscopy slide. WSIs are high-resolution images, ranging from
hundreds of megabytes to several gigabytes. They are stored in a **pyramidal**
structure: the same image at progressively lower resolutions, so a viewer can
load only the detail it currently needs.

<div style="margin: 20px;max-width: 450px;">

![WSI Pyramid](https://www.researchgate.net/publication/353893643/figure/fig2/AS:1056513544179712@1628903866268/WSI-images-are-stored-in-a-pyramidal-format-where-the-base-image-corresponds-to-the.png)

</div>

### Tile
A small rectangular piece of one pyramid level. Instead of downloading a whole
multi-gigabyte slide, the viewer requests only the tiles visible at the current
zoom and position, which makes real-time viewing possible.

### Image Server (WSI Server / Service)
A service that reads WSI files and serves their tiles over HTTP. xOpat has **no
hardwired backend** — you connect it to an image server of your choice. The
RationAI [WSI-Service](https://github.com/RationAI/WSI-Service) is the reference
server used throughout these docs, but any server xOpat can speak to works.
All OpenSeadragon-supported (and FlexDrawer) protocols, other APIs through
modules/plugins, or add support for your custom server with a single file.

### Image Protocol / Slide Protocol
The recipe xOpat uses to turn a *slide identifier* into a tile-source URL for a
specific image server. Protocols are registered in the static configuration
(`slide_protocols`) and can also be added at runtime by plugins via
`window.SLIDE_PROTOCOLS.register(...)`. The `default_background_protocol` and
`default_visualization_protocol` keys pick which protocol is used by default.

### Tile Source
xOpat's (OpenSeadragon) object that knows how to fetch tiles for one image from
one image server. A protocol produces a tile source for a given slide.

## The viewer

### xOpat
The **eX**plainable **O**pen **P**athology **A**nalysis **T**ool — a
browser-based, server-agnostic WSI viewer. It behaves like an enhanced
[OpenSeadragon](https://openseadragon.github.io/) with powerful visualization,
annotation, and extensibility on top.

### OpenSeadragon (OSD)
The underlying open-source deep-zoom image viewer xOpat builds on. Each viewport
in xOpat is an OpenSeadragon instance.

### Viewer / Viewport
A single rendering surface (one OpenSeadragon instance) showing one slide
context. xOpat supports **multiple simultaneous viewports** in a grid, each with
its own background and visualization selection.

### Background
The base raster image shown in a viewport — typically the WSI itself. A viewer
session references background slides through the `background` configuration.

### Visualization
A configurable stack of rendered **layers** drawn over the background, similar
to Photoshop layers. Each layer is produced by a **shader** and can be toggled,
reordered, and parameterized. Visualizations are how xOpat overlays AI outputs,
heatmaps, and other derived data on a slide.

### Shader (Visualization Layer)
The rendering recipe for one visualization layer (e.g. `heatmap`, `colormap`,
`edge`, `identity`). Shaders are provided by the WebGL rendering modules and
referenced by `type` in the visualization configuration.

### Data Reference
An index into the session's `data` array used by backgrounds and visualization
layers to declare *which* slide(s) they render, decoupling the data list from
how each piece of data is displayed.

## Configuration & sessions

### Static configuration (`env.json`)
System-manager-level configuration that sets up the viewer itself: gateway,
active client, server protocols, default plugins/modules. It can be generated
with `grunt env`. Unsafe options are configurable only here. See
[Viewer Configuration](xopat_configuration.md).

### Dynamic configuration (Session)
The configuration handed to the viewer at startup that defines a **session** —
the data to view, the visualizations, and per-session plugin configuration.
Provided via URL parameters, the `#visualization=...` hash, or a POST
`visualization` field.

### Cached configuration
Per-user state cached while using the viewer. Higher configuration levels
override lower ones (cached → dynamic → static).

### Plugin
A unit delivering user-facing features, tools, or integrations with their own UI
(annotations, tutorials, OIDC auth, etc.). Plugins live in `plugins/`; the
**Plugins → Catalogue** section lists the ones that ship with the viewer.

### Module
A shared library or hidden logical extension (annotation mapping, WebGL
rendering, tile-source adapters) without a primary UI of its own. Modules live
in `modules/`; the **Modules → Catalogue** section lists the ones that ship with
the viewer.

### Server
The optional backend that parses modules/plugins and reads POST data. xOpat
ships **PHP** and **Node.js** servers, and can also run **server-less** as a
statically compiled build. The choice is covered in the
[Deployment](deployment.md) section.

### secureMode
A static-configuration flag that gates dangerous-by-default behaviour (remote
tile sources, scripting, etc.). When enabled, risky features must be explicitly
opted into.
