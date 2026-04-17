# UI Services

Unlike classes, UI services have no common UI base class, and unlike components that
are meant to be re-used, these services represent a single core UI concept that is used
in a single place and must not be instanced multiple times. The API of these services is often
used by other plugins, modules, and parts of the viewer to add and control different menus and UI elements.

## Core Services

- **`AppBar` (Top menu)**
  Manages the top navigation bar. It exposes APIs to add custom actions, submenus, and buttons. 
  It hosts core viewer controls like View, Edit, and Plugins menus. Plugins often use `AppBar.Edit` or `AppBar.View` to insert their controls into the main application.

- **`MobileBottomBar`**
  A separate navigation bar service used exclusively on narrow/mobile viewports to provide touch-friendly counterparts to the AppBar items.

- **`FloatingManager`**
  Handles z-index ordering and focus state for floating panels (e.g. `FloatingWindow` components). It ensures that multiple floating UI windows properly overlap and the newly focused window always comes to the front.

- **`FullscreenMenus`**
  Manages full-screen overlay menus (e.g., settings, data panels). Ensures that only one fullscreen menu is visible at a time and provides API to toggle or switch them.

- **`FloatingWindow` external mode**
  Detached browser windows are now handled directly by `FloatingWindow` with `external: true`, including inherited UI assets/theme support and Monaco-backed editor windows.

- **`GlobalTooltip`**
  A singleton tooltip service that allows components to display contextual help text without needing localized tooltip DOM structures everywhere.
