# EMPAIA App UI

The user-facing half of the EMPAIA Workbench v3 integration. All backend work
lives in [`modules/empaia-workbench`](../../modules/empaia-workbench/README.md);
this plugin is the panel.

Two surfaces, split by how often they are used:

- **Plugins → EMPAIA Analysis** (`AppBar.Plugins.setMenu`) — set-up: the
  examination, its slides, the mode, and drawing regions of interest.
- **Tools → Analyses** (`AppBar.Tools` → a `UI.DockableWindow`) — the analyses
  themselves. It floats over the slide or docks as a MainLayout tab, because
  watching a run and comparing two results are done *while* looking at the slide.
  The canvas right-click and the panel's own button both open it, and a pulsing
  app-bar badge counts what is running.

---

## What the setup panel does

| Section | Content |
|---|---|
| Status | Connecting / not embedded / failed. Everything else stays hidden until the workbench session is up. |
| Examination | App, case and examination ids from the scope record. |
| Slides | Every slide in the examination, with stain / tissue / block. Click opens it in the focused viewer. |
| Mode | `standalone` ⇄ `preprocessing`, when the app declares both. Shows why an app cannot be driven from here (mixed single/multi inputs, nested collections, duplicate input types, no supported region type). |
| Regions of interest | Start drawing, list what has been drawn, select what to analyse, run. |
| Analyses | One line — how many exist, how many are running, how many are shown — and the way into the analyses window. |

## What the analyses window does

| Part | Content |
|---|---|
| Header | Which slide (and app) the list belongs to — in a grid the list is otherwise a wall of UUIDs with no anchor. |
| Search | Free text over job id, app name, the *translated* status and every error / validation message. Matched over the polled list, so it costs no requests. |
| Filters | `All / Running / Completed / Failed / Not started` chips, each with a count. Grouped by `Today / Yesterday / Earlier`, newest first. |
| Visibility | An eye per analysis, plus **Newest only** and **Hide all**. Right-click (or alt-click) the eye shows only that one. The header states `N of M analyses shown on the slide`. |
| Row | **One line**: eye, short id, relative time, runtime (or live percent), a warning icon carrying the failure text as its tooltip, and the status badge. Scanning twenty runs is reading down a column, not scrolling past twenty cards. |
| Detail | Expand one analysis for everything else, laid out as **one meta row** — what it produced (as chips) on the left, run / stop / delete on the right — preceded by the progress bar and full messages when there are any, and followed only by sections that have content: the primitives table, and the channel / colour-map / inversion controls for its pixel maps. One analysis at a time. |
| Navigate | The annotations chip is a button while that analysis is **shown**: it frames its output in the viewport — the annotation itself when there is one, the union bounding box when there are several. Hidden analyses render it as a plain chip, since there would be nothing on screen to go to. |

Past 200 matching rows the list stops rendering and says so — the search box is
the right tool at that point, not scrolling.

---

## Regions of interest are ordinary annotations

The plugin owns no geometry. "Draw region" does exactly two things through the
annotation module's existing API:

```js
presets.selectPreset(roiPresetId, true);   // preset carries the factory + colour
annotations.setMode(annotations.Modes.CUSTOM);
```

The preset is bound to the factory the app's EAD asks for
(`rectangle → rect`, `polygon → polygon`, `circle → ellipse`) and coloured from
the EAD's rendering hints. Everything the annotation module already provides
therefore works on ROIs for free: undo/redo, the annotation board, the canvas
context menu, measurements, presets, layers, and the fixed-area mode.

Capture is a broadcast `annotation-create` handler filtered on the ROI preset —
so it works in every viewport of a multi-viewport grid, and the viewer always
comes from the event, never from `window.VIEWER`.

Result annotations produced by a job are imported through the same annotation
module (via the `empaia` convertor, presets merged), coloured per class value.
They are not listed in this panel — the annotation board is where annotations
belong.

### One analysis at a time

The eye on an analysis decides whether **everything that run produced** is on the
slide — its annotations, its pixel maps and its primitives, all keyed by the same
job id (`empaiaJobId` on an annotation, `creator_id` on a map or a value). By
default only the **newest completed** analysis is shown. Results are otherwise
cumulative and cannot be deleted (they belong to the job's scope), so a few runs
make the slide unreadable.

Show another run to compare two side by side; **Hide all** clears the slide of
analysis output. The user's own annotations and regions of interest are never
touched. The choice is not remembered across a reload — output presence is a
projection of server records, re-derived from the job list, which is also why a
failed or still-running analysis never takes the current result off screen. Once
the user makes a choice on a slide, the default stops re-deriving there for the
rest of the session.

The plugin owns none of this: `empaia-workbench` holds the visible set (per
slide), and the window renders it and asks the module to change it. There is no
second copy to fall out of step with the canvas.

### Deleting a job's output

Refused, with a message naming **Tools → Analyses** as the place to change what is
shown. The annotations module already refuses it — job output is imported `readOnly` —
but its message has to serve every read-only source, so this plugin registers a guard
*above* the module's (priority 1100) purely to give the user a next move. Same
refusal, better sentence. The canvas right-click on a job-produced annotation
offers the window directly.

### Deleting a ROI a job depends on

A `pre-delete` guard is registered against the annotations module's own
`annotation` resource. Deleting a region that a non-terminal job holds as an
input is refused with a translated message, because the backend would otherwise
keep the job pointing at a record that no longer exists. No bespoke event
protocol — this is what the IO guard registry is for.

---

## Permissions

Two capabilities, gated with `this.can(...)`:

| id | Gates |
|---|---|
| `empaia-app-ui.roi.create` | Capturing and storing a drawn region. |
| `empaia-app-ui.job.run` | Submitting an analysis. |

Ids are namespaced under the plugin id because the registry drops anything that
is not, and `XOpatUser.can()` answers `true` for ids it never saw — an
unnamespaced id is a gate no role config can ever close.

Client-side gating only — the workbench backend is the authority
(`src/USER_ROLES.md`).

---

## Configuration (`ENV.plugins["empaia-app-ui"]`)

```jsonc
{
  "resultPollMs": 3000
}
```

Everything else — origins, backend URL, tile format, job polling — is configured
on the module.

---

## Requirements

- `modules/empaia-workbench` (declared in `modules`), which must be `permaLoad`ed
  so the postMessage bridge is listening before the workbench sends anything.
- `modules/annotations` for ROI drawing and result rendering.
- The viewer must be embedded by an EMPAIA Workbench client. Standalone, the
  panel shows a "not running inside a workbench" notice and nothing else.

The plugin deliberately does **not** `requires` any auth module: the workbench
module declares an auth *context* and whichever broker owns it supplies the
mechanism (AGENTS.md §7).
