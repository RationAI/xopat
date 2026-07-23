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

Transcription runs through an ordered **fallback chain**: the active driver
first, then any others, with the local (in-browser) driver **last** as the
guaranteed offline fallback. If a preferred cloud/remote model is missing or
errors, transcription degrades to local Whisper automatically — so a driver that
"isn't guaranteed to be there" is safe to prefer.

| Driver id | What it is | Audio leaves browser? |
|-----------|------------|-----------------------|
| `wasm`    | In-browser Whisper via transformers.js. Zero-config (pinned CDN library + `Xenova/whisper-tiny.en`). Slower (CPU/WebGPU), fully private. Always registered unless `disableWasmFallback: true`. | No |
| `vercel`  | Cloud/self-hosted Whisper via the **vercel-ai-chat-sdk** provider registry (`runTranscription` RPC, key server-side). Fast; needs an OpenAI-compatible `/v1/audio/transcriptions` endpoint. | To the operator-configured endpoint only |
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

Point it at a **provider instance** already registered in the chat SDK whose
endpoint implements OpenAI's `/v1/audio/transcriptions` (OpenAI, Groq, or a
self-hosted whisper server). The endpoint URL and API key come from that
provider's server-side `config`/`secrets`; the key never reaches the browser.

```jsonc
"speech-to-text": {
  "enabled": true,
  "driver": "vercel",
  "vercel": {
    // Stable reference: an exact provider instance id, OR (recommended) the
    // owning chat plugin id — plugin-managed instances get random `prov_…` ids
    // that can't be referenced from static config, so runTranscription also
    // resolves by `metadata.managedByPlugin` / type id.
    "providerId": "chat-openai-compatible",
    "model": "whisper-large-v3-turbo"          // optional; else provider/type default or whisper-1
  }
}
```

If that provider is absent or the endpoint doesn't serve transcription, the
chain falls back to `wasm`. Implemented by `runTranscription` in
`modules/vercel-ai-chat-sdk/server/inference.server.ts` (a direct multipart POST
— no extra AI-SDK provider package), mirroring `runVisionInference`.

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
  "minVoicedMs": 250      // min detected voiced ms before audio may be transcribed
}
```

On noise that *does* carry enough acoustic energy to pass the gate,
Whisper-family models can still emit caption-like artifacts. The built-in
`stripNonSpeech` filter removes the common syntaxes and blanks the transcript
(treated as "no speech") when only an artifact remains:

- bracketed stage directions — `(dramatic music)`, `[MUSIC]`, `{coughs}`
- asterisk-wrapped sound tags — `*Buzzing*`, `*sips*`, `*sounds of a plane*`
- musical glyphs — `♪ ♫ 🎵 🎶`
- stock end-card phrases — `Thanks for watching`, `Please subscribe`, …

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
  "language": "en",          // BCP-47; unset → inherits the live UI locale ($.i18n.language)
  "prompt": "histology, immunohistochemistry, mitosis, stroma, carcinoma"
}
```

- **`language`** pins the model's language instead of letting it free-detect one
  per utterance (the drift behind e.g. an English clause read as another tongue).
  When unconfigured, the module inherits the live app locale so it follows a UI
  language switch automatically.
- **`prompt`** is Whisper's vocabulary bias (`prompt` / whisper.cpp
  `initial_prompt`, ~224-token soft hint): seed it with the terms/spellings the
  transcript should favour so homophones resolve toward the domain ("histology",
  not "history"). It is length-capped (~1000 chars) and **ignored by the
  in-browser WASM driver** (transformers.js exposes no such decoder option) — the
  remote / vercel (server) drivers apply it. The chat composer supplies a richer
  prompt automatically (see below); this static-meta value is the module-wide
  fallback for other consumers.

## Voice UX config (chat composer)

Under the chat module's `voice` block (all optional):

| Key | Default | Meaning |
|-----|---------|---------|
| `silenceMs` | 1200 | Trailing silence before a turn auto-stops. |
| `silenceThreshold` | 0.04 | Peak-amplitude speech floor (with adaptive noise tracking). |
| `speechFloorMult` | 3.0 | Noise robustness: a peak must exceed `noiseFloor × this` to count as speech. Higher rejects more background noise but risks dropping a very quiet speaker; lower it (e.g. 2.5) if soft speech is being missed. |
| `minSpeechMs` | 200 | Noise robustness: a peak must stay above the speech gate this long before it counts as speech onset — rejects brief blips (clicks, taps, door). |
| `language` | UI locale | BCP-47 hint (remote / multilingual WASM). Unset → inherits the live app locale (`$.i18n.language`) so transcription tracks the UI language instead of free-detecting it. |
| `prompt` | — | Domain/vocabulary biasing text (Whisper `prompt` / whisper.cpp `initial_prompt`) — appended to the built-in translatable pathology glossary and live domain-tool terms so homophones resolve toward the domain ("histology", not "history"). Ignored by the in-browser WASM driver. Length-capped (~1000 chars). |
| `autoSubmit` | false | Manual dictation: fill-and-review vs. send. |
| `minVoicedMs` | 250 | Minimum detected voiced ms a capture/segment needs before it is transcribed at all (see hallucination filtering above). |
| `reArmDelayMs` | 500 | Settle pause between an assistant reply and the next queued submission. |
| `turnSilenceMs` | 2000 | Hands-free only: longer end-of-turn silence that completes a turn. The mic stays hot through each segment's transcription while the user pauses only briefly, so nothing is lost; a pause this long completes the turn. Must exceed `silenceMs`. |
| `idleAutoOffMs` | 300000 | Hands-free only: after this long with no real speech, voice conversation switches itself off (status note shown). A silent, *thinking* user is fine — silence submits nothing and the session just keeps waiting until this generous timer runs out. |
| `maxEmptyRetries` | — | **Deprecated, ignored.** Silence produces no captures anymore, so an "empty streak" cannot occur; superseded by `idleAutoOffMs`. |
| `noValidContentMs` | — | **Deprecated, ignored.** Turns are no longer force-ended on quiet users; superseded by `idleAutoOffMs`. |

The chat composer builds the biasing `prompt` automatically: a translatable
pathology glossary (`chat.voice.transcriptionPrompt`) plus the labels of any
loaded `pathology-foundation` domain tools, rebuilt at each capture. `voice.prompt`
*extends* that base rather than replacing it. Only generic domain vocabulary is
sent — never slide/patient identity, which must not egress to the transcription
endpoint. `voice.language` unset inherits the live UI locale.

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
`capture-warning`. Plus `model-loading` — fired while a driver loads its model
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
  onPartial: ({ appended, text, index }) => {   // each in-order segment as it lands
    feedToModel(appended);                       // incremental, or use `text` (full so far)
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

`localStorage.setItem('xopat-stt-debug','1')` logs VAD decisions (noise floor,
peak, stop reason) to the console; remove the key to disable.

## Security notes

Driver/endpoint/model selection is read only from `getStaticMeta` (ENV, trusted)
— never from `getOption` (§7). Upstream audio goes through `HttpClient`
(`remote`) or a server-side RPC with the key held server-side (`vercel`). The
WASM library is fetched and SHA-256-verified before import; remote CDN loading is
refused in secureMode without a pinned hash. Speech-less audio is never sent to
any driver (no egress of silent room audio), and Whisper's non-speech
hallucinations (`(dramatic music)`, etc.) are filtered out and never submitted.
