# Chat module events

`ChatModule` extends `XOpatModuleSingleton`, which extends `OpenSeadragon.EventSource` — so
events are raised on the module instance and consumed the usual way:

```js
const chat = singletonModule('vercel-ai-chat-sdk');

chat.addHandler('turn-complete', (e) => {
    if (e.outcome.kind !== 'answered') return;
    const reply = e.messages[e.messages.length - 1];
    console.log('assistant said:', reply?.content);
});
```

All events fire for **every** turn regardless of origin — typed in the composer, dictated, or
driven programmatically through the [headless API](README.md#headless-api). The `source` field
distinguishes them.

A throwing handler is caught and logged; it can never break a turn.

---

## `turn-start`

Raised once the user message is on the transcript, before the first model call.

```ts
interface ChatTurnStartPayload {
    sessionId: string | null;
    userText: string;
    source: "user" | "voice" | "api" | string;
}
```

## `turn-complete`

Raised exactly once per started turn, on **every** terminal path — normal answer, user stop,
step-cap exhaustion, transport failure, and session-creation failure.

> Note for maintainers: `_runAssistantLoop`'s internal `finish()` covers only the loop's own
> returns. A throw from `_ensureActiveSession` or the transport unwinds around it, so this
> event is raised from `ChatPanel.sendText`'s `finally` instead. Do not move it into `finish()`.

```ts
interface ChatTurnCompletePayload extends ChatTurnStartPayload {
    outcome: {
        kind: "answered" | "stopped" | "error";
        /** Which exit fired: "final-answer", "stopped-by-user", "timeout", "turn-threw", … */
        reason: string;
        /** Did the user actually get a message out of it? */
        rendered: boolean;
    };
    /** Snapshot of the client transcript at the moment the turn ended. */
    messages: ChatMessage[];
    /** Present only when the turn ended by throwing. */
    error?: unknown;
}
```

## `utterance-appended`

Raised when a user utterance is appended to the transcript **without** running an assistant
turn — i.e. via `appendTranscriptUtterance` or a voice submit while transcript-only mode is on
(`setTranscriptOnlyMode(true)`, used by dictation/reporting flows that own their LLM work).
Real turns never raise it — they raise `turn-start`/`turn-complete`; `messages-changed` fires
for both kinds. Cadence note: transcript-only voice submits per transcribed segment, so during
continuous speech this fires roughly every `voice.transcriptMaxSegmentMs` (default 7 s) plus
transcription latency — not once per silence-delimited turn.

```ts
interface ChatUtteranceAppendedPayload {
    sessionId: string | null;
    text: string;
    source: ChatTurnSource;
    message: ChatMessage;
    /** False when the server-side persist failed and the message is session-local only. */
    persisted: boolean;
}
```

## `messages-changed`

Raised whenever the client transcript moves — including *during* a turn, as script steps and
host feedback land. This is what an observer follows to watch a turn in progress.

```ts
interface ChatMessagesChangedPayload {
    sessionId: string | null;
    messages: ChatMessage[];
    change: "append" | "replace" | "clear";
    /** The appended message; `change === "append"` only. */
    message?: ChatMessage;
}
```

## `session-changed`

```ts
interface ChatSessionChangedPayload {
    sessionId: string | null;
    session: ChatSession | null;
    reason: "created" | "loaded" | "cleared";
}
```

## `busy-changed`

Raised whenever the panel's set of running phases changes — a turn, a session hydration, a model
catalogue fetch, an attachment upload, boot. Every in-panel indicator (the header progress bar,
the status line, the disabled controls) derives from the same registry, so an observer that wants
its own "chat is working" affordance should follow this rather than infer from `turn-start`.

`primary` is the highest-priority running phase, i.e. the one whose text the status line shows.
Both fields are empty/`null` exactly when the panel is idle.

```ts
interface ChatBusyChangedPayload {
    /** Distinct running phases, highest priority first. */
    kinds: ChatBusyKind[];
    primary: ChatBusyKind | null;
}

type ChatBusyKind =
    | "turn" | "session-load" | "session-create" | "login"
    | "attachment" | "models" | "sessions" | "provider" | "boot";
```

## `provider-registration-failed`

Raised when a detached managed provider registration (`registerManagedProvider`) exhausted all
retry attempts. Registration runs in the background — plugins no longer await it in
`pluginReady`, so nothing on the boot path observes the failure; the panel shows a persistent
failure notice with a Retry action (`ChatModule.retryFailedProviderRegistrations()` is the same
entry point, callable headlessly), and this event is the headless observers' counterpart.
Payload: `{ label: string | null, reason: string }` — the human provider name the registering
plugin supplied and a one-line description of the final error.

## `voice-state`

Raised on every voice on/off transition — manual dictation start/stop, hands-free arm/disarm, and
every self-shutoff (inactivity, watchdog, session end, Send-flush) — so an observer can track the
shared capture instead of polling. Payload: `ChatVoiceStatePayload` (`{ listening, auto }`).

## `voice-window`

Raised as rolling transcript windows are assembled from transcribed segments: `{ index, text,
fromSegment, toSegment, final }`. `final: false` windows are provisional and may be superseded.

## `voice-segment`

Raised for every recognized speech segment, **including ones the noise/language gates
rejected** (`accepted: false`) — those never become chat turns, so this is the only place
they are observable. In continuous mode accepted segments are reported **as they are
transcribed** (mid-monologue, before the turn boundary), so observers see live progress.
`mode: "flush"` marks text salvaged from a shutdown path that could not be appended to the
transcript (`accepted: false`, `index: -1`) — spoken evidence that never became a chat
message.

```ts
interface ChatVoiceSegmentPayload {
    text: string;
    /** Turn index within the current continuous capture; `-1` for one-shot dictation. */
    index: number;
    accepted: boolean;
    mode: "once" | "continuous" | "flush";
}
```

## `voice-transcribing`

Raised when transcription of a captured segment begins (`active: true`) and ends
(`active: false`, on success or failure). Reflects **actual in-flight transcription batches**
(the underlying module raises `transcription-started` when its in-flight count leaves 0), not
the capture-session lifetime, and only fires on transitions. Lets an observer show a
"transcribing…" indicator away from the composer (the report-assist panel uses it for its
busy spinner).

```ts
interface ChatVoiceTranscribingPayload {
    active: boolean;
}
```

## `voice-error`

Raised when transcription fails outright — all drivers exhausted, or a permanent
driver-configuration error. In hands-free mode the segment otherwise just resolves empty and
the session continues, so this is the only signal an observer gets that the audio was lost.

```ts
interface ChatVoiceErrorPayload {
    message: string;
    /** True for a driver-configuration error that will keep failing until fixed. */
    permanent: boolean;
    code?: string;
}
```

---

## Payload types

All payload interfaces are declared globally in [`types/shared.d.ts`](types/shared.d.ts) —
no import needed in module/plugin TypeScript.
