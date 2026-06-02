# UI Services

Unlike classes, UI services have no common UI base class, and unlike components that
are meant to be re-used, these services represent a single core UI concept that is used
in a single place and must not be instanced multiple times. The API of these services is often
used by other plugins, modules, and parts of the viewer to add and control different menus and UI elements.

## Core Services

- **`AppBar` (Top menu)**
  Manages the top navigation bar. It exposes APIs to add custom actions, submenus, and buttons. 
  It hosts core viewer controls like View, Edit, and Plugins menus. Plugins often use `AppBar.Edit` or `AppBar.View` to insert their controls into the main application.

  `AppBar.Chrome` is an opt-in registry that backs the "hide UI" button in the top-right. Components register a `VisibilityManager` (or any `{ is, on, off }` / `{ is, set }` duck) with `AppBar.Chrome.register(id, vm)`; everything already routed through `AppBar.View.append()` or `AppBar.View.registerViewComponent()` is auto-enrolled. The button calls `AppBar.Chrome.toggle()`, which snapshots each registered `vm.is()` and calls `vm.off()` directly (bypassing `VisibilityManager.set()` so the user's persisted visibility choices in `AppCache` are not overwritten); the next press restores only the entries that were visible before. Not related to `FullscreenMenus` below.

- **`MobileBottomBar`**
  A separate navigation bar service used exclusively on narrow/mobile viewports to provide touch-friendly counterparts to the AppBar items.

- **`FloatingManager`**
  Handles z-index ordering and focus state for floating panels (e.g. `FloatingWindow` components). It ensures that multiple floating UI windows properly overlap and the newly focused window always comes to the front.

- **`FullscreenMenus`**
  Manages full-screen overlay menus (e.g., settings, data panels). Ensures that only one fullscreen menu is visible at a time and provides API to toggle or switch them.

  **Tab body layout helpers.** Plugin tab bodies look out of place when they ship their own ad-hoc DOM, so two thin van.js helpers on the service render the same DaisyUI cards core *Settings* uses:

  ```js
  const fs = USER_INTERFACE.FullscreenMenu;
  return fs.layout(
      fs.card("Export options", checkbox1, select1),
      fs.card("Display", checkbox2),
  );
  ```

  `fs.layout(...sections)` returns the outer flex shell + 2-column responsive grid; `fs.layout(title, ...sections)` adds a 2xl in-body header above the grid (matches the look of core *Settings*). `fs.card(title, ...children)` is a single titled card. All are optional — use them for visual parity with core, drop down to raw van.js when you need custom chrome. Pass `null`/`""` as the title to either helper to render the chromeless variant.

  **Sidebar grouping.** `FullscreenMenus.register(item, ns)` places the tab under the namespace `ns` (default `NAMESPACE.PLUGINS`). The sidebar renders `SYSTEM` and `PLUGINS` groups with a divider + uppercase label between them — `Menu.NAMESPACE.SYSTEM` (order 10) vs `Menu.NAMESPACE.PLUGINS` (order 20). Explicit `item.namespace` overrides the `ns` argument.

  **Plain chrome.** `AppBar.Plugins.setMenu(...)` and `FullscreenMenus.setMenu(...)` accept a final `opts` argument; pass `{ chrome: "plain" }` to skip the default rounded outer card around the plugin tab body. Use this when the tab renders its own cards via `fs.card(...)` and you'd otherwise see nested borders. Default `chrome: "card"` preserves the existing look for plugins that aren't migrating.

- **`FloatingWindow` external mode**
  Detached browser windows are now handled directly by `FloatingWindow` with `external: true`, including inherited UI assets/theme support and Monaco-backed editor windows.

- **`GlobalTooltip`**
  A singleton tooltip service that allows components to display contextual help text without needing localized tooltip DOM structures everywhere.
