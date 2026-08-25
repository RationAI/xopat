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

An annotation the user drew *before* deciding to analyse it is not lost to that
filter: **Use as region of interest** hands it to `wb.markAsRoi()`, which is one
`changeAnnotationPreset` per object — so the IO guards run, the change is
undoable, and the workbench sink re-posts the record with `is_roi`. Shapes the
EAD does not declare are refused there rather than converted: a polygon cannot
become a `rectangle` input, and letting it through produces a job the backend
rejects at input validation with nothing on screen to say why.

### The steps, and which one you are on

An EMPAIA app can declare three: `preprocessing` (the platform runs it when the
examination opens), `standalone` (draw a region, run), and `postprocessing` (the
second half of the preprocessing flow — it consumes what preprocessing produced).
The panel offers them in that order of usefulness, lands on the first one that can
actually be *started*, and **always states which one is active**, even when there
is only one. Hiding the selector for a single-mode app is what left TA12
(preprocessing + postprocessing, nothing standalone) looking like a broken panel:
a "Draw region" button that silently did nothing and no indication why.

A step that cannot be started says so instead of failing later — the banner and
every run button read the same `runBlockers`, so they cannot disagree.

**Postprocessing needs to know which earlier result it is built on, and the answer
is the one you are looking at.** The App-UI flow diagram reads *display
preprocessing results → user interacts → run postprocessing*, so showing a
preprocessing analysis in the Analyses window **is** choosing it as the input. The
panel names what it resolved to and links to the window when there is more than
one candidate.

That is why the analyses list is **not** filtered by mode. One list per slide,
every step, with a mode badge per row and a mode chip beside the status chips.
Filtering it to the step you were about to run hid the results that step consumes,
dropped every row on a switch, and stranded the visibility set on ids that no
longer existed.

### Results that have somewhere to go

- **Per-region values** (one number per rectangle you drew) → the per-region table.
- **Shapes and classes** → the slide, and named in the output chips with a count.
  They are never asked for as *values*: a collection of points has no `value`, and
  querying it produced one wasted request per output and a column of blank cells.
- **Per-annotation values** (one confidence per detected nucleus) → onto the
  annotation, so the board row and the selection pill read
  `tumor · confidence 0.93`. The class leads, because it is what the annotation
  *is*; the number follows, because it is what one run said about it.
- **A very large result** is counted, not fetched. The chip says how many and
  offers to load them, which beats a multi-megabyte response nobody asked for —
  and beats the timeout it used to become, which read as "produced nothing".

### Two questions, not one

`sections/region-eligibility.mjs` judges every selected annotation on two
independent axes, and keeping them apart is load-bearing:

- **analysable** — can it be named as a job input now? Needs a server id, a shape
  the EAD declares, and the ROI preset. **Whether an earlier analysis locked it is
  irrelevant**: the lock is delete/update-scoped (see the module README), so a
  region one run consumed can be handed to the next.
- **convertible** — can it be *made* a region of interest? Conversion is a preset
  change, i.e. an update, so every edit-blocking condition applies: locked, job
  output, or read-only all refuse here.

Collapsing the two is what made selecting a previously-analysed rectangle offer
nothing and explain nothing. Job output needs no special case — it is never
`is_roi`, so it can only reach the second question, where it is refused.

### No selected region is ever silently ignored

The rule the menu, the panel and the toasts all obey. `refusalGroups` collapses the
ineligible ones by reason and `plugin.describeRefusals` turns that into one
sentence, so the three surfaces cannot word the same refusal differently.

Concretely: the menu carries a dimmed "N selected regions cannot be used" row whose
click explains them — **in both modes**, since that explanation used to sit in the
`else` of `if (multi)` and so never fired for exactly the apps that collect several
regions. Counts are honest about the total ("Add 2 of 3 regions to the run"), panel
rows carry the reason as visible text rather than a hover title, disabled buttons
carry a `title`, and a locked-but-usable row says so outright: *"Used by analysis
abc12345 — can no longer be edited, but can still be analysed again."*

`jobs.selectRoiFirst` is reserved for a genuinely empty selection. With regions
selected but none usable, the toast says what is wrong with them instead — telling
someone looking at three highlighted regions to "select at least one region first"
is what sent this surface back for rework.

### The selection *is* the region set

There is no tick-box list in this panel. What the analysis acts on is what is
selected on the **canvas**, read through `getSelectedAnnotations()` and mirrored
into `state.selection` from a broadcast `annotation-selection-changed`.

That is not a cosmetic change. A panel-only selection was invisible to a user
working on the slide, so selecting two regions, right-clicking and asking to
analyse them answered *"Select at least one stored region of interest first."* —
the panel's set was empty and nothing said so.

The right-click reads `ctx.selection`, which the **core** registry resolves once
in `CanvasContextMenu.open()` before any provider runs. Resolving it per provider
cannot work: providers are asked in priority order and `plugins/annotations`
(priority 20, above this plugin's 15) calls `setActiveObject` while the menu is
being built without updating the selection snapshot, so a later provider reading
the live selection sees a different answer depending on who ran first.

### Staged runs, for apps that collect several regions

An app whose EAD declares `"type": "collection"` for its regions
(`getRoiMode() === "multiple"`) does not analyse one shape per job. The panel
gains a **Staged run** section: regions accumulate into a collection bound to a
job sitting in `ASSEMBLY`, and running it is a separate, explicit act.

- Drawing a region while such an app is active stages it automatically once the
  workbench hands back an id — that gesture is not ambiguous, and making the user
  then find and tick it is the friction this surface exists to remove. Existing
  annotations are staged from the selection instead.
- The draft is a **real job**, so it is also an ordinary row in the analyses
  window, badged `staging`. Its Run and Delete buttons route through the batch
  (`runBatch` / `discardBatch`) rather than the raw job actions.
- Staging is **append-only** — the backend has no route that removes a collection
  item — and the section says so once instead of offering a per-row remove that
  has to explain itself.
- Running locks every staged region **permanently**. That is a standing property
  of the action, so it is a warning line above the button rather than a confirm
  dialog: a modal on every run is trained away within a week.

### Per-region results

An app that computes one value per region declares it as a collection whose items
reference `io.<input>.items`. The expanded analysis therefore leads with a
**per-region table** — one row per region it was given, one column per per-item
output, clicking a row frames that region — and the flat value table below it
carries only the run-level scalars. Before this, the per-item values arrived as
nameless rows in that flat table and the app's entire result was unreadable. The
zip lives in the module (`outputs.ts`); this plugin only labels the rows the way
it labels regions everywhere else.

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
