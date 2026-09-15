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
  // Job status poll interval while anything is non-terminal — a FLOOR: idle
  // ticks back off geometrically towards `jobPollMaxMs`.
  "jobPollMs": 2000,
  "jobPollMaxMs": 30000,
  // How many annotations one analysis may deliver before the user is asked
  // rather than served. 0 disables the gate.
  "annotationBudget": 5000,
  // How many analyses' results stay cached in memory (LRU).
  "jobOutputCache": 12,
  // Re-reads allowed before a completed-but-empty annotation output is believed
  // to be empty, and the window they live in. 0 restores the single read.
  "emptyOutputRetries": 5,
  "emptyOutputWindowMs": 60000,
  // Upper bound for "Show all" — every shown analysis imports onto the canvas.
  "maxVisibleJobs": 8,
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
whole lifecycle. Four consequences worth knowing before editing it:

- **The token's `exp` is load-bearing, and `token-expiry.ts` is the only way to
  read it.** VACI's wire model is `{ value, type }` — there is no `expires_in`
  and no expiry on the message — so the lifetime comes from decoding the JWT
  locally. That decode is **never** a verification: the Workbench Service is the
  only authority on whether a token is acceptable, and a token this module
  cannot parse is treated as live, because locking a working session out is a
  worse failure than the one being prevented. Two things depend on it:
  `isAuthenticated` (below) and the proactive renew armed at `exp − 60 s`
  (clamped to half the lifetime; `renewDelayMs` is the same arithmetic as
  `modules/saml-auth/renew-window.ts`, kept identical by hand because neither
  can import the other). Without the renew, a long session is guaranteed one 401
  per token lifetime, and it then asks for a replacement at the worst possible
  moment — after the credential is dead, and possibly after the workbench has
  stopped answering for this frame at all.

- **`setWorkbenchIdentity()` must never call `logout()` — and must never change
  the context's identity id.** On a non-core context both `XOpatUser.logout()`
  *and* a `login()` whose id differs from the one in place clear that context's
  secrets (`src/classes/user.ts` `_clearContextSecrets`), throwing the workbench
  token away: the next request goes out with no `Authorization` header and the
  workbench answers `403 {"detail":"Not authenticated"}`. This bit twice — first
  as a logout/login cycle, then as "refine the label to `scope.user_id`", which
  is an identity **swap** because the token listener installs the scope id.
  The identity id therefore stays the scope id for the session and the workbench
  user id is carried as the display `name`, which takes `login()`'s re-assert
  path (refreshes `{id,name,icon}`, raises nothing, keeps `_secret`).
  Consequence: `getUserId("empaia")` reports the scope id.
- **Renewal runs through `secret-needs-update:<ctx>`.** `HttpClient`'s
  `refreshOn401` calls `XOpatUser.requestSecretUpdate`, which *rejects* unless a
  provider is subscribed. The handler asks the workbench via `requestNewToken()`.
  It waits `TOKEN_WAIT_MS`, which must stay **under** core's own refresh window
  (`XOpatUser.requestSecretUpdate` defaults to 20 s and `_maybeRefreshSecrets`
  does not override it): waiting longer means core gives up first, drops its
  `secret-updated` handler and retries with the credential that just failed,
  while this broker is still waiting for the replacement.
  The binding is latched separately from the VACI listener, because a call that
  arrives before `XOpatUser` exists can register the listener but not the
  handler — latching both together left `requestSecretUpdate` rejecting with
  *"no provider listens"* for the rest of the session.
- **`whenSettled` reports readiness.** `init()` only registers the VACI listener;
  the token lands later. Without the hook core waits a blind 1.5 s grace before
  every early request.

On **403 vs 401**: the workbench returns 403 when the `Authorization` header is
*absent* (FastAPI's bearer scheme) and 401 only once a header is present and
rejected. `HttpClient` refreshes on `auth.refreshOnStatuses`, which defaults to
`[401]`, so `wbs3-client.ts` passes `[401, 403]` — otherwise a context that lost
its token is served 403s nothing retries and the session is dead for the tab.
Core pairs with it: a request that carried **no** credential asks the provider
instead of retrying bare, so the 403 drives `secret-needs-update:empaia` →
`requestNewToken()` → retry. `job-runner.ts` treats both statuses as "waiting for
a token" rather than a transport fault.

### An expired token is not a credential

`isAuthenticated` used to answer *"is there a non-empty string?"*. An expired
token is a non-empty string and nothing ever removes it, so one wrong answer
propagated everywhere:

- `XOpatAuth.isAuthenticated` prefers the broker's verdict, so the context
  reported itself authenticated for the rest of the session;
- `whenContextSettled("empaia")` therefore resolved `"authenticated"` in a
  microtask — the job runner's "stop and wait for a credential" waited for the
  dead token it already had, and resumed straight into the next 401. Neither
  brake applies on that path (`MAX_POLL_FAILURES` deliberately does not count a
  401, and `startPolling` resets both it and the idle backoff), so the result was
  `GET /jobs` at round-trip rate for the life of the tab;
- the escalation in the refresh handler was guarded on the token being *absent*,
  so the badge, the request hold and the recovery scrim — the whole point of
  reporting it — were dead surface in exactly the case they were written for.

`isTokenLive` (`token-expiry.ts`) is the predicate now, with a 5 s skew so a
token that would die in flight is not called live. Everything above follows from
it being right.

The resume is the second half: `index.ts::_resumePolling` **reads the verdict**.
On `true` it polls; otherwise it parks and arms a one-shot
`APPLICATION_CONTEXT.auth.onSettled` watch, so a credential landing by any route
— a proactive renew, a fresh workbench push, a click on the recovery badge —
restarts it. It waits with `{awaitInteractive: true}`, so a sign-in the user has
actually started is waited out rather than answered `"needs-interaction"` the
moment it begins.

When even that cannot help — the workbench has stopped answering `tokenRequest`
for this frame, which is what an expired app-frontend token
(`/v3/frontends/<JWT>/`) looks like from in here — the generic "Sign in" affordance
is a dead end, because the click lands back in `requestNewToken()`. The module
says the one thing that does work (`error.tokenUnrecoverable`: reopen the app
from the Workbench), once per session, re-armed when a token lands.

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

### What "locked" does NOT forbid

**Delete and update. That is the whole surface.** Every enforcement point in this
repo tests exactly `pre-delete` / `pre-update` — the ROI-lock guard, the job-owned
guard, and the annotations module's own `readOnly` guard — and
`POST /collections/{id}/items` has no lock precheck at all.

So an annotation one analysis consumed **can still be handed to another run**. It
cannot be moved, edited, re-classified or deleted; it can be selected and staged
again. This is stated here because its absence caused the bug: a UI that collapsed
"cannot be edited" into "cannot be used" made previously-analysed regions vanish
from every offer without a word — and the natural workflow is precisely to show
analysis A, look at the regions it ran on, and run analysis B over the same set.

The client mirrors the split with two independent verdicts
(`plugins/empaia-app-ui/sections/region-eligibility.mjs`): **analysable** ignores
the lock, **convertible** does not, because giving an annotation the ROI preset is
a preset change and therefore an update. `markAsRoi` refuses a locked object for
that reason and that reason only.

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

## What an app has to declare, and what this viewer can fill

`inputs.ts` describes a mode's inputs once, and every other decision — can this
run, what does the drawing tool produce, what does a job need wiring to — reads
off that description. Five sources:

| source | filled by | example |
|---|---|---|
| `wsi` | the open slide | `"my_wsi": {"type": "wsi"}` |
| `roi` | one region the user draws | `"my_rectangle": {"type": "rectangle"}` |
| `roi-collection` | the staged batch | `{"type": "collection", "items": {"type": "rectangle"}}` |
| `from-job` | an earlier job's output | postprocessing's `my_cells` |
| `unsupported` | nothing — the mode is blocked, with a reason | a `collection` of `wsi` |

**Provenance beats shape.** A `collection<polygon>` looks like something a user
could draw, but if another mode of the same app declares it as an *output* it is a
result being consumed, not a request. Classifying by shape first is how a
postprocessing run would have asked a pathologist to hand-draw the cells
preprocessing had already found.

`modeBlockers` turns everything unfillable into sentences, and
`EmpaiaWorkbench.runBlockers` is what **every** run path calls before creating
anything. That gate is the point: the old `checkCompatibility` fed a banner and
nothing else, so a UI could say "this app analyses several slides at once, which
this viewer cannot do" and then start the job anyway.

### The tutorial apps

`test/fixtures/ead/ta01…ta14.json` are the EMPAIA sample apps, and
`test/unit/inputs.test.mjs` asserts the resolved sources and blockers of each. It
is the regression net for the whole matrix — a new app shape either resolves to
sources this viewer can fill, or it names a blocker; never neither.

| app | shape | here |
|---|---|---|
| TA01, TA07, TA08 | slide + one rectangle, scalar out | runs |
| TA02 | slide + rectangle collection, per-region scalars | runs, per-region table |
| TA03, TA06 | outputs are `collection<collection<point>>` | runs; the points land on the slide and are **not** queried as values |
| TA04, TA10 | one float/class per output point | runs; the value lands on the annotation (`meta`) |
| TA05 | per-point classes | runs; classes arrive inlined and become presets |
| TA09 | slide collection, depth-2 input collections, float inputs | **refused**, by name, before any job is created |
| TA11 | pre + standalone + postprocessing (`containerized: false`) | standalone runs; postprocessing is listed and refused — the app computes that step in its own UI |
| TA12 | pre + postprocessing, no standalone | postprocessing runs, consuming the preprocessing job's outputs |
| TA13 | preprocessing, pixel map out | results shown; nothing to start |
| TA14 | `fhir_questionnaire` io | listed, refused with the io type named |

**Not supported, deliberately:** multi-slide jobs (`collection<wsi>`),
non-containerized postprocessing, `fhir_*` io, and writing primitives,
collections or pixel maps back.

---

## Jobs

The choreography is dictated by the backend and mirrors the reference AppUI's
NgRx effects (`apps/generic-app-ui-v3/src/app/jobs/store/jobs/jobs.effects.ts`):

**single-ROI app** (`getRoiMode() === "single"`)
`POST /jobs` → set the `wsi` and ROI inputs **in parallel** → wait for both to be
acknowledged → `PUT /run`. Running before both land is refused by the backend.

**multi-ROI app** (`"multiple"`) — the **staged batch**
`POST /jobs` → set the `wsi` input → one `POST /collections` per collection input
key → bind each as a job input → `POST /collections/{id}/items` per ROI → the
user runs explicitly, after adding as many regions as they want.

That "runs explicitly" is a state, not a moment, so it has a name:
`JobRunner.createBatch()` / `addToBatch()` / `resolveBatch()`, wrapped by
`wb.ensureBatch()` / `addRegionsToBatch()` / `runBatch()` / `discardBatch()`.
A **draft is a real job in `ASSEMBLY`**, not a client-side list, because that is
the only form that survives a reload — this module runs on an opaque origin and
has no client persistence at all. Four consequences worth knowing:

- **Drafts are keyed by `(slideId, mode)`.** Switching slides or modes does not
  destroy one; nothing is deleted implicitly, because silently dropping a server
  job because the user touched a dropdown is worse than an orphan.
- **They are re-derived, never cached.** After every poll `_adoptOrphanBatch`
  looks at the slide's `ASSEMBLY` jobs: exactly one is adopted silently — that is
  unambiguously "the batch I was building"; several is ambiguous, so **none** is
  adopted and the UI reports them. They are ordinary rows in the analyses list
  under the `pending` filter, where deleting them is already offered.
- **Staging is append-only.** There is no route that removes an item from a
  collection; `addToBatch` therefore also refuses to post an id it already holds,
  since the same annotation twice is two collection items and the app would count
  that region twice.
- **`runBatch` records the members as locked before any poll can.** `job.inputs`
  names the *collection*, never the annotations inside it, so nothing else on the
  client can predict the 423 the backend now raises for each of them. On a
  reloaded session `loadJobOutputs` does the same from `inputCollections`.

Polling ticks while any job for the current (slide, mode) is non-terminal and
stops once they all are — status *and* input/output validation. All job traffic
uses the `background` scheduler lane so it never competes with tile loading.

**postprocessing** — the second half of the preprocessing flow
`POST /jobs` → wsi → the user's region → **each `from-job` input bound to the
source job's `outputs[key]`** → run. No new wire concept:
`PUT /jobs/{id}/inputs/{key}` takes an id, and a preprocessing job's output *is*
one.

Which earlier result? **The one whose output is currently shown**, falling back to
the newest completed candidate. That is the App-UI flow diagram's "display
preprocessing results → user interacts → run postprocessing" — the pathologist
chooses by looking, so the eye in the analyses window *is* the choice, and the
panel names what it resolved to. `containerized: false` is refused: that flag
means the app computes the step inside its own interface and posts the result
back, and this module writes no primitives or collections.

`PREPROCESSING` jobs are listed read-only — nobody presses start on them, the
platform schedules them when the examination opens. Read-only follows the **row's**
mode, not the panel's: one list carries every mode's jobs for the slide, because
a postprocessing run is built on a preprocessing result and hiding one while
preparing the other was the wrong shape. Switching the mode changes what you are
about to run, not what you can see.

### Reading results the EAD declared

`loadResults` answers what the three flat queries return. `loadResolvedResults`
additionally reads the app's **declared** outputs (`outputs.ts`), which is the
only way an output like

```json
"tumor_cell_counts": { "type": "collection",
                       "items": { "type": "integer", "reference": "io.my_rectangles.items" } }
```

can be read at all: it is a *collection*, so it is absent from
`PUT /primitives/query`'s idea of the job's values, and its items carry no name —
rendered in the flat value table they were a column of blanks.

The `reference` chain is what makes it attributable. `io.my_wsi` describes the
slide, `io.my_rectangles` the collection as a whole, and `io.my_rectangles.items`
**one value per member of it**. `describeOutputs` resolves that,
`zipRegionResults` joins it to the input collection's members — by
`reference_id` wherever the wire populates it, positionally otherwise, which is
why the input order is read back from the collection record rather than
reconstructed from the canvas.

**The one detail that decides whether this works:** an output collection's items
are queried with **`{ jobs: [jobId] }`**. They were created by the *job*, so
`_scopedQuery`'s default `creators: [scopeId]` — correct for an *input*
collection, whose members this scope authored — selects nothing at all for an
output one. See "The `*/query` selector rule".

### Only ask for what has values

`outputKind` strips every `collection` wrapper and dispatches on what is actually
held, because `spec.type === "collection"` alone is not enough to know:

| holds | what happens |
|---|---|
| `integer`/`float`/`bool`/`string` | queried — the per-region table (TA02) |
| an annotation type | **not queried.** They already arrived through `queryAnnotations({jobs})` and are on the slide. Named with a count |
| `class` | **not queried.** `with_classes=true` inlined them, and `_presetForClassValue` mints a preset per value |

TA03 and TA06 declare `collection<collection<point>>`. Asking the collection route
for those fetched records whose `value` is `undefined` — one wasted request per
output per job, and, because `undefined` still created the key,
a results-table column of blank cells where "—" was meant.

### Shapes that carry no class

TA03, TA04 and TA06 declare an annotation output and **no class output**, and an
app may only write what its EAD declares — so their shapes legitimately arrive
unclassified. That is not a "no preset" case: `checkAnnotation` stamps one onto
every imported object, so the only question is *which*, and the answer used to be
`unknownPreset` — 24 690 points filed under the literal word "Unknown".

`_ensureOutputPreset` mints one per declared annotation output, named like the ROI
preset (`"TA06v3 my_cells"` beside `"TA06v3 ROI"`) from `soleAnnotationOutput`,
with a colour hashed from its id so a result set does not change colour on every
reload. Shared across runs of the same app, so recolouring it once recolours every
run. Only a **job's** shapes get it (`jobCreated && !classValue`): the user's own
unclassified scratch work is not the app's result.

Two constraints it must respect, both of which the id encodes:

- **It carries no class, and its id must not look like one.** `_classValueForPreset`
  derives a class value from the id suffix of anything under `empaia:`, so the id
  prefix is `empaia-out:` instead — otherwise `empaia:output:my_cells` would be
  offered to `POST /classes`, which answers 400 for a value outside the app's
  namespace. The vocabulary permits a class-less preset explicitly
  (`allowUnclassified: true`), so drawing with it stores geometry and posts
  nothing the service can refuse.
- **Several annotation outputs name nothing per-output.** The pooled
  `annotations/query` cannot say which output a shape came from without one
  collection query per output — the same reason `annotationCount` is only claimed
  for a single output. The preset falls back to `"{{app}} results"`.

Values that describe an *annotation* rather than a region (TA04's confidences,
TA10's `model_confidences`) go onto the annotation itself. It costs no request:
`queryPrimitives({jobs})` already returned them, and a per-object one names its
subject in `reference_id`. They land in `annotation.meta`, which is the annotation
module's own per-instance override channel and is already in both
`copiedProperties` and `necessaryProperties` — so it survives export, import and
undo with nothing registered. Two constraints: the override is only consulted for
a key the **preset already declares**, and **colour has no per-instance
override**, so a value changes the label and never the tint.

### The poll, and the four ways it used to go wrong

`GET /jobs` returns the whole scope, so the loop around it is the module's most
expensive habit. Four rules, each of which is a bug that shipped:

- **`refresh()` keeps its `AbortController` in a local.** Reading `this._inFlight`
  back inside its own catch is a use-after-free in two directions: `stopPolling()`
  nulls it (→ `Cannot read properties of undefined (reading 'signal')`), and a
  concurrent `refresh` replaces it (→ one call reports the other's abort as a
  transport failure). The crash landed on the *first* line of the catch, before the
  failure counter — so the budget below never counted anything and never stopped the
  loop it exists to stop.
- **`tick()` always re-arms.** It used to re-arm on the line *after*
  `await this.refresh()`, so one throw ended polling for the rest of the session.
  Silent permanent death is the worst failure mode this loop has; a bug in the read
  must never decide whether the loop lives.
- **A 401 is a wait, not a fault.** `HttpClient` refreshes through the auth broker,
  so a 401 reaching the runner means the new token is on its way. Polling stops and
  calls `onAuthStalled`; the module awaits `whenContextSettled(authContext)` and
  restarts **only if the wait says it is authenticated** — otherwise it parks on an
  `onSettled` watch (see *An expired token is not a credential*). Resuming
  unconditionally turned this deliberately brake-free branch into the fastest loop
  in the module. Retrying on the timer is what filled a session's log with
  `"Access Token expired."`. The failure budget (`MAX_POLL_FAILURES`) is for
  transport faults only.
- **Idle ticks back off.** `jobPollMs` is a floor; each tick whose signature is
  unchanged doubles the wait up to `jobPollMaxMs`, and any movement — or any user
  action, via `startPolling` — resets it. Otherwise a job that never finalises costs
  a request every two seconds for the life of the tab.

The tab's own visibility is part of this: hidden stops the loop, and returning
resumes it *off* the event handler (resuming inside it measured 1131 ms) and only
after the auth context settles.

### "Produced nothing" has to be earned

`_emptyJobs` records analyses that wrote no annotations, so they are not re-queried
on every reconcile — and it is never revisited, so a wrong entry is permanent for
the session. Worse, it *suppresses* the self-healing re-import in
`syncJobAnnotations`, so a job wrongly marked empty never appears again without a
page reload.

Two ways to see an empty list mean nothing of the kind, and both shipped: a job read
before it finished, and a query that failed — every failure in that path degrades to
`[]`, so a 4xx was byte-identical to a finished, empty analysis. `JobResults.failed`
now names the queries that rejected, and `isEmptyResultConclusive` (`visibility.ts`)
is the one place that decides whether an empty list is evidence.

A job that reaches a terminal state while *already* visible also gets an explicit
reconcile: its contents changed, its visible set did not, and `_setVisibleJobs`
short-circuits on set equality.

### Bounded reads

- **Counted before fetched — off the first page.** Past `annotationBudget`
  (default 5000) the annotations are *not* fetched: the count is reported and the
  user chooses. The count comes from the first page's own `item_count`, not from
  `PUT /annotations/query/count` — that route works, but asking it first was a whole
  extra round trip per result read to learn something the next request already
  carried. `countAnnotations` stays on the client as a legitimate API with no
  caller.
- **Paged** at 500, like `sink.ts`'s `readBundle`, and `item_count` is compared
  rather than discarded — so a truncated read says so. `skip` is omitted when it is
  `0`, so the first (and usually only) request keeps the wire shape it always had.
- **`_jobOutputs` is an LRU** (`jobOutputCache`, default 12) and a **non-terminal
  job is never cached**: a result read while RUNNING is empty, and caching that
  forever is why a run could finish and still show nothing.
- **Nor is an empty read that has not earned it.** `COMPLETED` is not the same
  as *readable*: the workbench flips the status before the app's records are
  queryable, and for TA06 — 24 690 points — the gap is seconds. A read fired on
  that same tick answers `[]`, and it used to be latched in two places at once
  (`_jobOutputs` and `_emptyJobs`), so the analysis reported nothing for the rest
  of the session and the retry button could not clear it. Now a job that
  *declared* an annotation output and returned none opens a bounded **output
  wait** (`emptyOutputRetries` / `emptyOutputWindowMs`), which rides the poll
  backoff (~0/2/6/14/30 s) and keeps the loop alive through `isAwaitingOutputs`.
  An app that declares no annotation output is still conclusive on read one, so
  `_emptyJobs` keeps doing the job it was written for.
- **"Load anyway" imports.** Fetching filled the cache and stopped; the import
  lives in `syncJobAnnotations`, behind a reconcile. So the button said "loading
  annotations" and then showed nothing until the user toggled the eye — which is
  what finally reconciled. Both it and the retry now queue a reconcile.
- **Eviction yields.** `dropAnnotations` is a synchronous loop; taking a
  ten-thousand-point analysis off the slide is chunked so the tab stays alive.
- **Polling gives up.** Five consecutive `GET /jobs` failures stop it, and a
  hidden tab stops it too — it used to loop every 2 s for the life of the tab.
- **And polling actually stops.** The done-check is `isJobTerminal &&
  isJobValidationTerminal && !isAwaitingOutputs`. The middle one is written as a
  deny-list — only `"RUNNING"` is pending — because the allow-list it replaces
  accepted `undefined` but not the declared literal `"NONE"`, while
  `TERMINAL_JOB_STATUSES` calls that same literal terminal for `status`. A
  validation that never runs cannot transition, so a `COMPLETED` job reporting
  `output_validation_status: "NONE"` polled forever while the panel showed
  "completed" throughout.

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

### Attaching a map costs a re-open — so re-opens are coalesced

A pixel map becomes a `config.data` entry plus a shader layer in the slide's
overlay visualization, and the overlay is assembled in `before-open`. Attaching
one therefore means re-opening the slide, which tears the world down and
re-downloads every visible tile. Three rules keep that from happening more than
once:

- `openSlide` **preloads** the pixel maps of the analyses the slide is showing
  before it opens, so the first open already carries their layers. Discovering
  them afterwards used to cost a second full open, seconds after the slide
  appeared.
- `registerPixelmaps` marks the overlay dirty and re-opens on a trailing
  `OVERLAY_REFRESH_DEBOUNCE_MS` window, so a burst of job results (one
  `loadJobOutputs` per visible analysis) shares one re-open. It still resolves
  only when the re-open has finished — `_reconcileVisibility` depends on that
  ordering, since the teardown must not land under annotations it just drew.
- Maps registered for a slide that is not open re-open nothing; the marker is
  dropped and the next open builds them in.

`config.data` entries are reused per `(slideId, pixelmapId, channel)` rather than
appended per rebuild, so repeated opens do not grow the session — or the world's
tiled-image count, which the renderer relinks its second-pass program to follow.

### Performance in the sandboxed embedding

Three costs are deployment-side, not code, and they dominate a captured session:

- **A CORS preflight per tile.** The Workbench sandboxes the app-UI frame without
  `allow-same-origin`, so the document's origin is opaque (`Origin: null`) and
  *every* request is cross-origin. The `Authorization` header then makes each tile
  a non-simple request, so a GET is preceded by an OPTIONS. `Access-Control-Max-Age`
  does not help: the preflight cache is keyed per URL and every tile URL is
  distinct. The only client-side escape would be authenticating tiles through the
  URL, which xOpat does not do (`AGENTS.md` §7 — no tokens in URLs).
- **Tile responses carry no `Cache-Control`.** Nothing is reusable from the browser
  cache, so any re-open pays full network cost for tiles it already had. This is
  what makes the point above expensive rather than merely wasteful.
- **HTTP/1.1 on the EATS reverse proxy.** With ~6 sockets per origin and two
  requests per tile, queueing — not the server — is most of the latency (in the
  captured session: 703 ms queued of a 897 ms average tile GET, against 193 ms of
  actual server time).

A deployment that adds `Cache-Control` to tile responses and serves the API over
HTTP/2 removes most of the remaining cost without any change here.

---

## Public API (for `plugins/empaia-app-ui` and scripting)

```js
const wb = singletonModule("empaia-workbench");
await wb.whenReady();

wb.getScope(); wb.getEad(); wb.getSlides(); wb.getActiveSlideId();
await wb.openSlide(slideId);

wb.getAvailableModes(); wb.getActiveMode(); wb.setActiveMode("standalone");
wb.getRoiTypes(); wb.getRoiMode();
wb.runBlockers(mode);        // why a job cannot be started — [] means it can
wb.canRunMode(mode);         // the same answer as a boolean
wb.sourceJobFor(mode);       // the earlier result a postprocessing run consumes
wb.sourceJobCandidates(mode);
wb.roiFactories();                      // xOpat factory ids the app accepts
wb.roiTypeOf(annotation);               // the EMPAIA type it would be sent as

wb.activateRoiTool(roiType);            // drives the annotation module
await wb.markAsRoi(annotations, viewer);// existing annotation → job input
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

// A multi-region run, staged as an ASSEMBLY job (see "Jobs").
wb.getBatch(); wb.getBatchSize(); wb.orphanBatches();
await wb.addRegionsToBatch(empaiaIds, "rectangle");   // creates the draft on first use
await wb.runBatch();                                  // locks its members, forgets the draft
await wb.discardBatch();                              // DELETE, legal only in ASSEMBLY

const results = await wb.loadJobOutputs(jobId, slideId);   // resolves declared outputs
await wb.loadJobOutputsForced(jobId, slideId);            // past the size budget
wb.regionResults(results);   // {columns, rows} — one row per input region
wb.annotationBudget(); wb.visibleJobLimit();

await wb.showJobs(jobIds, slideId);   // paint exactly this set

await wb.registerPixelmaps(slideId, pixelmaps);
wb.getPixelmapSource(pixelmapId, channel);
```

Events (`wb.addHandler(...)`): `ready`, `failed`, `slides-changed`,
`slide-changed`, `mode-changed`, `jobs-changed`, `job-visibility-changed`,
`batch-changed`, `pixelmaps-changed`, `annotation-linked`.

---

## Not supported

- Workbench v1 / v2 (`/v1`, `/v2` scopes, EAD with top-level `inputs`/`outputs`).
- `REPORT` job mode, and `fhir_questionnaire` / `fhir_questionnaire_response` io.
- Multi-slide jobs — an app whose `wsi` input is a `collection` (TA09), and
  input collections nested more than one deep.
- **Non-containerized** postprocessing: `containerized: false` means the app
  computes that step in its own interface and posts the result back.
- Writing primitives, collections or pixel maps back to the workbench — this UI
  consumes app output, it does not produce it.
- Standalone operation: without a workbench client embedding it, the module
  reports `notEmbedded` and stays inert by design.
