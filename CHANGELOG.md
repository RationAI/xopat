# Changelog

### Unreleased

* **The earlier-dictation banner announced a non-event, and offered the wrong thing.** Once
  the mixture report's resume offer was declined — or simply overtaken by pressing Start —
  the row stayed up saying *"The earlier dictation from … is not part of this report"* beside
  a **Start new report** button whose title read "leave the earlier dictation behind", while
  the code behind it cleared **this** report: session, drafted fields, the confirmed
  transcript, back to the findings phase. A decision already taken is not news, so the row
  now collapses to one muted line and a link back while this report is still empty, and
  disappears entirely once it has speech of its own (`resumeRowState()`, covered by a new
  unit test). The confirmation names what is actually being cleared, mentioning the earlier
  dictation only when this report is holding it. And clearing a report is now a permanent
  **New report** action in the panel header — it lived only inside that banner, so a case
  that never had an earlier dictation had no way to start over at all.

* **A chat session outlived the server; its provider did not.** With storage bound durably
  (`storage-persistent`), a restart left the session picker empty — transcript on disk, owner
  principal intact, nothing listed. Provider *instances* are minted with `uid('prov')` into a map
  on `globalThis`, so the id is re-minted every boot, while the session record that stores it is
  durable; the panel lists sessions **for the current provider**, so every pre-restart
  conversation was filtered out, and `getProviderRuntime` could not have resolved one anyway. A
  session now stamps `metadata.providerRef` — the provider's durable identity
  (`managedKey`/`managedByPlugin`/`typeId`), read from the registry, never from caller metadata —
  `listSessions` matches through it, and `requireSessionAccess` rewrites the stale `providerId`
  to the live instance on first access. Records written before the stamp fall back to
  `providerTypeId`, so transcripts already on disk come back. A session created against a user's
  own BYOK instance is deliberately **not** re-bound (its only same-type candidate is the
  operator's provider, on the operator's key): it is listed with `providerUnavailable`, readable,
  and sending waits for an explicit provider choice.

* **`storage-persistent` had nothing to persist.** Every namespace the preset's
  `storage/persistent-30d` fragment binds and retains (`kv:sessions`, `log:messages`,
  `blob:attachments`) belongs to `vercel-ai-chat-sdk`, and the preset layered `chat/off` —
  it configured durability for a module it disabled, so "restart and confirm the state
  survived" had no state to produce. It now layers a new `chat/all-providers` fragment:
  Anthropic, OpenAI and the OpenAI-compatible (CERIT) provider all register, each taking
  its operator key from `env/.env` when one is set. No key is required to boot — an unset
  `<% VAR %>` resolves to the `""` three-state middle value, which lists the provider and
  asks the user for a key — so the preset still composes on a bare checkout. The restart
  then demonstrates both halves: the transcript comes back, and the per-user key does not
  (`kv:secrets` is `sensitivity: "secret"` and refuses persistent drivers).

* **The `image-proxy` deployment reached the image server through nothing at all.** Every
  request composed as `/proxy/image-server/http://localhost:9002/v3/...`: `data/wsi-service`
  states the upstream origin as the client `baseURL`, `transport/proxy-image-server` adds
  the alias on top, and the ENV merge has no removal sentinel — so the protocol carried
  both, and `XOpatRemoteEndpoint` concatenated them after warning about it. In proxy mode
  `baseURL` is the path *after* `/proxy/<alias>/`; the origin belongs server-side to
  `proxies.<alias>.baseUrl`. The preset now clears it (`"baseURL": null` in its `override`
  block), the endpoint keeps only the *path* of an absolute `baseURL` under an alias so the
  broken URL is unconstructible, and `up:check` refuses the pair as a `proxy-absolute-base`
  conflict naming both layers. The WSI file browser — the one piece of that deployment
  still on a bare `fetch()` to its own absolute `wsiService`, which kept the case listing
  going direct while the tiles were proxied — now builds an `HttpClient`, taking a `proxy`
  alias when the deployment names one and the `wsiService` base otherwise. Proxying it then
  surfaced a third defect: `/proxy/<alias>/` rebuilds the remainder with
  `split('/').filter(Boolean)` — the collapse that stops a pasted origin from
  reconstructing itself — and lost the **trailing slash** with it, so `/v3/cases/` reached
  the upstream as `/v3/cases`, was answered with a 307 back to itself, and the redirect
  guard refused the loopback hop with a 502. The slash is restored explicitly (it cannot
  carry an origin) and both halves are pinned by
  `test/suites/integration/proxy-path.test.mjs`.

* `runVisionInference` now retries an empty reply once with a larger output cap 
  (`XOPAT_PATHOLOGY_VISION_MAX_OUTPUT_TOKENS_CEILING`, default 16384)
  when the cap was spent, then once more without `json_object`, and returns `finishReason`,
  token `usage` and `attempts`; the extractor's `llm-infer` records carry them, an empty
  reply is retried with a leaner contract (`corrected` only) instead of the "JSON only"
  nudge, and a failed pass is recorded as `correction-failed {reason}`. Also: Whisper's
  subtitle/translation credits are blanked as non-speech in every language it learned them
  from, and a gate-rejected segment with no voice is no longer shown as "(unclear speech)".

* **Dictation in any language.** The transcription language was pinned to the UI locale —
  which can only be English or Czech — so a Japanese dictation reached Whisper hinted `en`
  and came back as English filler ("I'm … and the"); the chat's wrong-language gate then
  discarded anything decoded in another language, and five Latin-only text filters (prompt
  echo, the segment-noise word count, the correction guard, quote grounding, repetition
  locks) would have blanked or refused correct Japanese text anyway. `voice.language` /
  speech-to-text `language` now default to `"auto"`: the recognizer detects the language,
  two agreeing segments pin it for the dictation (`language-pinned` / chat `voice-language`,
  per-segment `metrics.language`/`languageHint`), the English glossary prompt is withheld from
  non-English sessions, `remoteWhisper` asks for `verbose_json` so it learns the language too,
  and every text filter tokenises with `Intl.Segmenter` (one `textWords` helper per module;
  Japanese subtitle fillers blanked like English ones). The MIXTURE corrector keeps the
  transcript in the spoken language and uses the English form only as a reference; the
  extraction prompt says option fields resolve in any language and free text is never
  translated; the report panel shows the detected language and the session trace records it.

* **The transcript review starts from what the pathologist watched arrive.** The
  MIXTURE review modal used to prefer a re-read of the recording (90 s archive windows)
  over the live per-segment transcript, a preference from the days of 7 s blind chunks;
  with silence-cut Silero segments the live text is the better one, and the window text
  brought its own errors (hallucinated tails over trailing silence) that the guard then
  kept. The live transcript is now the review base — the recording is decoded only when
  a new integrity ledger (`modules/mixture-interface/live-integrity.mjs`) can point at
  speech the live text lost (a segment sent and answered with nothing, a queue abandoned
  at stop, a permanent transcription error, an impossible word rate), and adopted only
  when it is not shorter. Archive windows are banked lazily (speech-to-text
  `windowMode: "lazy"`; nothing uploaded during dictation), the per-window background
  LLM corrections are gone, the correction pass runs over exactly the text on screen,
  the chat `voice-gate` event gained kind `abandoned`, and the session trace records
  `transcript-source {base, reason, integrity}` plus a new `transcript-review` (what the
  modal showed and what was accepted). The modal says so when the recording replaced the
  live text.

* **Speech-to-text hears speech, not loudness.** The dictation capture's voice activity
  detector is now Silero VAD (v5 via `@ricky0123/vad-web`, onnxruntime-web WASM, assets
  served same-origin from `modules/speech-to-text/dist/silero/`); the peak-amplitude meter
  every silence gate used to infer from stays as the fallback engine, reported per session
  (`capture-warning {code:"vad-fallback"}`) and per segment (`metrics.vad`). Both engines
  feed one pure gate (`speechGate.ts`, unit-tested). Under Silero each segment is uploaded
  as a PCM16 WAV cut from the VAD's own frames — no per-segment MediaRecorder, no seam
  overlap — and the probe / fail-open ladder is off (a model verdict is not second-guessed
  by a transcript). The chat composer emits `voice-ui {state, speaking}` on change, and the
  MIXTURE report panel shows **Speaking** beside **Capturing** from it.

* **A control point is never something you can grab.** The dots a drawing in progress
  puts on the canvas — the polygon's red start point, the orange follow points, the shape
  itself, the free-form-tool working polygon — were intermittently selectable, and
  clicking one painted fabric's scale corners and rotation handle over the drawing and
  took the gesture away from the creation mode. The factories always passed the right
  flags; three later passes overwrote them (`renderAllControls`, the preset
  `commonAnnotationVisuals` merged *over* the helper properties, and
  `_applyAnnotationVisibilityState` which guarded highlights but not helpers, reached
  for every helper by the interaction toggle, the spatial index's lazy refresh and the
  layer loops). Non-interactivity is now stated once,
  `OSDAnnotations.freezeHelperInteractivity`, and enforced once, by
  `addHelperAnnotation` — including emptying `controls`, so a stray `hasControls`
  has nothing left to draw. Promotion restores all of it, so a finished annotation is
  interactive as before. Factories consequently pass **no** interactivity properties at
  all — they state geometry and preset visuals, the canvas states the rest — which also
  retires the shared props bag whose in-place mutation used to copy the control point's
  own geometry (`radius`, centred origins, the first click's position, `factory:
  "__private"`) onto the polygon being drawn.

* **A mode button no longer lies about the mode.** Clicking *edit* in the annotations
  toolbar left it highlighted while the module was still in navigation, and re-clicking
  retried the same refusal: `ToolbarGroup` paints its selection on click, before the app
  decides, and `mode-changed` was the only thing that could repaint it — but a mode that
  refused to activate *from* AUTO (a read-only annotation vetoing `edit-start`, magic wand
  with no data, viewport segmentation with no preset) raised no event at all. A refused
  switch now states the mode that is in effect, so every listener corrects itself. Two
  neighbours of the same bug: `_setModeToAuto` assigns `this.mode` before announcing it,
  and `enableInteraction(false)` resets the mode *before* setting
  `disabledInteraction` — `setMode` refuses on exactly that flag, so its own "return to
  the default state, always" reset was a no-op and rights gating could freeze the viewer
  in edit mode. `ToolbarGroup.setSelected(id, fireOnChange)` now takes the flag its
  callers were already passing, matching `ToolbarChoiceGroup`.

* **Translations stopped mangling the values they interpolate.** i18next escapes
  interpolated values for HTML by default, and xOpat renders translations as text — so a
  date arrived as `9&#x2F;12&#x2F;2026`, a quoted word as `&quot;knows&quot;`, and any
  file name with an ampersand the same way. Escaping is now off at both inits (client
  `src/app.ts`, server `server/node/index.js`); the sinks that do build HTML already
  escape at the sink (`escapeHtml` in `loader.ts`) or sanitize (Dialogs/Toast), which is
  where that decision belongs. The three per-call `interpolation: {escapeValue:false}`
  workarounds (questionnaire, measurements, chat) are now redundant.
* **The corrections the assistant withheld can be accepted.** The transcript-review
  modal listed them under the editor as dead text ("edit it yourself if one of them was
  right"). They now lead the modal — the contested edits belong above the text they are
  about — and each carries **Apply**, which inserts it into the transcript as an accepted
  suggestion chip: readable in context, reversible in one click, and reported by
  `getDecisions()` like any other decision. They stay out of *Accept all* on purpose.
  New generic component API: `SuggestionEditor.applyReplacement(from, to)`.

* **Reporting: an earlier dictation is offered, never folded in.** A report used to
  reattach to the case's most recent conversation inside `start()`, while a separate
  probe fed the banner describing it — so the banner arrived after recording had begun,
  could appear and vanish around a start, and the old session ended up in the new
  recording anyway. Resume is now opt-in and single-sourced: the panel states what it
  found *before* anything is dictated, with **Continue it** · **Ignore it**, and a start
  with no answer opens a clean session. The offer closes once this report has speech of
  its own (two dictations in one transcript cannot be reviewed apart) and says so.
  *Start new report* now runs under a labelled busy op instead of greying the buttons
  with nothing on screen, skips the "you will lose this" dialog when there is nothing to
  lose, and **resumes recording** when it was pressed mid-dictation — it was leaving the
  microphone off, so the next sentence went nowhere and the pathologist pressed record
  twice. A failed start ("the provider has not finished loading its models") is cleared by
  the next start attempt rather than surviving until an extraction pass lands, which made
  a working report look broken.
* **Reporting is a silent consumer of the chat module.** The report session is a
  transcript/audio store, not a conversation on screen: the per-pass change-log bubble is
  gone (it never rendered — `ChatMessageList` hides any message carrying an
  `internalSource` outside the "all" display mode — so the chat showed an empty transcript
  while the report drafted), and re-attaching to a report session no longer pulls the Chat
  tab into it (`openSession(id, {showChatView:false})`). Starting is faster:
  `createSession(input, {transcriptOnly:true})` skips the scripting-baseline wait, which
  exists to complete a first turn's tool manifest and has nothing to do with a session that
  runs no turns, and the provider reference + model catalogue are resolved at panel open
  instead of under the Start spinner. The transcript-review modal no longer carries the
  "this is the live transcription, not the re-read recording" notice; the whole-audio
  re-read and its `reason` trace are unchanged.

* **Measurements panel: picking and tissue masks behave.** A derived tissue mask now
  keeps the island the measured annotation sits on (containment ranks first, then boundary
  distance; the nearest island always survives the reach filter) instead of whichever
  island happened to be near the *last* polygon the derivation added — the annotations
  module selects every annotation it adds with `fromCanvas: true`, which silently turned the
  panel subject into that polygon mid-derivation. The mask is sent to the back and the
  previous selection restored, so the annotation drawn on it stays clickable. The mask lands
  in the slot as the concrete islands (numbered, hoverable, focusable), not as an inert
  class chip; class/all chips are hoverable and focus the union of their members too. A pick
  for slot B puts the pre-pick selection back (a pick is a click, not a selection change),
  operands whose annotation was deleted are dropped (no more ghost highlight), the operand
  menu offers the current selection, and "Derive tissue mask into class…" opens again
  (`presets.getExistingIds()` is a Map iterator; `.map` on it threw before the dialog built).
  The right-click popover now says what it shows: rows are grouped into *Geometry* (exact,
  always current) and *Pixel sampling* (with the source · channel · threshold the cached
  numbers were taken with, or "not sampled yet"), every metric has a one-line tooltip, a
  failed sample prints its reason instead of dashes, the header shows the shape and
  hover-highlights / click-focuses the annotation, and the two buttons explain themselves.
* **Tissue ratio in one click, and a popup inside a modal is no longer painted behind it.**
  The canvas right-click menu has a nested **Measurements ▸** entry: quick view, *Measure
  pixels*, *Tissue ratio (derive mask)* and *Open panel*; the two computations open the
  popover, which shows progress, the result or the failure reason. Tissue derivation is now
  one module method (`deriveTissueMask`) shared by the panel, the popover, the canvas menu and
  the scripting `tissueRatio()` — which thereby gains the island pruning it never had. The
  ratio is cached on the annotation (own key; stale with the shape) and shows as a *Tissue
  ratio* row in the popover and panel and a *Tissue %* column in the table and CSV. The mask
  polygons stay on the slide, in the active class, so unwanted parts can be deleted; the
  dimmed entry says so when the pathology module is missing.
  `FloatingManager.register` takes an `anchor`: the popup's z-index floor becomes its anchor's
  stacking context + 1 (and survives `bringToFront` / renormalisation). The manager's band is
  100–899 while a DaisyUI `.modal` is 999, so every `Autocomplete`/`Dropdown` list portaled
  to `<body>` from inside a dialog — the class picker in "Derive tissue mask into class…", the
  annotations preset dialog — opened behind the modal. Raising the band would put popups over
  modals that should cover floating windows; only the anchored popup is lifted.
  A ruler (line, polyline, arrow) no longer reads "NaN km²": an open shape has no area,
  and the engine formatted the missing value through the unit ladder anyway. Its length row
  is now labelled *Length*; *Perimeter* is reserved for closed shapes, and the dimmed Area
  placeholder is dropped when there is a length to show.
* **Dictation no longer loses speech silently.** A field round on MIXTURE turned up a
  dozen defects in `speech-to-text` and the chat voice controller that each, on its own,
  produced the observed symptom — segments with ten seconds of voice decoding to `"The"`,
  the whole-audio review transcript coming back as a fraction of the dictation or empty.
  The live path **fell back to the in-browser `whisper-tiny.en`** on any non-auth endpoint
  error while the metrics still named the configured model (`liveFallback` now opts in;
  results and metrics carry the driver that *answered*). A dead or muted microphone
  produced 15 s blobs of digital silence, whisper hallucinated `"The"` on each, and the
  third one — a VAD "probe" — flipped the session **fail-open** for an hour of uploads
  (silence is never uploaded now in any mode; a probe counts only if the consumer gate
  accepts it). The archive byte cap accumulated across every dictation in the tab and,
  with no `audioBitsPerSecond`, was reached in ~21 minutes, after which every window
  sealed short or empty (32 kbps pinned; bytes handed over are subtracted). A rotated-out
  archive recorder's error/cap handler **stopped its successor**; `whenArchiveSettled`
  resolved after the *first* of two pending seals and could also hang forever; teardown
  stopped the tracks in the same turn as the final flush. The prompt-echo filter blanked
  any segment made of two glossary terms (`"fibrosis, necrosis."`) and `looksRepetitive`
  erased a whole window for a four-times-repeated phrase — both now keep the speech and
  report what they changed (`segment-filtered`). Window records have real states
  (`pending` / `done` / `retryable` / `failed`) — `pending` used to never drain and
  `failed` was unreachable, which is why "first Submit spun until Cancel". Windows are
  scoped to the dictation (a start is a new dictation unless `continuesSession`), a
  cleared recording aborts in-flight uploads, and an empty window logs its own local
  decode length beside the backend's (`window-empty`, `getFailedWindowBlobs()`). The
  OpenAI-compatible shim sends `temperature=0` and asks for `verbose_json` (per-model
  fallback to `json`), so Whisper's `no_speech_prob` / `avg_logprob` /
  `compression_ratio` reach the consumer gate. The level meter no longer beats the
  liveness watchdog (a dead mic never triggered it); Send during hands-free finishes
  gracefully instead of aborting the in-flight segment; the lone-word ratio is taken
  against the speech span rather than wall time (`"UIP"` after a pause was rejected).
  Every recorded segment that does not reach the transcript now says why:
  `segment-discarded` / `segment-gated` / `segment-filtered` / `segments-abandoned`.
  Follow-up from the first field round on the fix: the chat controller now always *continues*
  the dictation on start (the consumer that retains audio owns its boundary — a start that
  dropped the recording made the review compare one capture against a whole session and
  discard the whole-audio text as "too short"); `capture-started` marks when recording
  actually begins and the composer shows "Opening microphone…" until then (the listening UI
  never drops while hands-free is on); dictation mode no longer switches itself off after
  five quiet minutes and a lost session is retried every 5 s instead of finishing;
  consecutive segments share up to a timeslice of audio and the repeated seam is trimmed
  (`segment-trimmed`); an endpoint answering with no text raises `segment-empty`; all of
  these reach observers as `voice-gate`.
  **Root cause, found by posting a retained failing window straight to the endpoint: the
  biasing `prompt` made the deployment’s Whisper drop whole stretches of audio in proportion
  to its length** (no prompt: the full 93 s; the 495-char glossary: the last third gone;
  glossary + report terms: 30 s of the middle and nothing else). The prompt is now off by
  default (`promptMaxChars: 0` in the module, `transcriptionPromptMaxChars` per provider on
  the server); vocabulary correction stays with the post-hoc corrector. A `null` decode verdict
  from the backend is absent, not zero; `stt.exportFailedWindows()` downloads retained failing
  windows for exactly this kind of test.
  Cleanup: the module and the voice controller log through `APPLICATION_CONTEXT.log`
  (`module.speech-to-text`, `:vad`, `module.vercel-ai-chat-sdk:voice`) instead of `console.*`,
  so VAD diagnostics are a channel level in `env.client.logging` rather than the removed
  `xopat-stt-debug` localStorage flag; the concluded `contextPromptAB` experiment and its
  `promptContext.ts` are gone.
  Whisper’s short silence fillers (`Thank you.`, `Hello.`) are blanked as whole transcripts and
  a ≤3-word transcript over <400 ms of voice is rejected by the consumer gate (probe and flush
  segments bypass the module’s floor), so a filler can no longer flip a session fail-open; a
  probe’s gate verdict is reused by the drain instead of judged twice; `overlapMs` reaches the
  metrics so one-word seams are trimmed.
* **The View menu has an "Appearance" group, and the capture markers finally live somewhere.**
  `CaptureIndicator` registered its on/off row with `View.append(...)` — the un-categorised path
  meant for plugin *windows* — so "Analysis capture markers" rendered as a loose row **above** the
  Viewer Side Menus / Tool Bars / Global Menus submenus, and it was the only caller of that method
  in the repo. It now registers under a new `appearance` category, joined by the **scalebar**, which
  previously had no live toggle outside Settings. Both keep the hide-UI contract (`on`/`off` do not
  persist, `set` does), so hiding and unhiding the interface no longer risks rewriting the user's
  preference. The scalebar registers under its component *kind* rather than its per-viewer id, so a
  multi-viewport grid gets one row that fans out to every viewport. **Watch out if you pin quick
  actions:** the catalogue key is built from the category, so
  `view:core.captureIndicator` becomes `view:appearance.core.captureIndicator` and an ENV
  `setup.quickActions` entry using the old key is silently dropped; the scalebar arrives as a new
  `view:appearance.scaleBar`.
* **The context menu is compact, and its group separator is a rule instead of a gap.**
  `CanvasContextMenu.collect` pushes `{title: ""}` between provider groups, and the renderer drew
  that as a 10px text row *with* a `border-bottom` — an empty line box plus a rule, so a
  three-provider menu read as gapped. Separators are now hairlines, leading/trailing ones are
  dropped and runs collapse (the producers cannot know whether the next provider will contribute,
  so a dangling trailing rule was the normal case). Titled headers render as `menu-title`, which is
  also DaisyUI's opt-out from the hover highlight they should never have had. Row geometry moved to
  inline styles keyed off two constants — `.menu`'s `.5rem` sidebar padding was being re-paid by
  every cascade level, and the flyout's vertical offset was an independent magic number that had
  drifted from it, so submenus did not line up with the row that opened them. Also drops
  `dropdown-item` and `pointer`, two classes nothing has defined since Primer left.
* **A deployment can now decide which right-side panels a viewer boots with.** `ui.navigator` was the
  only side-menu panel config could reach; every other tab read the user's cached `<tabId>-open`
  toggle and defaulted to open, so "hand the pathologist a clean viewer with just the navigator" was
  not expressible without per-user setup. The new `setup.ui.sideMenuTabs` takes a boolean or a map of
  tab id → boolean with `"*"` as the fallback for tabs it does not name, so
  `{"*": false, "navigator": true}` also covers panels appended later by plugins the operator has
  never heard of. Resolution moved into a leaf module (`ui/classes/mixins/utils.mjs`,
  alongside `resolveSideMenuCompact`) and reaches `Menu.append`/`appendExtended` through a new
  `options.initialOpenResolver` — the two plugin-panel call sites had their own copy of the
  cache read, which is why the first version of this only worked for the built-in tabs. Precedence
  matches the rest of the `ui.*` namespace: session param > the user's cached toggle > deployment
  default > open, so a returning user keeps panels they opened and a deployment needing a
  deterministic boot state sets it in the session `params.ui`. Same commit declares `sideMenuTabs`,
  `sideMenuCompact` and `globalMenuMode` in `src/config.json`'s `setup.ui`: session params are
  filtered one level deep against that block, so the latter two were silently dropped from a session
  despite being documented as session params.
* **Fixed upstream and re-vendored**: a multi-channel OME-TIFF rendered one channel, silently. Files
  of that shape store each channel as its own full-size IFD with `SamplesPerPixel = 1` and hang the
  pyramid off each plane as SubIFDs; web-tiff's request carried a single directory, so planes 1..N
  were never fetched and the one that was — 8-bit grey — resolved as `interpretation: "image"`, i.e.
  grey replicated across RGB plus a constant alpha. From the viewport that read as a shader bug: three
  markers drawing identical content in three tints and a fourth layer as a flat wash of its colour.
  The decoder now reads every same-size directory as a channel of one tile in **one** request (the
  bytes live at N offsets either way, so this costs no extra network), reports the stack in its
  descriptor, and carries the OME-XML `Name=`/`Color=` per channel. `layout.prefer` is gone — a
  pyramid and a plane stack stopped being alternatives — leaving `layout.planeIndex` as the opt-out,
  which now *pins* one plane, so `planeIndex: 0` is a selection rather than a default. Measured on
  `test/fixtures/data/slides/LuCa-7color_Scan1.ome.tiff`: six levels of five planes, `channelCount 5` in two
  RGBA8 packs. The library's `VERSION` did not move, so probe
  `Array.isArray(file.levels?.[0]?.planes)` rather than a version (`UPSTREAM.md`).
* **The `webtiff` module was written against the one-plane decoder in four places.** Channel names and
  colours are now lifted from `encoding.channels[i]`, so a fluorescence slide auto-configures as
  DAPI/FITC/CY3/… in its acquisition colours instead of `ch0…ch4` in fallback tints; the statistics
  and thumbnail reads pass `planes`, so every channel gets a measured window (previously only channel
  0 did, which defeated `autoWindow: "rescue"` on exactly the dim channels it exists for) and a
  slide-list card is a composite rather than a grey plane; the canvas flattener forces alpha opaque in
  `data` mode, where a stacked pack `[0,1,2,3]` used to draw its fourth measurement as opacity; and
  the removed `layout` option no longer reaches the decoder. The multichannel demo session's heatmap
  layer moved from channel 0 to channel 4 — a swizzle letter cannot address past lane 3, so it had
  been re-rendering DAPI under the name "Autofluorescence".
* **Fixed upstream and re-vendored**: MVT vector tiles landed in the wrong place on any pyramid whose
  world is not an exact multiple of the tile size. The worker normalized geometry to the *nominal*
  tile while the drawer maps UV 0..1 onto `Tile.positionedBounds`, which OSD *clips* at a level's
  right/bottom edge — so the mesh was squeezed into the visible part of its own tile. The raster path
  had always compensated by scaling texcoords; a vector tile has none, and `GeoJSONTileSource` avoided
  it only because its worker already normalizes to the clipped rect. On the demo slide (105185 ×
  221772) that put the whole layer 2.49× off in x at low zoom. The tile source now derives
  nominal ÷ clipped from OSD's own `getTileBounds` and the worker folds it into every mesh kind;
  square web-mercator pyramids are unaffected. Same build also merges the worker's style `config`
  instead of replacing it, which used to drop `STYLE.fallback` for any TileJSON-derived style and
  turn an unstyled layer name into a worker throw.
* **A sparse MVT pyramid is now declared rather than discovered by 404.** The
  visualization-flexibility demo writes only tiles carrying geometry (1981 of ~119 000), so every
  other tile 404'd, and enough consecutive failures marked the whole source faulty — correctly, since
  a 404 is indistinguishable from a broken server. `make-visualization-demo.mjs` emits a `tileIndex`
  (per-level base64 bitmask) into `tiles.json` and `modules/demo-vector-layers` turns it into a
  `tileExists` predicate, which OSD consults before scheduling a tile. A 404 stays an error.
  Regenerate with `node test/harness/data/derive.mjs --only mvt --force`.

* **Fixed** menu pages rendering their own markup as visible text. `menu-pages` handed the built page
  to the viewer menu as an HTML *string*, and a string child is re-judged by `BaseComponent.toNode`'s
  untrusted-text renderer: with no `SanitizeHtml` loaded it degrades closed to a text node — and
  nothing re-rendered it, so it stayed that way — while with the sanitizer loaded its allowlist
  stripped every `id`, so pages that fill a placeholder after render (the whole Slide Information
  panel: slide label, technical metadata, download action) silently gave up. The module now hands
  over parsed nodes. Surfaced in the EMPAIA workbench deployment, whose plugin whitelist contains no
  other sanitizer consumer; every other deployment happened to load one first.
* A degraded `HtmlRenderer` render is now upgraded when `sanitize-html` finishes loading, matching
  what `modules/markdown` and `Toast` already do — degrading closed is only defensible while
  temporary.
* **Security: that fix removed the only sanitization on the viewer-menu path.** Handing over parsed
  nodes means `BaseComponent.parseDomNodes`, i.e. `template.innerHTML` with no allowlist, and
  `<template>` is inert only for `<script>` — an `onerror` fires the moment the nodes are attached.
  Reachable because `plugins/custom-pages` reads its page list *and* its `sanitizeConfig` from
  `getOption`: a session bundle could supply `{type:"html", html:"<img src=x onerror=…>"}`, pick
  `target:"viewer"`, and run script on the viewer's origin. Sanitization now happens where untrusted
  content **enters** `renderUIFromJson` rather than over the assembled body — which is what stripped
  the ids in the first place, so both properties hold at once:
  - raw `{type:"html"}` is filtered through a module-owned allowlist (`HTML_ALLOWLIST` widened by
    `details`/`summary`, inert text-structure tags, and `id`), degrading **closed** to escaped text;
    the `secureMode`-gated raw pass-through is gone, and `sanitizeConfig` now selects a policy rather
    than switching one off.
  - values interpolated into attributes are **escaped**. Not redundant: sanitize-html escapes text
    with `escapeHtml(text, false)`, so `classes: '" onmouseover="…'` broke out of `class="…"` *with
    the sanitizer enabled*.
  - a page `type` is resolved against an allowlist of presentational elements. It previously reached
    the whole `UI` namespace, including `UI.RawHtml` (innerHTMLs its children) and `UI.StatusBar`
    (innerHTMLs `initialMessage`) — script execution with no `{type:"html"}` node involved at all.
  - component options and string children stopped being sanitized: they go through van.js/`toNode`,
    which escape, and running them through a *markup* sanitizer only rendered "Tumor & stroma" as
    "Tumor &amp;amp; stroma".
  `custom-pages` reads `sanitizeConfig`/`target` from `getStaticMeta` only (§7) and splits pages by
  provenance — operator pages get the operator's policy, session pages always get the module default.
  As a side effect `ENV.plugins["custom-pages"].data` works for the first time; `getOption('data', [])`
  passed an explicit default, which suppresses the ENV fallback (`loader.ts`).
  Pinned by `modules/menu-pages/test/unit/render-sanitize.test.mjs` and
  `plugins/custom-pages/test/e2e/session-pages-xss.test.mjs`.

* **Preview-level injection is source-gated, not role-gated.** The synthetic coarsest level
  (`src/classes/preview-level.ts`) used to be offered only to backgrounds, on the grounds that an
  RGB preview would be semantically wrong for shader data. The real constraint is narrower: the
  synthetic tile is served as an 8-bit `rasterBlob`, so it must not stand in for half-float tiles.
  Sources now declare `getTilePrecision()` (`src/tile-source.ts`; undeclared means
  8-bit-compatible), and any layer — overlay included — is eligible. Vector sources still fall out
  for free by implementing no `getThumbnail()`. The preview is also encoded as PNG rather than
  JPEG now that it can be shader input.
* **`webtiff` participates in preview injection.** It previously opted out wholesale
  (`__noPreviewLevel`) because the graft shifts OSD levels while its decoder indexed its own level
  array absolutely — a silent off-by-one that read every tile one level too coarse. web-tiff 0.1.0
  indexes relative to `maxLevel` (`_decoderLevel`), so the shift is harmless.
* **Overlays can declare their pixel scale.** A new `pixelScale` on a session data entry says how many
  pixels of the stack's background one pixel of that image covers. OpenSeadragon normalizes every image in
  a world to viewport width 1, so an overlay previously landed on its background only when their aspect
  ratios happened to match — an overlay covering a whole number of blocks of a slide that is *not* a whole
  number of blocks wide never matched, and was silently squeezed, drifting by most of a block across the
  image. Arithmetic and validation in `src/classes/app/overlay-pixel-scale.ts`; absent or malformed values
  place the image exactly as before.
* **Known issue** (`UPSTREAM.md`): the follow-up to the above — flex-renderer's `devicePixelScale` is one
  scalar taken from the X axis, but framebuffer dimensions are rounded per axis, so `sx != sy` whenever
  `devicePixelRatio != 1`. The grid's vertical period comes out 512.106 px for a configured 512 (0.02%,
  ~46 px by the bottom of a 221772 px slide); horizontal is exact because `sx` cancels there.
* **Fixed upstream and re-vendored**: flex-renderer's `grid` and `gridheatmap` positioned themselves in
  framebuffer pixels but scaled themselves in CSS pixels, so on any `devicePixelRatio != 1` display they
  drew cells at `1/DPR` of the configured size (426.7 px for a configured 512 at DPR 1.2). The origin was
  correct, so it read as drift rather than a scale error — and it made a correctly placed overlay look
  wrong. Now carries a `u_devicePixelScale` uniform.
* **Fixed** a small overlay failing its tiles in complete silence. `ViewerFaultySourceRegistry` required five
  consecutive failures before marking a source faulty — calibrated for gigapixel pyramids, and unreachable
  for a single-tile overlay, which can only ever produce one. The tolerance now scales to the source's own
  tile count, so one tile out of one is condemning.
* **Visualization-flexibility demo** (`docs/site/docs/visualization-flexibility.mdx`,
  `npm run up -- viz-flex-demo`): six sessions covering multichannel TIFF channel routing, GeoJSON
  and MVT vector layers, a one-pixel-per-prediction-square raster with interpolation off, and both
  sides of preview injection. Data is derived from the real prediction masks by
  `npm run fixtures:derive`. Adds `modules/demo-vector-layers` (non-square MVT worlds — see `UPSTREAM.md`)
  and promotes the range-capable dev file server to `server/utils/node/slide-fileserver.mjs`
  (`npm run fixtures:serve`).
* **`webtiff` reads JPEG/YCbCr whole-slide TIFFs.** Most brightfield `.svs` decoded to vertical
  striping and wrong hues: the vendored libtiff build read them with `JPEGCOLORMODE_RAW`, so the
  2x2-subsampled chroma planes came back as stored and were then indexed as full-resolution
  interleave. Fixed in web-tiff 0.1.0, which sets `JPEGCOLORMODE_RGB` and dispatches conversion on
  what the decode loop actually produced rather than on the file's tag. On the demo H&E slide a row
  of pixels went from `(255,121,255) (255,255,255) (255,121,255)` — alternating — to smooth
  `(213,114,194) (217,116,196) (220,119,199)`.
  `viz-flex-demo` composed two TIFF decoders to work around this; it is back to one.
* **Fixed** in `webtiff`: a three-sample colour TIFF reported `channelCount: 3` while its
  packer filled the fourth lane with opaque `padAlpha`. The renderer bounds channel reads by that
  count, so the implicit `identity` layer sampled `vec4(r, g, b, 0.0)` and every such slide
  rendered fully transparent. web-tiff 0.1.0 declares what it presents (four lanes for an
  image-mode read), so the xOpat-side `presentedChannelCount` correction is gone.
* **The vendored web-tiff bundle carries a version.** `dist/web-tiff.mjs` exports `VERSION`
  (0.1.0), so which copy is loaded is checkable at runtime instead of by diffing the `.wasm`.
  Both `web-tiff` entries in `UPSTREAM.md` are closed.
* **Fixed** dead MVT wiring in `modules/rationai-wsi-tile-source`, which resolved
  `OpenSeadragon.FlexRenderer.MVT.AbstractTileSource` — a namespace that does not exist — and so
  always took its error branch.


### 3.1.0

Hardening and infrastructure release. The headline items are a server-side storage and logging
architecture (bounded, operator-routable, cluster-aware), a single test runner covering core,
plugins and modules, a new WebAssembly TIFF reader, SAML and HTTP-Basic authentication, and a
broad pass over the Node server's security posture.

**Features**:

* **Server infrastructure** — pluggable `kv` / `log` / `blob` storage with `memory` / `file` /
  `tiered` drivers, retention policy and a secret gate (`server/STORAGE.md`); one bounded
  LRU/TTL cache engine replacing seven hand-rolled `Map`s; a logging broker with per-channel
  levels, redaction and a gated `sensitive` path (`server/LOGGING.md`); documented environment
  and secret handling (`server/ENVIRONMENT.md`); `XOPAT_SERVER.isDevMode(ctx)` as the canonical
  dev gate; multi-process deployment via `cluster-index.js` and `XOPAT_WORKERS`, with a
  `/ready` endpoint, graceful SIGTERM/SIGINT drain and deployment-wide budgets.
* **Testing** — one Playwright-based runner for core client, core server, plugins and modules,
  including elements linked in from their own repositories. Deployment differences (`secureMode`,
  `production`) are projects rather than flags; a synthetic DeepZoom slide removes the dependency
  on real WSI data; legacy suites run unmodified through an adapter (`test/README.md`).
* **Tile sources & rendering** — new `webtiff` module (libtiff, zlib-ng, libjpeg-turbo, libwebp
  and zstd compiled to WebAssembly, with a decode worker pool); GeoTIFF data rendering; DICOM
  segmentation and parametric-map overlays; float16 GPU rendering; a live render-debug panel;
  off-screen region rendering for scripting.
* **Authentication** — SAML support (`modules/saml-auth`); an HTTP Basic broker
  (`modules/basic-auth`); OIDC unified behind the core auth broker with contexts auto-declared
  from config; late context discovery so boot no longer races the login; degraded-session support.
* **Chat & voice** — an OpenAI provider; providers referenceable by id from config instead of
  generated ids; server-side conversation storage; stronger guardrails when a model narrates
  without executing; provider discovery suppressed when no API key is set; dictation captions and
  batched audio capture; a configurable default transcription model.
* **UI** — a reusable `Autocomplete` component (replacing the vendored BVSelect) and a
  `SuggestionEditor`; `AppBar.Actions` plus pinnable quick actions; a `MainLayout` with an overlay
  global menu; a `"…"` configuration overflow for menus; a keymap panel; explorer search and
  navigation improvements; mobile toolbar dropdown integration.
* **EMPAIA workbench** — analyses moved out of the fullscreen plugin menu into a dockable
  **Tools → Analyses** window with search, status/time filtering and a running-job app-bar badge.
  One eye per analysis now governs everything that run produced — annotations, pixel maps and
  scalar values alike — with *solo* and *hide all*, the newest completed run shown by default.
  Job state and output visibility became per-slide in `empaia-workbench`, and output is painted
  into the viewport actually showing the slide rather than the focused one.
* **Annotations & plugins** — read-only annotation support and a disposal API; preset API keyed by
  name; a comment indicator on annotations that carry one; questionnaire answers persisted through
  the IO pipeline; slide-info visited-slide tracking and improved switching; viewport registration
  (image alignment) running in a worker.
* **Core** — a request scheduler with a background lane so tile traffic never starves; z-depth
  fetch and sync generalization; explicit tile-source selection from a session; rotation via a
  modifier key; auto navigator sync; per-ENV session isolation; `npm run storage-audit`, and
  `i18n-audit` extended to plugins and modules.
* **Chat on AI SDK 7** — core `ai`, `@ai-sdk/provider` and every provider plugin moved onto one
  release line (system prompt as `instructions`, `file` content parts, the renamed stream/usage
  surfaces). Provider packages must now match core's specification major: the rule is documented
  in `modules/vercel-ai-chat-sdk/README.md`, enforced per model at runtime
  (`assertLanguageModelCompatible`) and per manifest in a unit test, because a mixed line installs
  cleanly and only fails once a user sends a turn.

**Bugfixes**:

* **Server security** — static file serving now resolves against an allowlist of roots instead of
  "any path that exists" (`env/env.json`, the storage root and `*.server.*` sources were reachable
  anonymously); every interpolation into an inline `<script>` goes through `jsonForScript()`, so a
  reflected `</script>` in the POST body can no longer execute on the viewer's origin; baseline
  security headers (`nosniff`, referrer policy, framing) with a `frameAncestors` allowlist for
  embedded deployments; `/dev_setup` and `/scheme*` gated behind dev mode or an explicit opt-in;
  the proxy forwards an allowlist of request headers (it previously handed the browser's `Cookie`,
  `Authorization` and CSRF token to third parties), strips `Set-Cookie` from upstream responses,
  follows redirects itself so operator credentials are dropped off-origin, and streams instead of
  buffering; constant-time CSRF and JWT-signature comparison; a configured JWT `issuer`/`audience`
  is now a requirement rather than a hint, and a token without `exp` is refused by default; request
  bodies are capped on every route; unhandled errors return a correlation id instead of the
  exception text. The same hardening was applied to the PHP renderer, which had none of it.
* **SSRF guard** — classified upstream errors with host-free public messages, a response-size
  ceiling, working timeouts (the old code silently dropped the timeout whenever the caller also
  passed a signal), and an operator allowlist (`XOPAT_SSRF_ALLOWED_HOSTS` / `_CIDRS`) for trusted
  internal backends that never relaxes the redirect or DNS-rebinding protections. The three modules
  that broker credentials (`saml-auth`, `oidc-server-ts`, `oidc-client-ts`) now fail closed when the
  guard is unavailable instead of falling back to a bare `fetch`; the check is at request time, so a
  deployment that configures no identity provider is unaffected.
* **Sessions** — split into a shareable identity half and a memory-only secret half, so a
  clustered deployment stops losing sessions at random; per-request writes merge instead of
  clobbering a concurrent login's state; expiry now notifies owners on every path, so per-session
  data (chat transcripts, BYOK keys) is purged rather than orphaned.
* **IO pipeline** — simplified, with hardening for the case where the server refuses a write;
  hydration guard against a double `importBundle` at boot; revert-on-refusal by default.
* **Rendering & data** — DICOM decode-path and concurrency performance, pixel handling, and ICC
  correction for every tile type; flex-renderer initialization crashes; deferred preview rendering;
  faulty tile-source initialization no longer takes the viewer down; scalebar re-render cost.
* **UI** — explorer paging no longer corrupts its own page cache (paging back re-rendered the
  wrong page, and slide prev/next inherited it); the autocomplete no longer discards the first
  character typed into a closed control; toggling a quick-action pin in Settings no longer rebuilds
  the list under the checkbox being clicked, which stole focus and reset the scroll position on
  every toggle; the global-menu edge rail updates its tooltip again; right-side menu header layout.
* **Robustness** — a crashed registration worker is now discarded instead of being handed back to
  the next caller, where its requests never settled and disposal refused to run; a malformed
  "Extra headers JSON" provider field is reported and skipped rather than surfacing as a 500; a
  DICOM palette descriptor with a bad entry count degrades to the grayscale path instead of
  painting black; auth diagnostics moved onto the `core.auth` logging channel; worker close and
  annotation-settle failures are logged rather than swallowed.
* **Server module bundler** — a plugin/module `*.server.ts` whose bundle failed to import used to
  report as `RPC_UNKNOWN_METHOD` on every one of its methods; two causes are fixed. CommonJS
  dependencies now get a real `require` in the ESM bundle (esbuild's shim otherwise throws
  `Dynamic require of "path" is not supported` at module scope), and the build cache is keyed on
  the toolchain and installed-dependency identity as well as source mtime — an `npm install`
  changes no `*.server.ts` mtime, so unedited elements silently kept running bundles with the
  previous major of a shared library inlined. Abandoned `.tmp-*` build directories are also swept
  now (`fs.rmSync({recursive})` silently no-ops on some Windows setups).
* **Misc** — `syncSessionToUrl` made fail-safe; `HttpClient` retries only when it can help and
  keeps per-slide contexts; safe file operations on the server; `env/` excluded from Docker build
  context so deployment secrets are not baked into image layers.

### 3.0.0

First stable v3 release (promoting `3.0.0-beta.1`). Focus areas since the beta: the AI chat
stack (streaming, voice, BYOK, security), a new pathology exploration API, annotation UX, and
rendering/loading robustness.

**Features**:

* **Chat & AI** — streaming RPC and a faster, more stable chat interface; voice input integration
  with hands-free controls and quicker speech recognition; bring-your-own-key (BYOK) provider
  secrets; a configurable default provider with consent remembering; region hotlinks in chat;
  friendly progress feedback during LLM computation; MedGemma integration; an experimental
  chat-based tester; by-default injection of basic viewer-context summary.
* **Pathology** — hierarchical pathology exploration API; generalized MLflow API + IO sink; a
  general slide-labelling plugin; sensitive-patient API support.
* **Scripting** — progress reporting and partial results; multi-viewport scripting; recorder
  scripting and importing; pathology scripting; magnification control.
* **Annotations** — replaced the ruler with a line tool; quick annotation-draw shortcuts;
  polyline works as a polygon in creation style; general UX polish.
* **Rendering & navigation** — synthetic preview image level for incomplete pyramids; z-stack
  (focal-plane) support promoted from the time-series shader to the core; base slide
  virtualization; scroll snapping to zoom levels; reverse scroll; joystick navigation mode.
* **Core** — central shortcut manager (hotkeys plugin removed); viewer virtual aliases; network
  status detection; branding configuration; global menu hover/overlay; do-not-ask-again API;
  streamlined auth configuration and integration API (legacy `oidc-auth` plugin removed);
  bundled third-party license notices; i18n audit script and localization detection.

**Bugfixes**:

* **Chat & voice** — security hardening (chat requires an active session); whisperer/speech
  transcription flexibility, stabilization, and WASM bugfixes; recorder listing; better global
  handling of uncaught errors; more robust chat request/error recovery.
* **Annotations** — border-width rendering and border updates; arrow cut/paste, arrow tool and
  factory stability; angle-arc rendering; polyline/polygon creation and viewport crop; IndexedDB
  serializers and hardened persistence; sink-API deletion propagation; toolbar UI/UX; HTML
  sanitization.
* **Rendering & data** — flex-renderer GeoJSON color parsing; DICOM integration and ICC usage;
  rationai-tile-source tile-size fix; bad-data viewer opening and slide-info behavior; playground
  duplicating shader entries.
* **Loading & build** — production bundling, asset inclusion, minification file serving, and
  handling of failed transpilation/minification; more stable core loading of modules and plugins
  with more metadata support; session env check on cached data.
* **Misc** — questionnaire fixed (now working); measurements plugin; explorer listing; renamed
  the security flag to `secureMode`; dialogs render safe HTML; translation and auth-context fixes;
  strengthened sanitization.

### 3.0.0-beta.1

xOpat v3 is a near-complete rewrite and is **partially backward-compatible with v2** —
but your old modules and plugins should be ported to the new APIs, especially the life-cycle timings
and multi-viewport support. The high-level changes are:

* **New rendering engine** — the WebGL `flex-renderer`, requiring OpenSeadragon v6.
* **Multi-viewport core** — a `VIEWER_MANAGER` can run several viewers on one page; most core events changed accordingly.
* **New UI system** — Van.js + DaisyUI components; Primer CSS, Material icons, and Bootstrap are deprecated.
* **Generic IO pipeline** — unified, pluggable persistence for sessions, annotations, and per-element state.
* **Server RPC & proxy auth** — server-side plugin/module methods and secured upstream proxying (Node; the PHP server supports the proxy).

And more, mostly new approach to most of the functionality to enable reusable functionality and providers,
consumed by generic users - pluggable and extendable. Check out the documentation!

---------------

### 2.3.1
**Features**: author annotation distinction.

**Bugfixes**: php image includes UI folder.

### 2.3.0

**Features**: added a way to set preferred annotation preset IDs for the GUI. Support for
annotation modes private and locked. Support for annotation comments. Implementation of ICC profiles.
Guidelines for WASM usage.
Annotation features: private / locked modes, comments support. Support for copy/move/delete
on right click.

**Bugfixes**: Fixed mjs module loading on servers.

**V3 Pull**: We are slowly adding code from v3 development that does not 
influence the v2 functionality, but allow using v3 features - UI and dev scripts.

### 2.2.2

**Bugfixes**: Fixed annotation visuals for point, line. Fix annotations rest IO, fix logics with refreshing token,
more robust behavior. Better behavior of tutorials. Better points rendering.

**Features**: annotation reconstruction from point array new API. Useful for convertors.
Using 'Unknown', non-exported annotation preset instead of creating new. Configurable data snapshots.

### 2.2.1
**Bugfixes**: faster zooming constant, disabled dynamic speed adjustment.

**Features**: experimental module & plugin sam-segmentation.

### 2.2.0
**NEW UI SYSTEM**. The UI now supports component system using Van.js library. A lightweight
way of re-using defined components, supported newly by tailwind css. The ui will be further
separated from the viewer core in the future. UI Components are not yet integrated, but the CSS Styles are.
There might be slight disturbances on collision of button / theme styling.

**Features:** new UI component system & developer UI tools. Server support for .mjs files - 
support for native JS modules. New annotation tool for multipolygons, new viewport segmentation
annotation tool. New event reacting on visualization rendering setting change.

**Bugfixes:** improved behavior for touchpad zooming.

### 2.1.1
**Features:** standalone wsi tile source module. Edge navigation optional.

**Bugfixes:** OIDC module popup method - await login.
Use session storage to store xOpat sessions as well.
Fixed scalebar magnification estimates. Annotations IO bugfixes.
Extend await event support.

### 2.1.0
**Features:** new system for module/plugin building, improvements of annotation listing features,
support for generic annotation visual style changes.

**Maintenance:** removed outdated plugins.

**Bugfixes:** plugins use also Cache API, annotation visuals updated also with history.
Fix oidc login with events.

### 2.0.4
**Features:** vertical magnification slider, allow 2x artificial zoom, annotation areas.

**Bugfixes:** OIDC module, magic wand annotation tool, stacktrace capture.

### 2.0.3
Bugifxes on annotations. Update font + change default weight. More
events propagated to modes (and recursively factories) to control.

### 2.0.2
New annotation features (edge mouse navigation, undo on manual creation steps, left click works
in navigation mode regardless of left mouse preset, ...). Fix PHP parsing: avoid converting
objects to arrays.

### 2.0.1
Improved annotations & bugfixes with storage API.

### 2.0.0
The version 2 brings:
* new UI features
  * servers: php & node & static
  * docker builds for php server
  * unified data & metadata storage logics
  * unified session config parsing
  * user interface: loading, events, bugfixes
  * maintenance & refactoring
* new modules & plugins
  * oAuth2 login capabilities
  * support for integration with Empaia WBS
  * YouTrack feedback form
  * pollyjs for traffic interception
