> **Experimental.** Tightly coupled to the EMPAIA Workbench (via the private `empaia` plugin and the
> `empation-api` module); it does nothing useful without them.

Analyze plugin
========================

Purpose
-------
Adds an "Analyze" tab to the AppBar for running EMPAIA **standalone** jobs on the open slide and
showing their results. The dropdown has two items:

- **Apps**: a FloatingWindow with one card per runnable app (`app_id`). Each card has an optional
  job name, an "Advanced settings" disclosure with the app's inputs, and a Run button.
- **Job History**: a modal listing the last 50 jobs, where you can show or hide their annotations,
  view output values, rerun, or delete them.

Files
-----
- `analyzeDropdown.mjs`: the plugin class. Registers the tab, builds the apps window and the
  inputs form from the app's EAD, runs jobs, renders results, and sets the job status badge.
- `jobResultsOverlay.mjs`: `JobResultsOverlay` renders output annotations through OSDAnnotations,
  one layer and one coloured preset per job (`job-<jobId>`). The annotations can be edited and are
  saved with the session, but are never synced back to EMPAIA.
- `jobHistory.mjs`: `JobHistory` (storage in the `jobHistory` plugin option) and the modal UI
  (`JobHistoryPanel`, `JobHistoryCard`): search by job name, filter by app, inline results panel.
  Each card is one row: status dot, name (the app name when no name was given), time, and icon
  actions (show/hide, rerun, results, delete; delete needs a second click within 3 s).
  Also exposes `window.renderJobOutputValues`.

Job flow
--------
1. **Apps** calls `EmpaiaStandaloneJobs.getApps()` (apps with `job_modes: ['STANDALONE']`) and
   hides apps whose `store_description` contains `NO-OP` / `NO_OP`.
2. The case is resolved from the open slide (the case whose slides contain it), falling back to
   the `caseId` option/param and then the `empaia` plugin's active case.
3. The inputs form is built from the EAD's `modes.standalone.inputs`:
   - `wsi` is filled with the current slide, no field shown.
   - `rectangle` is captured by drawing: the apps window hides, rectangle mode is enabled, and the
     drawn shape is stored in EMPAIA as an annotation whose id becomes the input.
     Escape cancels. A "Draw ROI" hint modal precedes it unless `skipDrawROIModal` is set.
   - `integer` / `float` / `bool` / `string` get editable fields, pre-filled from
     `api.rationai.viewerConfig.get(appId).job_defaults` (MPS `configuration.global`).
     String inputs listed in `STRING_SELECT_OPTIONS` (e.g. `script`) are a select.
   - Anything else is a plain text field for a resource id.
4. Run calls `EmpaiaStandaloneJobs.createAndRunJob({ appId, caseId, inputs, ead })`, which turns
   primitive values into `/primitives` resources, runs/finalizes the job and polls it to a
   terminal state. An AppBar badge shows Pending, then Completed or Failed; clicking it fits the ROI.
5. On `COMPLETED`, outputs are read from the job (`scope.jobs.get`) using the EAD `io`:
   - `collection` with `items.reference` is decoded by the `empaia` convertor and shown on the overlay.
   - `collection` without a reference holds values, shown in a "Job Results" window.
6. Every job with an id is recorded in the history together with its inputs and ROI bounds, so
   it can be rerun with an editable copy of its inputs. A rerun keeps the job name and stores
   `rerunOf` (the source job id), shown as a "rerun" badge. `hasAnnotations` records whether
   annotations were drawn; when it is `false` the card has no show/hide toggle. When it is
   unknown (an output failed to load), the first show records it.

Options
-------
- `jobHistory`: stored history (JSON, newest first, max 50 entries).
- `skipDrawROIModal`: set by "Don't show again" in the ROI hint modal.
- `caseId`: fallback case when the slide's case cannot be found.
