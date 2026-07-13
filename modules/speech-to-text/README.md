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
  "device": "webgpu",                   // "webgpu" | "wasm" (auto-detects; falls back to wasm)
  "dtype": "q4",                        // quantization for speed
  "multilingual": false,                // true → forward the language hint
  "library": "//cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
  "hash": "<sha256>"                    // required only in secureMode / custom library URL
}
```

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

On silence/noise, Whisper-family models emit caption-like artifacts that would
otherwise be submitted as messages. The built-in `stripNonSpeech` filter removes
the common syntaxes and blanks the transcript (treated as "no speech") when only
an artifact remains:

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

## Voice UX config (chat composer)

Under the chat module's `voice` block (all optional):

| Key | Default | Meaning |
|-----|---------|---------|
| `silenceMs` | 1200 | Trailing silence before a turn auto-stops. |
| `silenceThreshold` | 0.04 | Peak-amplitude speech floor (with adaptive noise tracking). |
| `language` | browser | BCP-47 hint (remote / multilingual WASM). |
| `autoSubmit` | false | Manual dictation: fill-and-review vs. send. |
| `maxEmptyRetries` | 3 | Empty captures before hands-free mode auto-stops. |
| `reArmDelayMs` | 500 | Pause after the assistant replies before listening again. |
| `turnSilenceMs` | 2000 | Hands-free only: longer end-of-turn silence that submits the turn. The mic stays hot through each segment's transcription while the user pauses only briefly, so nothing is lost; a pause this long ends the turn. Must exceed `silenceMs`. |

## Global API

```js
const stt = singletonModule('speech-to-text');
await stt.isAvailable();                         // driver present + mic grantable
const { text } = await stt.transcribeOnce();     // capture one utterance → text
stt.startDictation();                            // { stop(), done }
stt.stop();
stt.listDrivers(); stt.setActiveDriver('vercel');
stt.createMicButton({ onResult }).attachTo(el);  // reusable BaseComponent mic
```

Events (via the module's EventSource): `recording-started` / `recording-stopped`
/ `transcription-started` / `transcription` / `transcription-error`.

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
`h.done` resolves the same value when the session ends for any reason. The chat
composer's hands-free mode is built on this: it accumulates segments during a turn and
submits on `onTurnIdle`, keeping the mic hot through each transcription so long,
multi-sentence prompts with short pauses are captured in full.

## Diagnostics

`localStorage.setItem('xopat-stt-debug','1')` logs VAD decisions (noise floor,
peak, stop reason) to the console; remove the key to disable.

## Security notes

Driver/endpoint/model selection is read only from `getStaticMeta` (ENV, trusted)
— never from `getOption` (§7). Upstream audio goes through `HttpClient`
(`remote`) or a server-side RPC with the key held server-side (`vercel`). The
WASM library is fetched and SHA-256-verified before import; remote CDN loading is
refused in secureMode without a pinned hash. Whisper's non-speech hallucinations
(`(dramatic music)`, etc.) are filtered out and never submitted.
