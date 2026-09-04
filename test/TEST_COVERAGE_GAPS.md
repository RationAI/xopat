# Test coverage gaps

What is **not** covered, and why it is worth covering. Ordered by value-per-effort, not by
importance of the subsystem.

Covered items are not listed here — the suites themselves are the record, and a list that mixes
"done" with "to do" stops being read. See [`README.md`](README.md) for how to run and write tests.

Provenance:
- **[verified]** — the gap was confirmed by exercising the code, not inferred from reading it.
- **[reported]** — surfaced by review but not independently confirmed; a lead, not a fact.

Last pruned 2026-08-12 (originally working notes from the PR #188 review, 2026-07-17).

---

## 1. Pure logic — no browser, no server, no fixtures

Cheapest possible tests: total functions, no I/O.

- **`normalizeSecretsPatch`** (`modules/vercel-ai-chat-sdk`) — key allowlist and the 4096-char bound
  on BYOK secrets. A patch that slips an unexpected key through is how a user-scoped store grows
  fields nobody validates.
- **`shared/tool-envelope.ts`** — `hasToolEnvelopeTokens` / `recoverToolEnvelopeToScriptFence`.
  Pure string recovery of truncated LLM output. The failure mode is invisible at runtime: a script
  that silently stops matching the fence regex reads to the user as "the assistant said it would do
  something and nothing happened". Documented in `chat.server.ts`.
- **`InMemoryUserSecretsStore` TTL/LRU eviction** — needs an injectable clock; it calls `Date.now()`
  directly, so testing eviction today means either refactoring for a clock or temporarily lowering
  `TTL_MS`/`MAX_ENTRIES`. Worth doing once, when the deferred bounded-cache primitive lands (see the
  server RAM-retention plan), rather than twice.

---

## 2. Server integration — Node, no browser

Needs a registry instance and a fake `ctx`; no viewer, no slides. **This is the biggest honest gap.**

- **Provider ownership end-to-end [verified].** User B naming user A's provider instance id via
  `runTranscription` / `runVisionInference` / `ensureModelCapabilities` must throw. This was the
  CRITICAL PR #188 finding: enforcement lived at the call sites and three of nine forgot it; the fix
  moved the gate into `getProviderRuntime` with a mandatory `ctx`. The unit gate is covered — what is
  missing is a test proving the *call sites* route through it, which is what stops a fourth site from
  reintroducing the bug. The type signature helps; only a test proves behaviour.
- **Capability cache scoping.** `(provider, model, scope)` keying: user A's probe verdict must not
  serve user B, and A's `setProviderUserSecrets` must not wipe B's cache. Include the
  `draft_<type>` synthetic id path in `previewListModels`, which is shared across callers by
  construction.
- **`chat-based-tester` dev-mode gating [verified].** Every RPC calls `requireDevMode(ctx)` and the
  client also checks `CORE.server.devMode` — defense in depth worth pinning, because the blast radius
  if it regresses is workspace file reads plus server logs going to an LLM. Also worth covering: the
  `path.resolve` + `isInsideSafeRoots` traversal guard (`../` escapes, sibling-prefix `/srcfoo` vs
  `/src`, the extension allowlist, and that `env/` is not a safe root). Known uncovered nit: no
  `realpathSync`, so a symlink planted in `src/` with an allowed extension is followed — dev-mode only.

---

## 3. Browser / e2e

Roughly by shipped-size-without-coverage. All of these are now cheap to write: the `synthetic`
project renders a generated slide, so none of them needs a WSI service.

- **Failure rendering** [covered — `test/suites/e2e/error-rendering.test.mjs`, project `errors`].
  Failed tiles, a descriptor that will not parse, a destination that 404s, a `visualizationIndex`
  past the end of the collection, and a shader type nothing registers. Writing it turned up three
  paths that produced **no user-facing signal at all**, now closed: non-strict visualization
  validation issues, an out-of-bounds `visualizationIndex`, and `add-item-failed` with no
  `statusCode`. What remains open is below.
- **Failure is invisible *on canvas*.** A failed tile draws nothing — OSD sets `exists = false` and
  returns, and `tileRetryMax` is 0, so there is no retry and no glyph. A faulty background is an
  `EmptyTileSource` with `color = "rgba(0,0,0,0)"` at `opacity: 0`. Both are pixel-identical to a
  slow load, which is why the suite above asserts state and messages rather than pixels: a pixel
  assertion today would be asserting the gap. Closing it means an error-tinted placeholder fill
  selected when `errorMessage` is set (`src/classes/tile-sources/empty-tile-source.ts`,
  `viewer-open-pipeline.ts` `openPlaceholder`) and a per-tile marker for `exists === false`. Both are
  xOpat-owned files, so no upstream request is needed — but it changes what every existing rendering
  test sees, so it is its own change.
- **`src/classes/app/shortcut-manager.ts`** (621 lines, new; replaced the `hotkeys` plugin). Conflict
  detection, user remapping through the Keymap panel, and the rule that contextual keys
  (Escape/Enter/Delete in widgets and inputs) stay widget-local and are *not* registered.
  `src/SHORTCUTS.md` is effectively a spec with no assertions behind it.
- **`viewer-depth-controller.ts` — the visual half.** The contract is now pinned by
  `test/suites/unit/z-stack-contract.test.mjs` (plane URL resolution, cache handling off OSD's
  converter tables, zombie purge, clamping). What remains unasserted is the claim that motivated the
  design — "no blink, no zombie tiles" during an in-place swap — which needs a real viewer: assert
  tile identity and count across a depth change.
- **`viewer-joystick-controller.ts`** (285 lines) — no coverage at all.
- **Multi-viewport correctness.** The recurring bug class in this repo (AGENTS §6): a component
  reading the focused viewer instead of the owning one. A grid fixture with two viewports, acting on
  the *unfocused* one, would catch the whole family. `test/e2e/event-isolation.cy.js` is the start of
  this, and is one of the Cypress specs still unported.
- **Annotation measurements** [reported] — geometry / ratio / distance math against a
  known-geometry fixture. Pure enough to belong in §1 if the engine can be exercised without a canvas.
- **Voice turn queueing** [reported] — `ChatVoiceController` coalesces utterances spoken during a
  reply into one message, deliberately. Nothing pins it, so the next reader will "fix" it back into
  per-utterance sends. The assertion that matters is the module's own rule: silence must never reach
  the driver (the speech-evidence gate), which is what prevents `"Thank you."`-style hallucinations.
- **`HttpClient` feature surface** [reported] — proxy alias resolution, JWT/CSRF injection, and
  `auth.required` waiting on `whenContextSettled` rather than racing the login. §0.3 makes this the
  only sanctioned way out of the browser, so an untested regression here is silent everywhere.
- **The server proxy refusing non-session requests** [reported] — a session cookie plus a CSRF token
  is authentication, not authorization; `session.allowedProxies` is what decides. Assert the refusal,
  because the failure mode is an open relay rather than an error.
- **Script-manager safety and usability** [reported] — `src/classes/scripting` is the only sanctioned
  route for model- or user-authored code (§7). What needs pinning is the refusal side: the limits
  come from `getStaticMeta`, so a hostile session bundle must not be able to widen them.
- **`activeBackgroundIndex: []` means nothing open** — covered by `test/fixtures/sessions/empty-session.json`
  as a fixture, but nothing asserts it. The historical bug was reading `[]` as "open everything".
- **Side-by-side viewing: unchecking the checkbox does not remove the subviewer** [reported] — a live
  bug, and exactly the multi-viewport family above.

---

## 4. Deliberately not covered

Kept here so the absence is a decision rather than an oversight.

- **Graceful shutdown** (SIGTERM drain, terminal `RPC_SERVER_SHUTDOWN` stream records) — verified by
  code path only. Windows has no real SIGTERM, so asserting it needs a Linux/Docker run.
- **Cross-worker session sharing** — asserted only indirectly (the identity half is a shared binding
  and lands on disk; the secure half does not). A true two-worker assertion needs a load balancer in
  front, because Node's Windows scheduling policy sends every connection to one worker.
- **Circuit breakers** stay per-worker by design; nothing pins that.
- **Chat real-provider mode** (`XOPAT_STRESS_REAL_PROVIDER=1`) covers only latency, streaming and a
  context-window overflow. The scripted-misbehaviour sections cannot run against a real endpoint.
- **The chat turn pool is global, not per-principal.** `sendTurn` and `sendTurnStream` share one
  `chat-turn` key (5 running, 25 queued) and there is no rate limiter anywhere in the server — 429
  appears at exactly one line, so one cookie can starve every other caller. The stress suite asserts
  this as *current behaviour*, so the day it changes is visible; it is not a fix.

---

## 5. Test-system debt

Not code coverage — the state of the machinery itself.

- **No CI runs any of this.** Nothing gates a PR today. The intended shape is a fast lane on every
  PR (`unit` + `integration`, no browser, no external data), a browser lane on the synthetic slide,
  and a nightly lane for `@slow`.
- **13 suites are still unported** — they run unmodified through `test/harness/legacy/` and their
  assertions all count, but they carry three incompatible assertion dialects and per-file browser
  shims. `test/harness/legacy/manifest.mjs` scanning to zero is the finish line.
- **The four Cypress specs are frozen, not ported** (`test/e2e/*.cy.js`, `npm run test:cypress`).
  `event-isolation.cy.js` and `params.cy.js` carry real coverage that the new runner does not.
- **`test/legacy/server/http-surface.mjs` has a load-sensitive assertion.** *"20 unknown-target RPCs
  stay cheap (no rescan per call)"* measures ~197 ms per call on a busy machine (failing) and sits
  comfortably under the threshold on an idle one. The guard is worth keeping — it protects against a
  full plugin/module tree walk per unknown-target RPC, pre-auth — but a wall-clock threshold is the
  wrong instrument. Re-express it as a rescan **count** when the suite is ported.

---

## Suggested next

§2's provider-ownership end-to-end. It is the highest-value item on this page: the unit gate is
covered, the call sites are not, and the last time that was true it was a live vulnerability.
