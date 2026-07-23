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

## `voice-segment`

Raised for every recognized speech segment, **including ones the noise/language gates
rejected** (`accepted: false`) — those never become chat turns, so this is the only place
they are observable.

```ts
interface ChatVoiceSegmentPayload {
    text: string;
    /** Turn index within the current continuous capture; `-1` for one-shot dictation. */
    index: number;
    accepted: boolean;
    mode: "once" | "continuous";
}
```

---

## Payload types

All payload interfaces are declared globally in [`types/shared.d.ts`](types/shared.d.ts) —
no import needed in module/plugin TypeScript.
