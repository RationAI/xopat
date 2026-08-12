# Changelog


### 3.0.0

First stable v3 release (promoting `3.0.0-beta.1`). Focus areas since the beta: the AI chat
stack (streaming, voice, BYOK, security), a new pathology exploration API, annotation UX, and
rendering/loading robustness.

**Features**:

* **Chat & AI** — streaming RPC and a faster, more stable chat interface; voice input integration
  with hands-free controls and quicker speech recognition; bring-your-own-key (BYOK) provider
  secrets; a configurable default provider with consent remembering; region hotlinks in chat;
  friendly progress feedback during LLM computation; MedGemma integration; an experimental
  chat-based tester; by-default injection of basic viewer-context summary.
* **Pathology** — hierarchical pathology exploration API; generalized MLflow API + IO sink; a
  general slide-labelling plugin; sensitive-patient API support.
* **Scripting** — progress reporting and partial results; multi-viewport scripting; recorder
  scripting and importing; pathology scripting; magnification control.
* **Annotations** — replaced the ruler with a line tool; quick annotation-draw shortcuts;
  polyline works as a polygon in creation style; general UX polish.
* **Rendering & navigation** — synthetic preview image level for incomplete pyramids; z-stack
  (focal-plane) support promoted from the time-series shader to the core; base slide
  virtualization; scroll snapping to zoom levels; reverse scroll; joystick navigation mode.
* **Core** — central shortcut manager (hotkeys plugin removed); viewer virtual aliases; network
  status detection; branding configuration; global menu hover/overlay; do-not-ask-again API;
  streamlined auth configuration and integration API (legacy `oidc-auth` plugin removed);
  bundled third-party license notices; i18n audit script and localization detection.

**Bugfixes**:

* **Chat & voice** — security hardening (chat requires an active session); whisperer/speech
  transcription flexibility, stabilization, and WASM bugfixes; recorder listing; better global
  handling of uncaught errors; more robust chat request/error recovery.
* **Annotations** — border-width rendering and border updates; arrow cut/paste, arrow tool and
  factory stability; angle-arc rendering; polyline/polygon creation and viewport crop; IndexedDB
  serializers and hardened persistence; sink-API deletion propagation; toolbar UI/UX; HTML
  sanitization.
* **Rendering & data** — flex-renderer GeoJSON color parsing; DICOM integration and ICC usage;
  rationai-tile-source tile-size fix; bad-data viewer opening and slide-info behavior; playground
  duplicating shader entries.
* **Loading & build** — production bundling, asset inclusion, minification file serving, and
  handling of failed transpilation/minification; more stable core loading of modules and plugins
  with more metadata support; session env check on cached data.
* **Misc** — questionnaire fixed (now working); measurements plugin; explorer listing; renamed
  the security flag to `secureMode`; dialogs render safe HTML; translation and auth-context fixes;
  strengthened sanitization.

### 3.0.0-beta.1

xOpat v3 is a near-complete rewrite and is **partially backward-compatible with v2** —
but your old modules and plugins should be ported to the new APIs, especially the life-cycle timings
and multi-viewport support. The high-level changes are:

* **New rendering engine** — the WebGL `flex-renderer`, requiring OpenSeadragon v6.
* **Multi-viewport core** — a `VIEWER_MANAGER` can run several viewers on one page; most core events changed accordingly.
* **New UI system** — Van.js + DaisyUI components; Primer CSS, Material icons, and Bootstrap are deprecated.
* **Generic IO pipeline** — unified, pluggable persistence for sessions, annotations, and per-element state.
* **Server RPC & proxy auth** — server-side plugin/module methods and secured upstream proxying (Node; the PHP server supports the proxy).

And more, mostly new approach to most of the functionality to enable reusable functionality and providers,
consumed by generic users - pluggable and extendable. Check out the documentation!

---------------

### 2.3.1
**Features**: author annotation distinction.

**Bugfixes**: php image includes UI folder.

### 2.3.0

**Features**: added a way to set preferred annotation preset IDs for the GUI. Support for
annotation modes private and locked. Support for annotation comments. Implementation of ICC profiles.
Guidelines for WASM usage.
Annotation features: private / locked modes, comments support. Support for copy/move/delete
on right click.

**Bugfixes**: Fixed mjs module loading on servers.

**V3 Pull**: We are slowly adding code from v3 development that does not 
influence the v2 functionality, but allow using v3 features - UI and dev scripts.

### 2.2.2

**Bugfixes**: Fixed annotation visuals for point, line. Fix annotations rest IO, fix logics with refreshing token,
more robust behavior. Better behavior of tutorials. Better points rendering.

**Features**: annotation reconstruction from point array new API. Useful for convertors.
Using 'Unknown', non-exported annotation preset instead of creating new. Configurable data snapshots.

### 2.2.1
**Bugfixes**: faster zooming constant, disabled dynamic speed adjustment.

**Features**: experimental module & plugin sam-segmentation.

### 2.2.0
**NEW UI SYSTEM**. The UI now supports component system using Van.js library. A lightweight
way of re-using defined components, supported newly by tailwind css. The ui will be further
separated from the viewer core in the future. UI Components are not yet integrated, but the CSS Styles are.
There might be slight disturbances on collision of button / theme styling.

**Features:** new UI component system & developer UI tools. Server support for .mjs files - 
support for native JS modules. New annotation tool for multipolygons, new viewport segmentation
annotation tool. New event reacting on visualization rendering setting change.

**Bugfixes:** improved behavior for touchpad zooming.

### 2.1.1
**Features:** standalone wsi tile source module. Edge navigation optional.

**Bugfixes:** OIDC module popup method - await login.
Use session storage to store xOpat sessions as well.
Fixed scalebar magnification estimates. Annotations IO bugfixes.
Extend await event support.

### 2.1.0
**Features:** new system for module/plugin building, improvements of annotation listing features,
support for generic annotation visual style changes.

**Maintenance:** removed outdated plugins.

**Bugfixes:** plugins use also Cache API, annotation visuals updated also with history.
Fix oidc login with events.

### 2.0.4
**Features:** vertical magnification slider, allow 2x artificial zoom, annotation areas.

**Bugfixes:** OIDC module, magic wand annotation tool, stacktrace capture.

### 2.0.3
Bugifxes on annotations. Update font + change default weight. More
events propagated to modes (and recursively factories) to control.

### 2.0.2
New annotation features (edge mouse navigation, undo on manual creation steps, left click works
in navigation mode regardless of left mouse preset, ...). Fix PHP parsing: avoid converting
objects to arrays.

### 2.0.1
Improved annotations & bugfixes with storage API.

### 2.0.0
The version 2 brings:
* new UI features
  * servers: php & node & static
  * docker builds for php server
  * unified data & metadata storage logics
  * unified session config parsing
  * user interface: loading, events, bugfixes
  * maintenance & refactoring
* new modules & plugins
  * oAuth2 login capabilities
  * support for integration with Empaia WBS
  * YouTrack feedback form
  * pollyjs for traffic interception
