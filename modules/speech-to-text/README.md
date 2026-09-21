# speech-to-text

Standalone, viewer-agnostic voice module: capture microphone audio and turn it
into text through a **pluggable driver**, exposed as a generic global API plus a
reusable mic UI. Any part of the system can consume it via
`singletonModule('speech-to-text')`; the Vercel chat composer already does
(dictation + hands-free "voice conversation").

## Quick start

Enable it in `env.json` under `modules`:

```jsonc
"speech-to-text": {
  "enabled": true,
  "driver": "wasm"            // in-browser Whisper, zero extra setup
}
```

The mic (🎤) and hands-free (🎧) controls appear in the chat composer once a
driver is available. Needs a secure origin (`https://` or `localhost`) for
microphone access.

## Drivers & the fallback chain

Transcription can run through an ordered **fallback chain**: the active driver
first, then any others, with the local (in-browser) driver **last** as the
offline fallback.

**The live dictation path does NOT fall back by default.** A configured cloud model
that errors makes the segment fail — visibly (`transcription-error`, a status line
in the composer) — and its audio stays in the archive for the review-time retry.
It used to degrade silently to `Xenova/whisper-tiny.en` on any non-auth error,
and the metrics still named the configured model: a worse transcript, filed under
the primary recognizer's name, with nothing on screen. A deployment that prefers
degraded text over a visible failure opts back in:

```jsonc
"speech-to-text": { "liveFallback": true }
```

The one-shot `transcribeOnce` / `transcribeAudio(…, {allowFallback: true})` paths
keep the chain when asked for it. Every result now carries `driverId` / `model`
from the driver that **answered**, and the same fields in `SegmentMetrics`.

| Driver id | What it is | Audio leaves browser? |
|-----------|------------|-----------------------|
| `wasm`    | In-browser Whisper via transformers.js. Zero-config (pinned CDN library + `Xenova/whisper-tiny.en`). Slower (CPU/WebGPU), fully private. Always registered unless `disableWasmFallback: true`. | No |
| `vercel`  | Cloud transcription via the **vercel-ai-chat-sdk** provider registry (`runTranscription` RPC, key server-side). Fast; the bound provider's adapter must support transcription (AI SDK transcription models — e.g. `chat-openai-compatible`, `chat-openai`). | To the operator-configured endpoint only |
| `remote`  | Direct client→server POST to a self-hosted Whisper endpoint via `HttpClient`. | To that endpoint |

`driver` selects the preferred/active one; omit it and the first configured
driver (in order `remote` → `vercel` → `wasm`) is used.

### `wasm` options

```jsonc
"wasm": {
  "model": "Xenova/whisper-tiny.en",   // or onnx-community/whisper-base, ...
  "device": "wasm",                     // default "wasm" (single, reliable load).
                                        // Set "webgpu" to opt in — that path is
                                        // bounded by a stall timeout and falls back
                                        // to one WASM load if WebGPU hangs.
  "dtype": "q4",                        // quantization for speed
  "multilingual": false,                // true → forward the language hint
  "library": "//cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
  "hash": "<sha256>",                   // required only in secureMode / custom library URL
  "loadTimeoutMs": 30000                // no-progress stall window; bounds ONLY the
                                        // opt-in WebGPU attempt (see device above).
                                        // Reset by every progress tick, so a slow
                                        // but advancing download is never cut.
}
```

First load downloads the model (~40 MB for `whisper-tiny.en`) and fires
`model-loading` progress events. The **default WASM load is a single, unbounded
`pipeline()` call** (matching the SAM tool's known-good pattern) — it is never
stall-restarted, because the compile phase emits no progress and a restart would run
two concurrent loads of the same backend (the earlier "stuck" symptom).
`loadTimeoutMs` bounds only the **opt-in WebGPU** attempt, which falls back to one
WASM load on stall/throw; a hung default-WASM load is cancelled via `stop()` (abort),
not restarted. The composer shows progress as a % (or downloaded MB when the proxy
strips content-length) so a slow first load reads as loading, not frozen. The
module-level `transcribeTimeoutMs` (default 0 = off) is an opt-in hard per-segment
ceiling; leave it off unless you want one, since it also bounds a legitimate slow
first-time model download.

### `vercel` options — reuse the chat provider mechanism

It runs on a **provider instance** registered in the chat SDK whose adapter
supports transcription (`resolveTranscriptionModel` — the optional AI SDK
transcription capability). In-repo that is `chat-openai-compatible` (any
OpenAI-compatible `/v1/audio/transcriptions` endpoint: OpenAI, Groq, self-hosted
whisper) and `chat-openai` (native `@ai-sdk/openai`). The endpoint URL and API
key come from that provider's server-side `config`/`secrets`; the key never
reaches the browser. Transcription-capable providers can be listed at runtime
via the chat SDK's `listTranscriptionProviders` RPC.

**Zero-config is the normal case** — naming a provider is optional:

```jsonc
"speech-to-text": { "enabled": true, "driver": "vercel" }
```

The server then picks the provider (and the model) itself, which is also the only
way to keep working config for *managed* provider instances: their ids are random
and re-minted on every server start, so nothing durable can name them.

**Provider selection** (server-side, `runTranscription`) considers only
operator-registered providers whose adapter can transcribe and whose auth context
admits the caller — a user-created instance can never capture it. Among several,
the winner is deterministic: `metadata.role: 'transcription-default'` first, then
`role: 'default-provider'`, then visible over hidden, then lexicographic — the same
order an ambiguous provider *reference* uses (`shared/providerRef.ts`). An ambiguous
pick is warned about once in the server log, naming the winner and the losers.
`chat-openai` / `chat-openai-compatible` nominate a provider with
`providerDefaults.transcriptionDefault: true` (deployer-only secure config).

**Model selection**, unless `model` is given:
`config.defaultTranscriptionModelId` → `metadata.transcriptionModelId` →
the instance/type `defaultModelId` → `whisper-1`. Set the first one on the provider
(`providerDefaults.defaultTranscriptionModelId`, also a form field on user-created
instances) — especially on a provider shared with the chat agent, whose
`defaultModelId` is a *chat* model that `/audio/transcriptions` rejects.

When no transcription provider is registered (yet), the driver reports itself
unavailable through a cheap, **audio-free** probe and the chain falls to `wasm`
without uploading anything; it recovers by itself once a provider registers. That
case is deliberately *not* a permanent latch — unlike a named-but-unresolvable
provider, which is a config mistake (see below).

Pin a specific provider — e.g. a dedicated STT one, separate from the agent's chat
provider — by naming it:

```jsonc
"speech-to-text": {
  "enabled": true,
  "driver": "vercel",
  "vercel": {
    // A provider REFERENCE, resolved instance id → managed key
    // (`<plugin>:<type>:default`) → plugin id → provider type id, and only to an
    // operator-registered provider. Prefer the plugin id (as below): managed
    // instances get random `prov_…` ids, re-minted on every server start, that
    // cannot be referenced from static config at all. Full contract in
    // modules/vercel-ai-chat-sdk/README.md, "Referencing a provider from static config".
    "providerId": "chat-openai-compatible",
    "model": "whisper-large-v3-turbo",         // optional; else the provider's transcription default
    "timeoutMs": 90000                         // optional client deadline; see below
  }
}
```

`timeoutMs` (default 90 000) is the **client-side** deadline for one transcription
request. It matters: without it the RPC inherits `HttpClient`'s 30 s default, and
that budget also covers the request scheduler's queue wait — under tile load a
queued utterance was aborted before it ever reached the server, silently losing the
words in it. `0` disables the client timer and defers entirely to
`XOPAT_STT_TRANSCRIBE_TIMEOUT_MS` on the server. The `remote` driver takes the
same key.

Like `remote`, the `vercel` key also accepts a **map** of `{ id: config }` to
register several cloud drivers at once (e.g. distinct providers/models); the
`driver` option may then name any map key:

```jsonc
"vercel": {
  "openai":  { "providerId": "chat-openai", "model": "whisper-1" },
  "groq":    { "providerId": "chat-openai-compatible", "model": "whisper-large-v3-turbo" }
}
```

(The map is recognised by all its values being objects, so a single auto config
like `"vercel": { "timeoutMs": 60000 }` — or `"vercel": {}` — still means one
driver, not a map.)

If a **named** provider is absent or its adapter cannot transcribe, the chain falls
back to `wasm` — and because that is a *configuration* problem, it is surfaced
loudly: the module raises a `driver-error` event with `permanent: true`
(console.error, not a silent downgrade) and the driver marks itself unavailable
so audio is not re-uploaded on every utterance. Implemented by
`runTranscription` in `modules/vercel-ai-chat-sdk/server/inference.server.ts`,
which brokers AI SDK transcription models resolved from the provider's adapter,
mirroring `runVisionInference`.

### `remote` options

```jsonc
"remote": {
  "path": "https://whisper.internal/",         // base URL of the whisper server
  "endpoint": "v1/audio/transcriptions",       // appended to path
  "model": "whisper-1",
  "contextId": "core"                          // optional JWT auth context
}
```

## Non-speech hallucination filtering

**Silence is never transcribed at all.** The capture layer tracks *speech
evidence* (a VAD hears sustained voice and accumulates its duration), and audio
without it — a silent one-shot capture, the end-of-turn silence tail of a
continuous session, a segment whose voiced content is under `minVoicedMs` — is
discarded before it can reach any driver. This matters because Whisper-family
models hallucinate plausible phrases ("Thank you.", "Okay.", even "Silence.")
from pure silence, and *which* phrases is model-dependent, so no text-side
filter list can be complete. No audio egress → no hallucination. Such captures
resolve `{text: "", noSpeech: true}`.

```jsonc
"speech-to-text": {
  "minVoicedMs": 400      // min detected voiced ms before audio may be transcribed
}
```

The floor is 400 because 250 was not enough: a 10.8 s segment carrying 359 ms of
voice cleared it, reached `whisper-large-v3`, and came back as the invented word
`"the"` in a pathology transcript. The consumer-side gate applies the same idea as
a *ratio* (see `modules/vercel-ai-chat-sdk/shared/segment-noise.ts`), which is what
catches the end-of-session flush segment — that one bypasses `minVoicedMs` by
design, so it can arrive with `voicedMs: 0`. That ratio is taken against the
segment's **speech span** (`SegmentMetrics.speechSpanMs`, first to last detected
speech), not its wall-clock length: wall time always includes the trailing-silence
window that cut the segment plus any pause before the word, and "UIP" after a
2.5 s think scored 0.09 against it and was rejected as a hallucination.

Three rules keep these filters from eating speech, each learned from a transcript
that lost some:

- **Digital silence is never uploaded, in any mode.** A segment whose loudest
  sample is ~0 (`maxPeak`) is a muted or dead track, not a quiet room. It is
  discarded (`segment-discarded`, reason `silent`) even in fail-open mode, and it
  never counts as evidence that the VAD misjudged speech. A dead microphone used
  to produce one 15 s blob of zeros after another for an hour, each transcribed to
  `"The"`, and the probe on the third flipped the session fail-open.
- **A probe proves speech only if the consumer's gate accepts it.** "Non-empty"
  was the test, and a hallucinated `"The"` passed it.
- **The `minVoicedMs` gate has a ladder too.** The third gated segment in a row
  goes through as a probe (a quiet speaker's every short answer otherwise falls
  under the floor with no signal), and every gate raises `segment-gated`.

Filters that alter what the model said record it in `TranscriptionResult.filtered`
(`non-speech`, `repetition`, `prompt-echo`, `operator-filter`, `truncated`) and
raise `segment-filtered` — with `emptied: true` when a filter blanked a non-empty
decode, which used to be indistinguishable from silence at every layer above.
The repetition filter **collapses** a loop to what it repeats instead of blanking
the whole result (a 90 s window used to lose a minute and a half of dictation to
a loop in its last five seconds); only a decode that was nothing but loop empties.
The prompt-echo filter blanks only an echo led by one of the prompt's own labels
(`Common terms:`) — "two glossary terms and nothing else" is a finding, not an
echo, and `"fibrosis, necrosis."` was being deleted.

When the backend returns `verbose_json` (the OpenAI-compatible path asks for it
and degrades to `json` per model when refused), Whisper's own verdicts ride along:
`noSpeechProb`, `avgLogprob`, `compressionRatio` on the result and in the
metrics. The consumer gate takes `noSpeechProb ≥ 0.6` as the model saying it heard
silence, ahead of every audio heuristic. `temperature=0` is sent on that path too
(the self-hosted driver always did), so the same audio decodes to the same words.

### The speech detector (VAD)

The verdict "is this speech" comes from **Silero VAD** (v5, via
[`@ricky0123/vad-web`](https://www.vad.ricky0123.com/) over onnxruntime-web, WASM
backend) — a model that scores 32 ms frames for *voice*, not loudness. The
amplitude peak meter this module used before is still present as the **fallback**
engine. Both feed one pure gate (`speechGate.ts`): Silero as a probability with
hysteresis (on at `positiveSpeechThreshold`, off below `negativeSpeechThreshold`),
amplitude as the adaptive noise-floor gate; the session's first onset must hold
for `minSpeechMs` under either.

Under Silero the engine's own 16 kHz frames are the segment audio: each segment is
uploaded as a **PCM16 WAV** cut exactly at the frame that ended it (no per-segment
`MediaRecorder`, no flush latency, no seam overlap — `overlapMs` is 0). The
whole-session archive stays a MediaRecorder/Opus recording. `meta.vad` /
`metrics.vad` and `getCaptureHealth().clock` say which engine judged a segment
(`"silero"` | `"amplitude"` | `"none"`).

One engine instance lives for the page: it owns its `AudioContext`, loads the model
once (the first dictation waits for it — ~16 MB the first time ever, browser-cached
after), and attaches to each capture's stream per session. It **falls back** to the
amplitude gate — reported once per session as `capture-warning {code:
"vad-fallback"}` — when the assets are missing, the load exceeds `vad.loadTimeoutMs`,
the browser lacks `AudioWorklet`/WebAssembly, or the frames stop mid-session while
the microphone is live (the open PCM segment flushes as WAV, its successor records
through MediaRecorder; a session never switches back). The assets are served
same-origin from `dist/silero/` (copied out of `node_modules` by the module build:
the worklet bundle, `silero_vad_v5.onnx`, the onnxruntime-web glue and wasm), so no
CDN, no hash pinning and nothing `secureMode` needs to gate. A deployment that
*enforces* a CSP needs `script-src 'self' 'wasm-unsafe-eval'` for it (the worklet
module, the wasm, and the dynamic `import()` of the ORT glue); threads are off, so
no COOP/COEP.

The amplitude engine's clock is an `AudioWorklet` peak meter (`vad-worklet.js`, a
static module asset loaded at capture start) running on the audio render thread,
which browsers never throttle — so capture keeps working in a hidden/unfocused tab.
When the worklet cannot load (no `AudioWorklet`, restrictive CSP) it falls back to a
`requestAnimationFrame` analyser loop; since hidden tabs pause rAF entirely, a stall
watchdog then marks affected segments as evidence-untracked (`meta.tracked=false`),
which degrades open: the audio is transcribed instead of being discarded as
"speechless", and the text-side filters remain the gate. The probe / fail-open
ladder described above is an **amplitude-only** device: a Silero verdict is never
overridden by a transcript, because probing silence is exactly how hallucinated
"Thank you." turns used to flip whole sessions into uploading everything.

Configuration, module static meta `vad` (deployment ENV / `include.json`, §7 — never
a session option):

| Key | Default | Meaning |
|-----|---------|---------|
| `engine` | `"silero"` | `"amplitude"` disables the Silero engine entirely (no assets fetched). |
| `positiveSpeechThreshold` | 0.5 | Silero probability at which speech turns on. |
| `negativeSpeechThreshold` | 0.35 | Silero probability below which speech turns off. |
| `loadTimeoutMs` | 15000 | Bound on the first-ever model load before the session falls back to amplitude. |
| `assetsUrl` | `<module>/dist/silero/` | Where the vendored assets are served from (same origin). Absolute or app-relative; resolved against the page — onnxruntime-web needs an absolute base for its dynamic `import()` of the wasm glue. |

On noise that *does* carry enough acoustic energy to pass the gate,
Whisper-family models can still emit caption-like artifacts. The built-in
`stripNonSpeech` filter removes the common syntaxes and blanks the transcript
(treated as "no speech") when only an artifact remains:

- bracketed stage directions — `(dramatic music)`, `[MUSIC]`, `{coughs}`
- asterisk-wrapped sound tags — `*Buzzing*`, `*sips*`, `*sounds of a plane*`
- musical glyphs — `♪ ♫ 🎵 🎶`
- stock end-card phrases — `Thanks for watching`, `Please subscribe`, …

**Biasing-prompt echo.** Fed a long domain-biasing `prompt` (the pathology
glossary the chat sends) over near-silent audio, Whisper-family models often
regurgitate that prompt verbatim as the "transcript" — repeated, sometimes with
`context:` / `###` markers. Left in, that echo reads as real speech and (worse) a
probe segment "transcribing to text" flips the session fail-open, disabling the
voiced-ms gate so *all* later silence gets transcribed too. The capture layer
strips the prompt's own phrases (runs ≥25 chars, so genuine single glossary words
a pathologist actually says survive) from every transcript; a segment that
reduces to empty is treated as no-speech, so the echo never renders and never
trips fail-open. Real dictation mixed with a trailing echo keeps its real words.

**Limitation:** models differ in how they render non-speech, so this list can't
be exhaustive. Add your own patterns (applied on top of the built-ins) via
`filterPatterns` — an array of case-insensitive regex strings. A transcript that
reduces to empty after filtering is never submitted.

```jsonc
"speech-to-text": {
  "filterPatterns": [
    "^\\s*buzzing\\s*$",        // whole-transcript junk word
    "\\bthank you\\.?$"          // trailing stock phrase
  ]
}
```

### Accuracy biasing (language + vocabulary)

Two soft hints improve transcription of domain terms and keep the language level
stable. Both flow through `TranscriptionOptions` to the driver, so any consumer
(not just chat) can set them per call; module-wide defaults live in static meta:

```jsonc
"speech-to-text": {
  "language": "en",          // BCP-47; unset → "auto": detect, then pin (never the UI locale)
  "prompt": "histology, immunohistochemistry, mitosis, stroma, carcinoma",
  "promptMaxChars": 0,       // composed-prompt cap; 0 = no prompt is sent at all (default)
  "contextPromptChars": 0,   // rolling previous-transcript context per segment; 0 = off (default)
}
```

**The prompt is OFF by default (`promptMaxChars: 0`) — nothing is sent.** It was the
cause of every "dropped content" symptom in the MIXTURE field rounds on a self-hosted
`whisper-large-v3`. Measured on that endpoint (one 93 s dictation, the same blob each
time, `verbose_json`, `temperature=0`):

| prompt sent | result |
|---|---|
| none / `language=en` only | full 93 s, correct from the first word |
| 60 chars | full |
| 120 chars | full span, text thinner |
| 200 chars | **first 30 s gone** |
| 495 chars (the base glossary) | **last third gone** |
| ~870 chars (glossary + report terms) | **30 s of the middle, nothing else** |

The container, the RPC hop and the model were all fine; the `prompt` field alone made
the decoder drop whole stretches of audio, in proportion to its length. The rolling
context tail (`contextPromptChars`) was the same effect through a different prompt.
Vocabulary belongs to the post-hoc corrector (the report flow's `learnedCorrections`
already feed it), not to the recognizer.

That finding is about **that backend**. OpenAI's `gpt-4o-transcribe` /
`gpt-4o-mini-transcribe` document `prompt` as the vocabulary-bias channel and show no
such pathology — but measure on your own dictations before trusting a high value (same
audio, prompt 0 / 60 / 200 / 700 / 1000, look for dropped spans, not just word errors).

A deployment opts in with a cap, and **both** gates have to open — the client one here
and the server one on the provider:

```jsonc
"speech-to-text": { "promptMaxChars": 60 }     // ≤ 60 measured safe on whisper-large-v3 above; hard ceiling 1000
"speech-to-text": { "promptMaxChars": 1000 }   // OpenAI gpt-4o-transcribe family (env/parts/voice/openai-4o-transcribe.json)
```

The server applies its own per-provider cap (`providerDefaults.transcriptionPromptMaxChars`
in the chat provider plugin's secure config, default 0, ceiling 1000), so no client can
re-enable the prompt by accident. It is deliberately not an admin-panel field: panel fields
are RPC-writable, and a caller must not be able to raise its own cap. When enabled the
prompt is cut on a word boundary — from the END, so the composed prompt's order matters:
the chat composer (`voice.promptBudget`, see below) trims its generic glossary first and
keeps the report's terms whole.

- **`language`** pins the model's language instead of letting it free-detect one
  per utterance (the drift behind e.g. an English clause read as another tongue).
  Unconfigured it is `"auto"`: detected, then pinned once two consecutive segments
  agree — never the UI locale (see "Language" below).
- **`prompt`** is Whisper's vocabulary bias (`prompt` / whisper.cpp
  `initial_prompt`, ~224-token soft hint): seed it with the terms/spellings the
  transcript should favour so homophones resolve toward the domain ("histology",
  not "history"). It is length-capped (~1000 chars) and **ignored by the
  in-browser WASM driver** (transformers.js exposes no such decoder option) — the
  remote / vercel (server) drivers apply it. The chat composer supplies a richer
  prompt automatically (see below); this static-meta value is the module-wide
  fallback for other consumers.
- **`contextPromptChars`** (continuous dictation only) feeds the tail of what has
  already been transcribed this session back as the *next* segment's prompt. Segments
  are decoded independently, so in principle this stops each one starting blind and
  resolving domain vocabulary from general priors — which is how "pleura" comes back as
  "prostate". The tail is appended AFTER the glossary (closest to the audio = the
  strongest bias) and the combined prompt is trimmed to the same ~1000-char cap,
  glossary first.

  **Default `0` — off. Measure before switching it on.** It is a feedback path into
  the decoder and its sign is model-dependent. On `whisper-large-v3` it truncated
  output badly, measured as words produced per second of VAD-detected voiced audio
  (a figure the recognizer has no say in; normal read-aloud speech is ~2.5–3):

  | segment | rolling tail | words / voiced second |
  |---|---|---|
  | 0 of a capture | none | **2.86**, **1.83** |
  | 1 | 240 chars | 0.63, 1.20 |
  | 2 | 240 chars | 0.72 |

  Every segment after the first was cut to roughly its opening few seconds, and it
  compounded — the shrinking tail became the next segment's prompt. The same code path
  feeds the 90 s archive windows (`_enqueueWindow`), so the whole-audio transcript
  degrades identically. The earlier provider showed none of this on the same setting,
  which is exactly why it has to be measured per model rather than assumed.

An echo guard removes a returned transcript that is merely the prompt repeated
back (a known Whisper behaviour on near-silence). The glossary is matched
fragment-wise, the rolling context only as a whole run — so a speaker legitimately
repeating a phrase they just said keeps it.

### Repetition locks

The rolling context is a **feedback path**: what the model emits becomes the bias for
the next segment. A prompt-obedient model that re-emits its own tail therefore
reinforces itself, and each round the bias is more concentrated than the last. This is
not hypothetical — with `whisper-large-v3` one 450 s dictation came back as `"I'm not
the"` for ten consecutive segments, while the whole-audio pass over the *same* audio
read as ordinary speech.

Length cannot tell an echo from a real repeat: the echo guard above deliberately ignores
anything under 25 chars so a pathologist saying one glossary term keeps it, and `"I'm
not the"` is eleven. The pairing can — a segment that both repeats the previous one
verbatim **and** is contained in the tail it was prompted with is an echo. `repetitionLock.ts`
acts on that, asymmetrically, because the two mistakes cost differently:

- **The context tail is muted** on any repeat, echo or not. That costs one segment's
  worth of accuracy and no words at all, and with no tail to copy a locked decoder has
  nothing to sustain the lock with. It is restored as soon as the output moves on.
- **The segment is dropped** only for the echo pairing, and never the first instance. A
  speaker who genuinely said something twice loses a duplicate the transcript did not
  need, never a finding.

The transition raises `transcription-repeat-lock` once (payload `{ text, index }`), so a
stuck recognizer is visible instead of reaching the transcript as ordinary short segments.

## Voice UX config (chat composer)

Under the chat module's `voice` block (all optional):

| Key | Default | Meaning |
|-----|---------|---------|
| `silenceMs` | 1200 | Trailing silence before a turn auto-stops. |
| `silenceThreshold` | 0.04 | Amplitude engine only: peak speech floor (with adaptive noise tracking). |
| `speechFloorMult` | 3.0 | Amplitude engine only: a peak must exceed `noiseFloor × this` to count as speech. Higher rejects more background noise but risks dropping a very quiet speaker; lower it (e.g. 2.5) if soft speech is being missed. |
| `minSpeechMs` | 200 | Both engines: the session's first speech must hold this long before it counts as onset — rejects brief blips (clicks, taps, door). Silero thresholds live in the module's `vad` block (see the VAD section). |
| `language` | `"auto"` | `"auto"`: the recognizer detects the language; once two consecutive segments agree, that language is the hint for the rest of the dictation (see "Language" below). A BCP-47 code pins it for every request. Never the UI locale. |
| `prompt` | — | Domain/vocabulary biasing text (Whisper `prompt` / whisper.cpp `initial_prompt`) — appended to the built-in translatable pathology glossary and live domain-tool terms so homophones resolve toward the domain ("histology", not "history"). Ignored by the in-browser WASM driver. Length-capped (~1000 chars). |
| `autoSubmit` | false | Manual dictation: fill-and-review vs. send. |
| `minVoicedMs` | 400 | Minimum detected voiced ms a capture/segment needs before it is transcribed at all (see hallucination filtering above). |
| `reArmDelayMs` | 500 | Settle pause between an assistant reply and the next queued submission. |
| `turnSilenceMs` | 2000 | Hands-free only: longer end-of-turn silence that completes a turn. The mic stays hot through each segment's transcription while the user pauses only briefly, so nothing is lost; a pause this long completes the turn. Must exceed `silenceMs`. |
| `idleAutoOffMs` | 300000 | Hands-free only: after this long with no real speech, voice conversation switches itself off (status note shown). A silent, *thinking* user is fine — silence submits nothing and the session just keeps waiting until this generous timer runs out. |
| `busyHoldMs` | 4000 | Hands-free only: how long the assistant may compute before captured speech is **held** as an editable composer draft instead of being auto-submitted when the reply lands. A long reply otherwise concatenated everything said while waiting — corrections, side conversation, thinking aloud — into the next question. Below this window nothing changes; past it the user decides what goes out (Enter / Send / a spoken confirm phrase). `0` disables holding. Ignored in transcript-only mode. |
| `staleSessionMs` | 8000 | Hands-free only: how long capture may go without a **heartbeat** — recorder bytes, a level tick, a transcribed segment, or a health poll that confirmed a running context on a live track — before the session counts as stalled. Deliberately **not** the level meter alone, which stalls for reasons that say nothing about the microphone. A watchdog tick that was itself delayed longer than this window (blocked main thread, frozen tab, suspended machine) is discarded rather than acted on: that gap measures the observer's outage, not the microphone's. `0` disables the watchdog. |
| `staleRestartAttempts` | 2 | Hands-free only: how many times a stalled capture is re-opened **in place** (backed off 0.5 s, 1 s, …) before the session is declared lost. A restart keeps the queued turns, the held draft, an edit pause and the retained recording — only the microphone is replaced, at the cost of a gap in the recording. `0` restores the old fail-immediately behaviour. |
| `holdVoiceCommands` | true | Let a **whole** utterance release a held draft (`autoModeConfirmPhrases`, e.g. "send it") or drop it (`autoModeDiscardPhrases`, e.g. "scratch that"), so hands-free mode needs no hand after a long reply. Whole-utterance only: "send that to the lab" is dictation, not a command. |
| `holdConfirmPhrases` | locale | Override the spoken "send the draft" phrases — `\|`-separated string or a list. |
| `holdDiscardPhrases` | locale | Override the spoken "drop the draft" phrases — `\|`-separated string or a list. |
| `maxEmptyRetries` | — | **Deprecated, ignored.** Silence produces no captures anymore, so an "empty streak" cannot occur; superseded by `idleAutoOffMs`. |
| `noValidContentMs` | — | **Deprecated, ignored.** Turns are no longer force-ended on quiet users; superseded by `idleAutoOffMs`. |

The chat composer builds the biasing `prompt` automatically: a translatable
pathology glossary (`voice.transcriptionPrompt` in `modules/vercel-ai-chat-sdk/locales/en.json`),
the deployment's `voice.prompt`, and the terms a consumer such as the report plugin
supplies (`setVoicePromptTerms`), rebuilt at each capture. The three are fitted into
`voice.promptBudget` (default 1000) with the consumer's terms first and the generic
glossary trimmed to what is left — this module cuts an over-long prompt from the end,
and the terms sit at the end. Only generic domain vocabulary is sent — never
slide/patient identity, which must not egress to the transcription endpoint.
`voice.language` unset means `"auto"` (detect, then pin — never the UI locale).

## Language

The transcription language is **detected, then pinned** (`language: "auto"`, the default).
The first segments of a dictation go out with no hint; every result's reported language is
a vote, and once two consecutive segments agree that language becomes the hint for the rest
of the dictation — including the recording's windows when they are decoded — and the module
raises `language-pinned {language}`. Two agreeing ~15 s segments keep one noisy detection
from pinning the wrong language; the pin then holds until the next dictation
(`clearSessionAudio`), because a hinted recognizer echoes the hint back and cannot outvote
it. A BCP-47 code in `language` pins every request instead.

It is never the UI locale. The viewer's locale says what language the buttons are in, not
what the pathologist speaks — pinning transcription to it is how a Japanese dictation came
back as "I'm … and the … I think" (Whisper decoding Japanese audio into English filler).

Each segment's `metrics` carry `language` (what the recognizer reported, primary subtag) and
`languageHint` (what the request said; undefined = detected). The module's own default glossary
(`prompt` static meta) is English and is never sent into a non-English session; a caller's
prompt is its own responsibility — the chat composer drops its English glossary once the
language is pinned and sends only the consumer's terms, which the MIXTURE plugin sets in the
dictation's language from its translated vocabulary. The prompt stays **off by default**
(`promptMaxChars` 0; it was measured to truncate output on the CERIT backend when long). To try
it for a language: set `promptMaxChars: 120` on a test deployment, dictate, and compare the raw
homophone rate in `voice-segment` texts with and without it.

The text filters are script-agnostic: word counting, seam trimming, repetition and echo
detection tokenise with `Intl.Segmenter` (`textWords.ts`), so a sentence written without
spaces is as many words as it has. Whisper's Japanese subtitle fillers
(「ご視聴ありがとうございました」 …) are blanked like the English ones, and so is a bare subtitle or
translation **credit** in any language it learned them from ("Titulky vytvořil JohnyX.",
"Untertitel im Auftrag des ZDF", "Sous-titres réalisés par …", "Subtitles by …", a lone
`www.…` line) — matched against the whole segment only, so a sentence that merely mentions
subtitles is kept. One limitation:
`collapseRepetition` leaves CJK text unchanged (a loop there is still caught, and blanked, by
`looksRepetitive`).

## Global API

```js
const stt = singletonModule('speech-to-text');
await stt.isAvailable();                         // driver present + mic grantable
const { text, noSpeech } = await stt.transcribeOnce();  // one utterance → text
                                                 // (noSpeech: silence, never sent to a driver)
stt.startDictation();                            // { stop(), done }
stt.stop();
stt.listDrivers(); stt.setActiveDriver('vercel');
stt.createMicButton({ onResult }).attachTo(el);  // reusable BaseComponent mic
```

Events (via the module's EventSource): `recording-started` / `recording-stopped`
/ `transcription-started` / `transcription` / `transcription-error` /
`capture-warning` / `driver-error` / `transcription-repeat-lock` /
`segments-abandoned` / `segment-gated` / `segment-discarded` /
`segment-filtered` / `segment-empty` / `segment-trimmed` / `capture-started` /
`window-transcription-started` / `window-transcription` /
`window-transcription-error` / `window-empty`.

`capture-started` fires once the segment recorder is actually running — permission
granted, stream open, encoder started. `recording-started` fires on the start *call*,
before the `getUserMedia` promise; a UI that shows "listening" on it invites the speaker
to begin a second early, and those words were never recorded. `segment-empty`
(`{ index, audioMs, voicedMs, speechSpanMs, maxPeak, latencyMs, driverId, noSpeechProb,
avgLogprob, reportedDurationMs, filtered, probe }`) fires when a driver returned no text
for a segment that was uploaded — an endpoint answering 200 with an empty body for two
minutes used to look exactly like silence. `segment-trimmed` (`{ index, words,
overlapMs, dropped? }`) fires when the repeated head of a piece was cut at the seam with
the previous one (consecutive recordings share up to a timeslice of audio, and the
recognizer transcribes it twice — `metaplasia, metaplasia`); see `joinSegments.ts`.

The `segment-*` trio is the module's "no silent path" contract — every recorded
segment that does not reach the transcript says why: `segment-discarded`
(`{ reason: "no-speech" | "silent" | "session-ended", audioMs, voicedMs, maxPeak }`)
for audio the capture never emitted; `segment-gated`
(`{ index, voicedMs, minVoicedMs, speechSpanMs, probe }`) for audio under the
voiced floor; `segment-filtered`
(`{ filters, emptied, rawChars, chars, rawText, channel }`) for text a filter
changed or blanked. The `window-*` events are the archive path's own, so a 90 s
background decode no longer paints the live caption band or flips the composer's
"transcribing" indicator; `window-empty`
(`{ index, bytes, reportedSec, localDecodeSec, localDecodeError, noSpeechProb }`)
carries the diagnosis of a window that decoded to nothing — `localDecodeSec` is
the browser's own decode of the same blob, so a full local length beside an empty
upstream result names the backend, and a failed local decode names the capture.
`transcription-repeat-lock` fires **once**, on the transition, when continuous
dictation starts repeating itself — payload `{ text, index }`. See
*Repetition locks* below for what the module does about it.
`segments-abandoned` fires when a stop/abort discards audio that was captured and
queued but never transcribed — payload `{ indices, bytes, audioMs, reason }`. This
is the module's one path to losing speech outright, and "the last thing I said
before stopping never appeared" is indistinguishable from a dozen other faults
without it. `transcription-started` fires when a
transcription batch actually begins — in continuous mode, each time the
in-flight count leaves 0 — not once at session start, so "transcribing"
indicators reflect real work. `driver-error` fires per failed driver *before*
the fallback chain moves on, payload `{ driverId, error, permanent }`;
`permanent: true` marks a configuration error (e.g. a `vercel` driver bound to a
provider whose adapter cannot transcribe) that no retry can fix.
Plus `model-loading` — fired while a driver loads its model
(the in-browser WASM model download/compile), payload
`{ driverId, status, file, progress /* 0..1 */, loaded, total, done }`. The chat
composer reflects it as a "Loading local voice model… X%" status so a slow first
load reads as loading, not frozen; `done: true` marks the terminal (ready/failed)
tick. `stop()` cancels an in-flight continuous transcription (and a hung WASM load),
so hands-free mode never wedges on a stuck local model.

### Continuous dictation (never miss speech during transcription)

`transcribeOnce` records one utterance and only transcribes *after* releasing the
mic — so anything said while a chunk is transcribing is lost. `startContinuousDictation`
keeps the microphone open across many silence-delimited **segments** and transcribes
each segment *while the next is already being recorded*. Segments transcribe
concurrently but are concatenated strictly in capture order; empty/invalid segments
(noise, a cough) are skipped without dropping their neighbors. This is the API to use
for a live mic stream fed incrementally to a model.

```js
const stt = singletonModule('speech-to-text');
const h = stt.startContinuousDictation({
  language: 'en',
  onLevel: (lvl) => meter(lvl),                 // 0..1 live input level
  onPartial: ({ appended, text, index, metrics }) => {  // each in-order segment as it lands
    feedToModel(appended);                       // incremental, or use `text` (full so far)
    // `metrics` = { audioMs, voicedMs, tracked, bytes, latencyMs, driverId, model,
    //               probe, failOpen, flush } — what the text was decoded FROM.
    // Log it: three words out of ten seconds of speech and three words out of a
    // three-word utterance are otherwise the same event, and telling a bad model
    // apart from bad audio after the fact is impossible without it.
  },
  turnSilenceMs: 2000,                           // optional: end-of-turn silence signal
  onTurnIdle: () => h.stop(),                    // optional: react to a long pause
});
// ...
const finalResult = await h.stop();              // stop, flush, resolve full transcript
```

`stop()` flushes the in-flight segment and resolves the full concatenated transcript;
`h.done` resolves the same value when the session ends for any reason. Only segments
with real detected speech are ever transcribed — leading/trailing silence and
sub-`minVoicedMs` blips never reach a driver.

Segments are cut on a trailing-silence boundary, so a blob normally ends between
words. `maxSegmentMs` bounds a non-stop monologue, but only *softly*: when it
elapses the cut waits for the next ~300 ms word gap and is forced only 3 s later.
Consecutive segments also overlap by the recorder flush latency instead of leaving
a gap, so nothing spoken across a boundary is dropped. Both matter because a word
split across two independently-decoded blobs is not transcribed as half a word —
the model invents a whole, plausible, wrong one.

#### Session scoping — who owns the dictation boundary

`startContinuousDictation` drops the previous dictation's retained recording and
windows unless `continuesSession: true` is passed. The **chat controller always passes
it**: the archive is only ever on in transcript-only mode, where the consumer (the
report flow) clears the recording at report start and after confirmation and compares
the whole-audio text against everything said since that confirmation — a start that
dropped the recording made it cover one capture while "live" still held the previous,
unconfirmed round, so the whole-audio pass read as "too short" and was discarded.
Direct module users keep the clean-start default; a consumer that retains audio owns
its lifetime via `clearSessionAudio()`. `clearSessionAudio()` also **aborts** any window upload
still in flight, so "delete my recording" means none of it leaves the browser
afterwards.

Every window has a state — `pending` (queued or decoding), `done`, `retryable`
(no text, audio still held: `transcribeSessionAudio()` retries it), `failed` (no
text, no audio) — read through `sessionWindowCount` / `pendingWindowCount` /
`retryableWindowCount` / `failedWindowCount`. In eager mode `pending` reaches 0 once
`whenSessionAudioSettled()` resolves (in lazy mode it stays above 0 until
`transcribeSessionAudio()` decodes them — nothing arrives on its own); `pending` and
`retryable` used to be one state, so a decode that had failed minutes ago read as
"about to arrive".
`transcribeSessionAudio()` awaits the settle point itself, retries each window on
its own, and returns what decoded even when one window fails.

#### Rolling windows (`windowMs` / `onWindow`) — accuracy paid for during dictation

A segment is a few seconds of audio and that is all the context its transcription gets.
A **window** is ~90 s of the same recording, sealed at a segment boundary (so never
mid-word) and transcribed in the background *while the pathologist keeps talking*:

```js
const h = stt.startContinuousDictation({
  archive: true,                     // windows are slices of the archive
  windowMs: 90000,                   // default; 0 = one pass at the end instead
  onPartial: ({ appended }) => showCaption(appended),        // live, low latency
  onWindow: ({ text, index }) => bank(index, text),          // accurate, ~90 s behind
});
```

The two streams answer different questions and both are wanted: `onPartial` is what the
UI shows *now*, `onWindow` is what the record should *say*. Windows are transcribed one
at a time so they never compete with live segments for the scheduler's reserved urgent
slot, each is prompted with the tail of the previous window's transcript, and the audio
is freed as soon as its text exists.

The payoff is at the end: `transcribeSessionAudio()` joins the banked window texts and
only decodes whatever tail was still open, so what used to be a multi-minute upload at
review time is a couple of seconds. A window whose background pass failed keeps its
audio and is retried there.

`windowMode: "lazy"` is the other trade. The windows are still sealed and banked, but
**nothing is uploaded** and `onWindow` never fires; `transcribeSessionAudio()` decodes
them serially only when a consumer asks for the recording. That is the right shape for a consumer whose review starts from the live
transcript and re-reads the recording only when that looks incomplete — eager decoding
was an upload per window for text that was usually never read. The audio is held for the
whole dictation, bounded by `archiveMaxBytes` / `archiveMaxMs` as before.

#### Whole-session archive (`archive`) — the accurate final transcript

A segment is the entire context its transcription model gets. Decoding a few
seconds at a time is materially less accurate on domain vocabulary than decoding
the whole recording once, so a consumer that keeps an authoritative transcript
(a dictated report) should record the session and re-transcribe it at the end:

```js
const h = stt.startContinuousDictation({ archive: true, onPartial: … });
// … dictation runs, live segments drive the live UI …
await h.finish();

const audio = stt.getSessionAudio();             // { blobs, truncated } | null
if (audio && !audio.truncated) {
  const text = await stt.transcribeSessionAudio({ prompt: glossary });
  adoptAuthoritativeTranscript(text);            // far better than the joined segments
}
stt.clearSessionAudio();                         // audio is sensitive — drop it once used
```

`getSessionAudio()` returns a **list**: pausing and resuming dictation produces one
recording per capture, and separate containers cannot be concatenated as bytes.
`transcribeSessionAudio()` transcribes each and joins the text. Recordings are
retained across pause/resume — the consumer decides when a *new* dictation starts
and calls `clearSessionAudio()` then; nothing clears them implicitly.

**Check `truncated` before adopting the result as authoritative.** A capped archive
produces a transcript that reads as complete while missing the end, which is worse
than a less accurate but complete one.

`transcribeAudio` deliberately does **not** fall back to the in-browser model
(`allowFallback` defaults to false): a tiny-model transcript silently replacing the
segment text would be worse than what it replaced. It rejects instead, and the
caller keeps what it has. The archive is capped (20 MB / 45 min, both configurable
via `archiveMaxBytes` / `archiveMaxMs`); past the cap recording stops and
`truncated` is set. It is held in memory only, cleared when the next session starts
or on `clearSessionAudio()`.

#### Turn-based conversation (`onTurn`)

For conversational consumers, pass `onTurn` and the session becomes an unbounded
listener that hands out one **completed turn** at a time: whenever the speaker
goes quiet for `turnSilenceMs`, the accepted segments since the previous turn are
concatenated and delivered (only after all their transcriptions finished — text
is never split or lost). Silent stretches deliver nothing; capture just keeps
waiting. The session still ends only via `stop()`.

```js
const h = stt.startContinuousDictation({
  turnSilenceMs: 2000,
  onTurn: ({ text, index }) => submitToAssistant(text),  // never fires empty
});
```

The chat composer's hands-free mode is built on this: one persistent session for
the whole conversation, turns queued while the assistant is busy and submitted
the moment it is idle — the user can keep talking during a reply and nothing is
dropped.

## Diagnostics

The module logs through the client broker (`APPLICATION_CONTEXT.log`, see
`src/LOGGING.md`) on `module.speech-to-text`; the VAD's cut decisions (engine, noise
floor / gate, peak, why a segment was cut) and the Silero load / fallback are on the
`module.speech-to-text:vad` sub-channel at `debug` (fallbacks at `warn`). The root level defaults to `warn`, so none of it costs anything in production;
a deployment turns it on in `env.client.logging.channels`:

```jsonc
"client": { "logging": { "channels": {
  "module.speech-to-text": "debug",            // everything the module says
  "module.speech-to-text:vad": "debug",        // only the VAD decisions
  "module.vercel-ai-chat-sdk:voice": "debug"   // the chat composer's voice controller
} } }
```

(There is no per-feature flag any more — the old `xopat-stt-debug` localStorage key is gone;
a channel level is the switch, the same for every subsystem.)

To see which driver actually served each segment — a silent fall back to the WASM
tiny model looks identical in the UI but transcribes far worse — listen in:

```js
const stt = singletonModule('speech-to-text');
stt.addHandler('transcription', e => console.log('[stt] driver=', e.driverId, 'vad=', e.metrics?.vad, '|', e.result?.text));
stt.addHandler('capture-warning', e => console.warn('[stt] capture-warning', e.code));   // "vad-fallback" = amplitude gate in use
stt.getCaptureHealth().clock;   // "silero" | "worklet" | "raf" | "none" while capturing
stt.addHandler('driver-error', e => console.warn('[stt] driver-error', e.driverId, e.error));
stt.addHandler('segment-filtered', e => console.warn('[stt] filtered', e.filters, e.emptied ? 'EMPTIED' : '', e.rawText));
stt.addHandler('segment-gated', e => console.log('[stt] gated', e));
stt.addHandler('segment-discarded', e => console.log('[stt] discarded', e.reason, e));
stt.addHandler('window-empty', e => console.warn('[stt] window empty', e));
// the audio of every window that produced no text, for decoding elsewhere:
stt.getFailedWindowBlobs();
stt.exportFailedWindows();   // …or download each as window-<index>.webm right away
// then, e.g.: ffprobe window-0.webm; curl -F file=@window-0.webm -F model=… /audio/transcriptions
// with and without -F prompt=… — that comparison is what found the prompt defect above.
// queue pressure on the background HTTP lane (transcription is `background-urgent`)
setInterval(() => console.log('[stt] sched', APPLICATION_CONTEXT.requestScheduler.stats()), 3000);
```

## Security notes

Driver/endpoint/model selection is read only from `getStaticMeta` (ENV, trusted)
— never from `getOption` (§7). Upstream audio goes through `HttpClient`
(`remote`) or a server-side RPC with the key held server-side (`vercel`). The
WASM library is fetched and SHA-256-verified before import; remote CDN loading is
refused in secureMode without a pinned hash. Speech-less audio is never sent to
any driver (no egress of silent room audio), and Whisper's non-speech
hallucinations (`(dramatic music)`, etc.) are filtered out and never submitted.
