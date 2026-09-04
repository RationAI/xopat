# Testing against the EMPAIA tutorial apps

The `tutorial_app_01…14` apps in the EMPAIA App Test Suite are the manual test
matrix for this plugin. Each one exercises a different *io shape*, and the io
shape is what the UI has to get right — none of them is a real detector, so
**judge the plumbing, not the biology**.

The EADs are checked in at `modules/empaia-workbench/test/fixtures/ead/ta*.json`
and asserted by `test/unit/{inputs,outputs}.test.mjs`. That covers what an app
*resolves to*. This file covers what you should see on screen.

> **Their output coordinates are dummies.** Several apps emit a fixed point per
> detection (TA03 posts `coordinates: [250, 250]` for every one). Ten markers
> stacked in the slide corner is the app's actual answer, not a placement bug.
> Verify placement with the ROI you drew — it round-trips — not with the output.

`collection<X>` is written `X^1`, `collection<collection<X>>` is `X^2`.

## The matrix

| app | in | out | what it tests | look for |
|---|---|---|---|---|
| **TA01** | rectangle | `integer` | the minimum path: one region, one number | run enabled with exactly one ROI selected; the count in the results list |
| **TA02** | rectangle^1 | `integer^1`, `float` | **per-region table** — `items.reference: io.my_rectangles.items` | one table row per staged region, in staging order, plus the slide-wide average below it |
| **TA03** | rectangle^1 | `point^2` | annotation output nested two deep, and **no class output** | points land on the slide under a preset named **"TA03v3 my_cells"** — never "Unknown"; **no** results-table column for `my_cells`, and no `collections/…/items/query` request for it |
| **TA04** | rectangle^1 | `point^2`, `float^2` | a value that describes an *annotation*, not a region | a **Per-annotation values** section: one summary line (`confidence score — all 10 identical`) over a clickable row per point. **Not** in the run-level scalar table, and not only on the label |
| **TA05** | rectangle^1 | `point^2`, `class^2` | per-point classes arriving inlined (`with_classes=true`) | a preset is minted per class value; points are coloured by it; two output chips (shapes + tag), never "none could be read back" |
| **TA06** | rectangle^1 | `point^2` | same shape as TA03, but ~25 000 points — the volume is the test | three things in sequence: (1) at completion the row says **"Results not available yet — retry"**, never `my_cells: 0`; (2) the count appears on its own within ~30 s, and `GET /jobs` then **stops**; (3) the **budget gate** offers "load anyway", and clicking it puts the points on the slide *without* an eye toggle |
| **TA07 / TA08** | rectangle | `integer` | TA01 again with different app metadata | nothing new — use them to check the app picker and the stability/version badges |
| **TA09** | wsi^1, rectangle^2, float^2 | `integer^2`, `float^1` | **refusal to RUN, not to draw** — multi-slide input this viewer cannot fill | the yellow banner lists all three reasons and the run button refuses; **but** right-click → "Create job ROI" is live, drawing works, the region is stored with an id, and the panel section shows *"Regions are stored, but this analysis cannot take them as input."* The word "several" must appear **once**, in the banner — it is about slides, and quoting it at a region surface is the bug |
| **TA10** | rectangle | `point^1`, `float^1`, `class^1`, 2×`integer`, `float` | every output kind at once — and the only app where the three value sections coexist | shapes on the slide, classes as presets, the three run-level scalars in **Results**, the confidences in **Per-annotation values** — each in its own section, none duplicated |
| **TA11** | (3 modes) | polygon^1, class^1, float | `containerized: false` postprocessing | standalone runs; the postprocessing step is **listed and refused** — the app computes it in its own UI |
| **TA12** | (2 modes) | polygon^1 → class^1, float | postprocessing as a real step | preprocessing runs first; postprocessing consumes its outputs with no new user input (`from-job` inputs) |
| **TA13** | wsi | polygon^1, class^1, `integer`, `float`, **`nominal_pixelmap`** | pixel-map output | the map renders as an overlay layer; nothing to start (preprocessing only) |
| **TA14** | `fhir_questionnaire` | `fhir_questionnaire_response` | an io type this viewer does not implement | listed, refused, **with the io type named** in the reason |

## What to check on every app

1. **ROI round trip.** Draw a region, stage it, run. After the job finishes the
   rectangle is still exactly where you drew it and is marked locked (a job
   references it — the backend answers 412 to an edit).
2. **Show / hide.** Toggling the analysis puts its output on and off the slide
   without touching the ROIs it consumed.
3. **No silent empties.** "This analysis reports N result(s), but none of them
   could be read back" must only appear when the declared outputs really
   resolved to nothing. Any 422/4xx shows as the red *unreadable* chip with a
   retry, never as "produced nothing".
4. **Console is quiet.** A finished run should log no `output collection query
   failed`. That route's body model is closed — it takes neither `creators` nor
   `jobs` (see `Wbs3Client.queryCollectionItems`).
5. **Values land in exactly one section.** Run-level scalars in *Results*,
   one-per-region in *Per-region results*, one-per-annotation in
   *Per-annotation values*. A value appearing in two of them is a routing bug;
   so is a per-object value in the run-level table (it names nothing there).
6. **A large run stays responsive.** Above `annotationValueRows` (default 200,
   `ENV.plugins.empaia-app-ui`) the per-annotation list is not rendered at all —
   only its summary. Rows there instead of a summary means the cap is not being
   read.
7. **Polling stops.** Once every analysis is terminal and nothing is waiting on
   an output, `GET /jobs` must cease. A stream that continues forever after
   "completed" means a validation state is being read as pending (only
   `"RUNNING"` is) or an output wait never converged.
8. **"Produced nothing" is earned, not assumed.** A completed run that declared
   an annotation output and returned none is re-read up to `emptyOutputRetries`
   times within `emptyOutputWindowMs` (`ENV.modules.empaia-workbench`), showing
   "not available yet" meanwhile. Only after that may the row say the output is
   empty — and the retry button must always be able to overrule it.
9. **Nothing is called "Unknown".** TA03/TA04/TA06 declare no class output, so
   their shapes arrive unclassified and are filed under a preset named after the
   output (`"TA06v3 my_cells"`). "Unknown" in the annotation list means the
   fallback preset was reached, i.e. the output was not attributed. Apps that DO
   declare classes (TA05/TA10/TA11/TA12/TA13) must still show their class names,
   not the output name.
10. **No row reads "Invalid Date".** Imported annotations carry the wire's
    `created_at`; anything else shows no time rather than a broken one. Check a
    non-EMPAIA import too — the board formatter is shared.
11. **Drawing always works; only running is refused.** Right-click → "Create job
    ROI" is live for every app, including ones that can never be started here,
    and the region is stored with an id. A refusal to *run* belongs on the banner
    and the run button. A run-blocker sentence appearing on a region surface is
    the bug — check the wording actually matches what it is attached to.

## Running them

Apps are registered in the EATS instance the workbench points at; pick one in
the workbench, which hands this plugin the scope over VACI. Everything past that
handshake is WBS3 REST — see [`modules/empaia-workbench/README.md`](../../modules/empaia-workbench/README.md).
