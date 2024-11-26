# Changelog

The changelog file describes changes made since v2.0.0, which made significant changes
to the versions 1.x.x.

### Unreleased 2.1.0
**Features:** new system for module/plugin building, improvements of annotation listing features,
support for generic annotation visual style changes.

**Maintenance:** removed outdated plugins.

**Bugfixes:** plugins use also Cache API, annotation visuals updated also with history.

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
