
Analyze plugin
========================

Purpose
-------
Adds an "Analyze" tab to the AppBar with two actions: a "Run Recent →" anchor that opens a right-side recent-jobs panel, and "Create New App" which creates floating window with new app form.

Files
-----
- `analyzeDropdown.mjs` - registers the tab and wires dropdown items.
- `newAppForm.mjs` - the floating form used by "Create New App".

How to use
----------
- Provide recent jobs by passing `params.recentJobs` or saving `recentJobs` via plugin options.
- Handle job clicks by implementing `onJobClick({ index, label })` on the plugin instance.
- Provide `params.onCreate` to receive form submission data from `NewAppForm`.

Implementation notes
--------------------
- UI behaviors (menu, positioning, hover) are implemented in `SidePanel` (`setMenu`, `showNear`, `scheduleHide`, `cancelHide`) — reuse it for other flyouts.
- `SidePanel.hide()` currently removes the element; consider switching to `display:none` if you need faster show/hide cycles.

