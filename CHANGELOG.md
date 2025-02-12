# Changelog

The changelog file describes changes made since v2.0.0, which made significant changes
to the versions 1.x.x.

### 2.2.0
**NEW UI SYSTEM**. The UI now supports component system using Van.js library. A lightweight
way of re-using defined components, supported newly by tailwind css. The ui will be further
separated from the viewer core in the future.

**Features:** new UI component system & developer UI tools. Server support for .mjs files - 
support for native JS modules.

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
