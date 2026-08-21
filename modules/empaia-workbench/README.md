# EMPAIA Workbench v3 client

Makes xOpat usable as the **vendor app UI** of an EMPAIA examination: the
Workbench Client embeds the viewer in an iframe and pushes it a scope id, an
access token and the Workbench Service base URL; from there this module opens
the examination's slides, syncs annotations with the workbench data API, and
drives app jobs.

This module is **headless**. The panel lives in
[`plugins/empaia-app-ui`](../../plugins/empaia-app-ui/README.md).

Only **workbench v3** is supported (`/v3/scopes/...`, EAD with `io` + `modes`).

---

## What it registers

| Thing | Id | Purpose |
|---|---|---|
| Auth broker | `empaia-workbench` (context `empaia`) | Deposits the workbench token into `XOpatUser`; a 401 asks the embedder for a new one. |
| Slide protocol | `empaia_wbs3` | Factory protocol producing the slide and pixelmap tile sources. |
| Tile source | `OpenSeadragon.EmpaiaWorkbenchV3TileSource` | The examination's WSIs. |
| Tile source | `OpenSeadragon.EmpaiaPixelmapTileSource` | Job result pixel maps, colour-mapped client-side. |
| Annotation format | `OSDAnnotations.Convertor` `"empaia"` | xOpat annotations ⇄ EMPAIA annotation + class records. |
| IO sink | `empaia-annotations` (`crud`, `bundle`) | Annotation traffic to `/annotations` + `/classes`. |
| IO sink | `empaia-app-storage` (`bundle`) | Generic owner state in `/app-ui-storage`. |

---

## Configuration (`ENV.modules["empaia-workbench"]`)

```jsonc
{
  "permaLoad": true,
  // Guard against an embedder that never completes the handshake (ms).
  "handshakeTimeoutMs": 30000,
  // Tile transfer preferences, forwarded as image_format / image_quality.
  "tileFormat": "jpeg",
  "tileQuality": 90,
  // Job status poll interval while anything is non-terminal.
  "jobPollMs": 2000,
  // Optional: route every workbench request through a server proxy alias
  // declared under `server.secure.proxies`. Leave null when the workbench is
  // reachable from the browser (the usual case).
  "proxy": null,
  // Which app-ui-storage bucket generic bundles land in: "scope" (shared by
  // the examination) or "user" (private to the current user).
  "appStorageKind": "scope",
  "autoOpenFirstSlide": true
}
```

`authMode`, `authContext` and `proxy` are read with `getStaticMeta` only — a
session bundle can never redirect the backend or downgrade auth (AGENTS.md §7).

### Annotation routing (claimed automatically)

The module claims `crud:annotation` and `bundle-export` for the annotations module
at boot (`IO_PIPELINE.claimBinding`, resolution rule 2.5), so a default deployment
needs no binding and there is exactly one annotation write path. Override or
disable it from ENV — an explicit binding always outranks the claim:

```jsonc
"client": { "io": { "bindings": {
  // optional: makes the routing visible; same result as the claim
  "annotations":   { "crud:annotation": ["empaia-annotations"],
                     "bundle-export":   ["empaia-annotations"] },
  // other owners must still be bound by hand — nothing claims these
  "slide-scoring": { "bundle-export":   ["empaia-app-storage"] }
} } }
```

To stop syncing annotations entirely, use
`"disabledCapabilities": [["annotations", "crud:annotation"]]`.

`bundle-import` is claimed as well, so hydration is the pipeline's job: the sink
resolves the slide from the dispatch context (`getMappingContextFor` →
`_slideIdForIoContext`) rather than from the active slide, which is what used to
make it wrong under multi-viewport. The module therefore has **no** hydration
method of its own — restore-on-slide-enter, flush-on-slide-leave and the
double-hydration guard all come from core.

`IO_PIPELINE.listBindingClaims()` shows the claims, including ones an explicit
binding is currently overriding.

### `refuseUnrepresentableShapes` (default `true`)

EMPAIA has no model for text, angle, group or multipolygon annotations. With the
default the module registers a `pre-create` guard that refuses them while the user
is still drawing, so nothing is added and the reason is stated. Set it to `false`
to allow them as local-only scratch work — they render, they are never stored, and
they are lost on reload; the user is warned once per shape type.

### Browser storage is not available in the Workbench

The Workbench frames the app UI with a `sandbox` attribute that omits
`allow-same-origin`, so the viewer runs on an **opaque origin**. There,
`localStorage`, `sessionStorage`, `document.cookie` and `indexedDB` all throw
on access — reading the *property* is enough. xOpat detects this at boot and
substitutes in-memory KV drivers (one `console.warn`, no user-facing error),
so everything keeps working but **nothing persists past the tab**: no remembered
panel layout, no shortcut remaps, no last-session restore. That is by design for
this embedding; do not "fix" it per-feature.

Two consequences worth planning around:

- A feature that *needs* durable per-user state must persist it through the
  Workbench itself (`empaia-app-storage`) or another server-side sink — not
  through `this.cache`.
- OIDC login cannot complete inside the sandbox (redirect and popup flows both
  need a real origin). The Workbench supplies the token over the bridge instead.

A deployment that is *only* ever embedded can state this explicitly rather than
relying on detection, by binding the KV namespaces to `memory` in
`ENV.client.<active>.io.bindings.core` — see
[`src/IO_PIPELINE.md`](../../src/IO_PIPELINE.md#sandboxed--opaque-origin-operation).
Standalone use is unaffected: `bridge.notEmbedded` is true, storage probes pass,
and the viewer behaves normally.

---

## Workbench communication

Handled entirely by the official
[`@empaia/vendor-app-communication-interface`](https://www.npmjs.com/package/@empaia/vendor-app-communication-interface)
(VACI) package — a direct dependency of this module, bundled into
`index.workspace.js`. There is no local re-implementation of the protocol.

Two call sites, and that is all:

- `index.ts` registers `addScopeListener` / `addWbsUrlListener` /
  `addTokenListener` in its constructor. VACI sends the `scopeReady` /
  `tokenReady` / `wbsUrlReady` handshake itself on the first listener added, and
  its emitter replays the last value to a late subscriber — so there is no
  ordering race to guard against.
- `auth-broker.ts` uses `addTokenListener` to forward the token into
  `XOpatUser`, and `requestNewToken` as the 401 refresh path.

Pinned at `^0.1.34` — npm's latest. The upstream monorepo carries an unpublished
0.1.37; the protocol is identical between them.

### What that means for trust

**VACI does not validate the sender's origin.** It listens for any `message`
event, dispatches on `data.type` alone, and adopts the sender's origin as its
reply target. We adopt that posture rather than working around it, because in
this embedding it is a narrow exposure: the Workbench serves the app UI on an
**opaque origin** inside a sandboxed iframe, behind a signed-token path
(`/v3/frontends/<JWT>/`), so the realistic — and intended — sender is the
Workbench parent frame.

If you deploy this module somewhere the frame is *not* sandboxed and other
origins can obtain a handle to the window, that assumption no longer holds.

Two things are still checked, neither of them a security policy:

- `wbsUrl` must parse and be `http:`/`https:` before it becomes an `HttpClient`
  `baseURL` (`parseBackendUrl` in `index.ts`) — otherwise a malformed value
  resurfaces as a confusing failure deep in the request path;
- the token is never logged, persisted, or put in a URL.

### One upstream quirk

`requestNewToken()` posts to the origin VACI recorded from the last inbound
message, so it only works once a token has already arrived. That is exactly the
401-refresh case that calls it, so it is not worked around.

---

## Why this module is an auth *provider*

The rule in xOpat is that **consumers** use `HttpClient` transparently and never
touch auth events, while **auth providers** subscribe to events to deliver their
particular token type. This module is a provider, and cannot be a consumer of an
existing OIDC/SAML context:

- the WBS scope token is minted **by the workbench** for one examination (its JWT
  carries `app_id` / `app_ui_url` / `token_id`) and arrives over VACI — it is not
  a user-IdP token, and WBS does not accept one on the scope routes;
- the app UI runs sandboxed on an **opaque origin**, where redirect and popup
  OIDC flows cannot complete at all.

So `auth-broker.ts` registers a broker for the `empaia` context and owns its
whole lifecycle. Three consequences worth knowing before editing it:

- **`setWorkbenchIdentity()` must never call `logout()`.** On a non-core context
  `XOpatUser.logout()` also clears that context's secrets
  (`src/classes/user.ts` `_clearContextSecrets`), so a logout/login cycle throws
  the workbench token away — the next request goes out with no `Authorization`
  header and the workbench answers 403. `login()` overwrites the identity in
  place and never touches `_secret`; re-asserting is enough.
- **Renewal runs through `secret-needs-update:<ctx>`.** `HttpClient`'s
  `refreshOn401` calls `XOpatUser.requestSecretUpdate`, which *rejects* unless a
  provider is subscribed. The handler asks the workbench via `requestNewToken()`.
- **`whenSettled` reports readiness.** `init()` only registers the VACI listener;
  the token lands later. Without the hook core waits a blind 1.5 s grace before
  every early request.

A caveat on **403 vs 401**: `HttpClient` refreshes only on 401. The workbench
returns 403 when the `Authorization` header is *absent* (FastAPI's bearer
scheme), which is not a refreshable condition and should no longer occur. If a
deployment turns out to answer 403 for genuine expiry, the refresh path will not
fire.

---

## Backend surface used

Base `{wbsUrl}/v3/scopes/{scope_id}`:

| Area | Routes |
|---|---|
| Scope | `GET /` (id, app_id, case_id, examination_id, user_id, **ead**) |
| Slides | `GET /slides`, `GET /slides/{id}/info`, `…/tile/level/{l}/tile/{x}/{y}`, `…/thumbnail\|label\|macro/max_size/{w}/{h}` |
| Annotations | `POST /annotations`, `PUT /annotations/query`, `DELETE /annotations/{id}` |
| Classes | `POST /classes`, `PUT /classes/query` |
| Collections | `POST /collections`, `POST /collections/{id}/items`, `PUT /collections/{id}/items/query` |
| Primitives | `PUT /primitives/query` |
| Pixelmaps | `PUT /pixelmaps/query`, `GET /pixelmaps/{id}`, `GET /pixelmaps/{id}/level/{l}/position/{x}/{y}/data` |
| Jobs | `POST /jobs`, `PUT /jobs/{id}/inputs/{key}`, `PUT /jobs/{id}/run`, `PUT /jobs/{id}/stop`, `GET /jobs`, `DELETE /jobs/{id}` |
| Storage | `GET\|PUT /app-ui-storage/{scope\|user}` |

Annotation coordinates are level-0 image pixels — the same space xOpat's fabric
canvas uses, so no transform is needed beyond the annotations module's own
`imageCoordinatesOffset`.

### The `*/query` selector rule

Every `PUT …/query` route runs the same server-side validation
(`workbench_service … annot_connector.validate_query`), and it is stricter than
the OpenAPI schema suggests: the body must **select** by either `creators` or
`jobs` — the two are **mutually exclusive** — or consist solely of the item id
list (annotations/classes/primitives/pixelmaps only; collections have no such
escape hatch). A `references`-only body, the intuitive "everything on this
slide", is a **400**, not an empty result.

`Wbs3Client._scopedQuery` fills the gap: a body with no selector gets
`creators: [scopeId]` — "what this scope authored". Bodies that already carry
`jobs` (job results, from `job-runner.ts`) pass through untouched. Callers
therefore only ever set the filters they care about. Two consequences worth
knowing: reading *another* scope's annotations means passing `creators`
explicitly (and the service 412s anything outside the examination's scopes), and
job output plus own ROIs cannot come back in one request.

---

## Annotation mapping

| xOpat factory | EMPAIA type | geometry |
|---|---|---|
| `rect` | `rectangle` | `upper_left`, `width`, `height` |
| `polygon` | `polygon` | `coordinates` |
| `ellipse` | `circle` | `center`, `radius` |
| `point` | `point` | `coordinates` |
| `line` / `polyline` | `line` | `coordinates` |
| `arrow` | `arrow` | `head`, `tail` |

An xOpat preset becomes an EMPAIA `Class` attached to the annotation. Presets are
seeded from `GET /class-namespaces` (see below) and coloured from the EAD's
`rendering.annotations` hints, so job results arrive in the colours the app
author intended.

**The class list is closed, and the UI says so.** The module declares those class
values as the annotation module's *vocabulary*
(`presets.setVocabulary({ metaKey: "empaiaClass", allowFreeform: false })`), which
mounts a `crud:preset` guard refusing any preset whose class is not one of them.
Before that, the preset editor offered a free-text class field, the user typed
something the app's namespace does not contain, and `_classValueForPreset` dropped
it silently on the way out: the geometry stored, the classification did not, and
nothing in the UI revealed the loss. The editor now offers a picker over the
permitted values instead of a "new class" button.

Two deliberate escapes:

- **Unclassified is always allowed.** An annotation with no class is a perfectly
  valid EMPAIA annotation, and it is the default so drawing never requires
  deciding on a class first.
- **A class that arrives from the backend is admitted on import**
  (`presets.extendVocabulary`, `creatable: false`). A job emits its own output
  classes, which this scope may not author; refusing them would lose data that is
  already stored server-side, while offering them would let the user author
  something the service rejects.

If `GET /class-namespaces` fails, the module degrades **closed**: the permitted
set becomes empty and no class is posted at all. Leaving it undefined meant the
filter was skipped entirely, so an unvalidated value went to the service in
exactly the situation where least is known about what it accepts.

Two lossy edges, declared through the convertor's `lossy` / `lossyReason` so the
export UI warns:

- an ellipse with `rx !== ry` has no EMPAIA representation and exports as a
  circle of the mean radius;
- an EMPAIA `arrow` imports as an xOpat `line` (rebuilding xOpat's arrow — a
  fabric Group of shaft + head — from outside its factory would couple us to
  internals). `empaiaType` is remembered, so a re-export is still an `arrow`.

Text, angle, group and multipolygon annotations have no EMPAIA counterpart and
are skipped with a console warning rather than failing the batch.

---

## Persisting annotations

Everything the user draws is written to the workbench — ROIs (which become job
inputs) and ordinary annotations alike — through **one** path: the annotations
module dispatches every create/update/delete to its `crud:annotation` resource,
and the `empaia-annotations` sink is what that resource is bound to (claimed at
boot, see above). Nothing in this module or in `plugins/empaia-app-ui` posts
annotations directly.

That matters beyond tidiness. Going through the resource is what supplies the
retry, the persistent outbox with boot replay, ordering per annotation, the
offline pause/resume, and — critically — the post-commit rollback: an annotation
the backend refuses is put back on the canvas *and* its history entry dropped,
instead of the user looking at a slide that disagrees with the record. This
module used to keep a second, private write path (`persistAnnotation` and
friends) precisely because the sink could not bind itself; that path had none of
the above, and once a binding did exist it double-posted. It is gone.

The link between a local annotation and its server record is the `empaiaId`
stamped on the object, registered via `registerPersistedProperties` so it
survives import and undo (the module's import trim drops unregistered
properties — an annotation that lost its `empaiaId` was unaddressable, which is
why deletes used to reach nothing). The `incrementId → empaiaId` map is only a
per-session cache over that; `_indexHydratedAnnotations` rebuilds it after each
import, and `resolveEmpaiaId` repairs it from the canvas.

Hydration deliberately does **not** dispatch: `addAnnotationsBulk` persists only
when the caller asks, and the load path does not. Otherwise every hydrated
annotation would be posted straight back at its own source.

## Which analysis is shown

> **Invariant:** everything a shown analysis produced — annotations, pixel maps and
> primitives — is on the slide, and nothing an unshown one produced is. The default
> is the single most recently **completed** analysis.

### `creator_type` casing is not what the schema says — never compare it directly

Attribution rests entirely on one wire field: for a job-created record, `creator_id`
**is** the producing job's id. The schema documents `DataCreatorType` lowercase
(`"job" | "user" | "scope"`), but the service sends a different casing — its sibling
`JobCreatorType` is uppercase throughout — and the value arrives as JSON, so
TypeScript cannot catch a mismatch.

An exact `creator_type === "job"` therefore answered `false` for every record, and
because each site failed *quietly* the damage was spread across four subsystems at
once: annotations were imported with no `empaiaJobId` (so eviction matched nothing
and the eye toggle was a no-op), job output was not marked `readOnly`, the hydration
filter excluded nothing (so every analysis ever run was loaded on slide open), and
pixel maps were never attributed (so their layers never followed the analysis).

Use `isJobCreated(record)` from `types.ts` — the single normalized predicate — for
annotations, primitives and pixel maps alike. `isJobOwned()` applies the same rule to
the native property the convertor stamps, so the wire check and the canvas check
cannot drift.

**Annotations no longer depend on that predicate at all** for attribution. The
convertor's primary route is `ctx.isJobId(creator_id)` — "is this creator one of the
examination's analyses?" — answered from the polled job list, with `isJobCreated` kept
as the fallback. `loadResults` splits its response the same way (`creator_id` in the
queried set = produced). An input ROI's `creator_id` is the scope id, so it can never
match, and no casing change can turn attribution off again.

Two safeguards back it up, because the failure was invisible from the UI:
`syncJobAnnotations` treats *unattributable* job output as stale and evicts it (a
canvas polluted by an earlier build heals on the next reconcile), and the import path
warns once per analysis when a job's records do not report as job-created.

Results accumulate otherwise, and job output cannot be deleted (412 — it belongs to
the job's scope), so after a few runs the slide is unreadable.

**This module owns the decision**, not the panel. `_visibleJobs` is a per-slide set
and the only source of truth; `setJobVisible` / `showOnlyJob` / `hideAllJobs` change
it, and every change ends in one reconcile that makes all three output kinds agree:

| Output | Attribution | How presence is applied |
|---|---|---|
| Annotations | `empaiaJobId` on the object | `syncJobAnnotations(jobIds, viewer, slideId)` evicts and fetches |
| Pixel maps | `Pixelmap.creator_id` | the layer's `visible` flag on the viewer's renderer, then `drawer.rebuild(0)` |
| Primitives | `Primitive.creator_id` | cached per job, rendered in the panel's detail pane |

Pixel-map visibility deliberately does **not** go through a slide re-open: flipping
`visible` on `renderer.getShaderLayer(id).getConfig()` is the same live path the
shader side menu uses, whereas a re-open refetches every tile of the slide to change
an overlay. The stored visualization is mirrored afterwards so a genuine re-open
restores the same picture. A map with no known producer (nothing said which job made
it) keeps the old "first one only" default and is left to the layer panel.

The reconcile is serialised per slide — it fetches, and two overlapping reconciles
would race the canvas into a state nobody asked for — and resolves viewers by
`tileSourceId` (`getViewersForSlide`), never `window.VIEWER`, so a multi-viewport
grid paints the viewport showing the slide rather than the focused one.

Job lists are likewise per slide: `GET /jobs` returns the whole scope in one
response, so `JobRunner` buckets it by the slide each job names as its WSI input and
emits `jobs-changed` per slide — and only when that slide's list actually changed
(the runner polls; an unconditional emit re-rendered the UI on a timer).

Presence is **derived, never stored**. Job output is a projection of server records,
so evicting it costs nothing and re-fetching it is one query — which means there is
no hidden-set to persist, nothing to keep in sync across a reload, and no way for the
canvas to disagree with the panel. Eviction goes through the annotations module's
`dropAnnotations` (no IO dispatch, no guards, no history), and **nothing reaches the
wire**: hiding an analysis issues no `DELETE`, and the record is untouched. The
bundle sink is additive (`writeBundle` uploads only what is missing), so an evicted
annotation is not deleted server-side either — do not copy this pattern to a
destructive sink without re-checking that.

Consequences worth knowing:

- **The hydration read skips job output entirely** (`readBundle` filters
  `creator_type === "job"`). The job list usually has not loaded when a slide opens,
  so restoring results there would flash every analysis ever run and have most
  evicted a moment later. `syncJobAnnotations` is the single owner of that presence.
- A failed or still-running analysis does **not** displace the last good result — the
  default follows the newest *completed* run, not the newest created one.
- The default stops applying the moment the user makes a choice on a slide
  (`_visibilityUserOwned`). The job runner polls, and re-deriving afterwards would
  silently undo a comparison the user had just set up by showing an older run.
- Imported annotations carry `empaiaJobId` (from the wire `creator_id`, which for a
  job's output *is* the job id). It is in `REQUIRED_EXPORT_PROPS`, so it survives the
  annotations module's import normalization — without that, nothing could tell one
  analysis's output from another's.
- Re-import is deduplicated against the ids already resident **on the canvas**. A
  "seen ids" set cannot serve: an id fetched once may since have been evicted, and
  trusting it would make ticking an analysis silently do nothing.
- **`jobs: [id]` does not mean "what this job produced".** It selects every record
  *locked in* the job — its output **and the ROIs it consumed**. `loadResults`
  therefore splits the response: `annotations` (produced, `creator_id` is the job
  id) and `lockedInputs` (consumed, ids only). Only the first half is ever
  imported or evicted. Importing the whole response, as this once did, put the
  user's own region under the analysis's name: the panel counted it as output, the
  focus button could not frame it (no `empaiaJobId`), and hiding the analysis left
  it on the canvas — an eye that visibly did nothing.
- **The regions an analysis consumed follow its eye.** They are the user's own
  annotations, so they are never evicted — instead the module registers an
  annotations-module *visibility gate* (`registerVisibilityGate`) that hides a
  locked ROI while no analysis using it is shown. Otherwise "Hide all" cleared
  the results and left the slide covered in ROIs the user cannot delete either.
  Three deliberate exceptions stay visible: a region no analysis has consumed
  (live work), one whose locking job is still running (taking it away the moment
  the user submits it is the opposite of feedback), and one whose holder is only
  known from a backend refusal — no visibility decision can honour that.
- **Primitives are queried without `references`.** A job's scalar output is stored
  with `reference_id = NULL` (it describes the run, not the slide), so a reference
  filter drops every value the app computed and a completed analysis shows no
  result at all. `jobs` alone is a legal selector (`_scopedQuery`). Annotations and
  pixel maps do carry a reference and keep theirs.

Five backend constraints are invisible in the OpenAPI schema and each one costs a
debugging session if forgotten. All verified against `workbench-service:0.13.3`:

- **Post one object per request — never `{ items: [...] }`.**
  `annot_connector.validate_post_data` (`api/v3/connectors/annot_connector.py:108-118`)
  recurses into `items` and then *falls through without returning*, so it
  re-checks `creator_id` on the wrapper — which has no such field. Every batch
  POST answers `412 "Creator_id must be set to scope_id"` regardless of content.
  Affects `POST /annotations`, `/classes`, `/primitives`, `/pixelmaps`.
- **`is_roi=true` is what makes an annotation a ROI.** The flag (`routes/scopes/data.py:175-188`)
  makes the service attach `org.empaia.global.v1.classes.roi` itself
  (`post_roi_class`), so we must not post that class ourselves.
- **Class values are closed.** Only the global namespace plus the app's own EAD
  namespace are accepted (`namespace_validation.validate_class_value`); anything
  else is `400 "Invalid class name for EAD"`. `GET /class-namespaces` returns the
  same dict the validator uses — it is the authority, and the module refuses
  out-of-namespace values client-side rather than letting them 400. An annotation
  whose preset maps to no permitted class is still stored, just without a class.
- **The examination must be OPEN**, else `423` (`es_connector.validate_examination_state_open`).
- **There is no update endpoint.** An edit is delete + re-post and therefore
  **mints a new server id** — which is why an edit is refused wherever a delete
  would be.

### What can no longer be deleted, and why the UI must know first

Two permanent refusals, both discovered only *after* the annotation is already
off the canvas unless the UI predicts them:

- **`423 Locked`** — raised by *annotation-service*, not the workbench
  (`api/v3/clients/utils/annotation_utils.py:174-201`, proxied through MDS). The
  condition is **"a job references this annotation"** (`v3_j_job_classes` /
  `v3_j_job_collections`), **not** `is_locked` (dead in v3, always null) and
  **not** `creator_type`. A job locks its **inputs** the moment it *runs*
  (`routes/scopes/jobs.py:287`), its outputs on `finalize` / examination close —
  and **there is no unlock route**, so the lock outlives the job's completion.
  Hence the guard's predicate is "this job has left `ASSEMBLY`", never "this job
  is still running".
- **`412`** for anything a job *produced*: `delete_annotation` compares
  `creator_id` with the scope id, and a job's output carries the job's id. Job
  output can never be deleted or edited from here. The convertor therefore imports
  it with the annotations module's own **`readOnly`** flag set, which the module
  enforces at `pre-update` / `pre-delete` and renders as a locked object. That is
  a core mechanism, not an EMPAIA one — the plugin no longer duplicates the test.
  `empaiaCreatorType` is still imported (and registered as persisted) so the
  message can say *why* it is locked.

The lock table is reachable through no route, but two things that *are* readable
say the same thing, and the module records both in `_lockedAnnotations`
(id → locking job), applying `setAnnotationReadOnly` to whatever is on the canvas:

- **`job.inputs`** of every job past `ASSEMBLY` — the very map the backend checks.
  Present in the polled list, so no extra request. Slide ids are skipped (the WSI
  is an input too); collection ids are harmless, they match no annotation.
- **`lockedInputs`** from a job's result query — the only route that sees the
  *members* of a collection input, whose ids never appear in `job.inputs`.

Predicting through the plugin's ROI list instead is what failed: that list is
keyed on the ROI preset, so a region it had not adopted (hydrated under another
preset, list not yet rescanned) passed the guard and the user met the lock as a
raw `{"detail":"Annotation is locked"}` toast from the backend.

What is still not predicted is caught after the fact: a sink refusal reverts
the local commit through the call's `inverseApply` (`rollbackOnAsyncRefuse`, on by
default) and drops its history entry, so the annotation comes back and the user is
told. `replaceAnnotation` used to opt out of that rollback; it no longer does, so a
refused *geometry* change is covered on the same path — which is also why the
plugin's hand-rolled `_recoverFromRefusedDelete` could be deleted. A **permanent**
refusal (412/423) additionally feeds `_lockedAnnotations`, so the same record is
refused locally next time instead of making the round trip again.

The refusal body itself is unwrapped by `errors.ts`: the stack sends `detail` as a
sentence, as `{cause}`, and — the annotation routes — as a nested `{detail}`. Only
a sentence is ever shown; a shape with none falls back to the caller's translated
message, because `JSON.stringify(detail)` is how a pathologist came to read
`{"detail":"Annotation is locked"}` in a toast.

---

## Jobs

The choreography is dictated by the backend and mirrors the reference AppUI's
NgRx effects (`apps/generic-app-ui-v3/src/app/jobs/store/jobs/jobs.effects.ts`):

**single-ROI app** (`getRoiMode() === "single"`)
`POST /jobs` → set the `wsi` and ROI inputs **in parallel** → wait for both to be
acknowledged → `PUT /run`. Running before both land is refused by the backend.

**multi-ROI app** (`"multiple"`)
`POST /jobs` → set the `wsi` input → one `POST /collections` per collection input
key → bind each as a job input → `POST /collections/{id}/items` per ROI → the
user runs explicitly, after adding as many regions as they want.

Polling ticks while any job for the current (slide, mode) is non-terminal and
stops once they all are — status *and* input/output validation. All job traffic
uses the `background` scheduler lane so it never competes with tile loading.

`PREPROCESSING` jobs are listed read-only: the user cannot create preprocessing
regions, so they cannot create, run, stop or delete those jobs either.

---

## Pixel maps

Result pixel maps are raw typed-array tiles (`element_type`, `tilesize² ×
channel_count`, **planar per channel**). `EmpaiaPixelmapTileSource` fetches them,
colour-maps them into an RGBA canvas and hands OSD a finished `context2d` — so
the overlay rides an ordinary `identity` shader layer instead of needing a
bespoke GPU path.

- nominal maps → `element_class_mapping` colours, seeded from the EAD's
  `rendering.nominal_pixelmaps` hints, else a stable categorical palette;
- continuous / discrete maps → normalized by `min_value`/`max_value` through a
  selectable colour map; `neutral_value` renders fully transparent;
- positions outside a level's `position_min/max_{x,y}` bounds are answered
  locally with a transparent tile and never hit the network.

Buffers are length-checked against the declared geometry before being viewed as
a typed array.

---

## Public API (for `plugins/empaia-app-ui` and scripting)

```js
const wb = singletonModule("empaia-workbench");
await wb.whenReady();

wb.getScope(); wb.getEad(); wb.getSlides(); wb.getActiveSlideId();
await wb.openSlide(slideId);

wb.getAvailableModes(); wb.getActiveMode(); wb.setActiveMode("standalone");
wb.getRoiTypes(); wb.getRoiMode(); wb.checkModeCompatibility();

wb.activateRoiTool(roiType);            // drives the annotation module
wb.empaiaIdOf(incrementId);             // local id → server id, once persisted
wb.isEmpaiaViewer(viewer); wb.slideIdOfViewer(viewer);

// Annotations are NOT written or read through this module's API: every
// create/update/delete goes through the annotations module's `crud:annotation`
// resource, and hydration through `bundle-import` — both bound to the
// `empaia-annotations` sink. There is no `persistAnnotation` /
// `deleteAnnotationRemote` / `hydrateAnnotations`; a second path here is what
// used to double-post and to lose refusals.
await wb.syncJobAnnotations(jobIds, viewer);   // job OUTPUT presence only

const runner = wb.getJobRunner();
await runner.runStandalone({ roiIds, roiType }, { autoRun: true });
await runner.loadResults(jobIds, slideId);

await wb.registerPixelmaps(slideId, pixelmaps);
wb.getPixelmapSource(pixelmapId, channel);
```

Events (`wb.addHandler(...)`): `ready`, `failed`, `slides-changed`,
`slide-changed`, `mode-changed`, `jobs-changed`, `pixelmaps-changed`,
`annotation-linked`.

---

## Not supported

- Workbench v1 / v2 (`/v1`, `/v2` scopes, EAD with top-level `inputs`/`outputs`).
- `POSTPROCESSING` and `REPORT` job modes.
- Writing primitives, collections or pixel maps back to the workbench — this UI
  consumes app output, it does not produce it.
- Standalone operation: without a workbench client embedding it, the module
  reports `notEmbedded` and stays inert by design.
