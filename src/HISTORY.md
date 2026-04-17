## History API

`APPLICATION_CONTEXT.history` is asynchronous and queue-based. All operations are serialized through an internal promise queue, so callers never need to coordinate concurrent undo/redo calls manually.

### Core methods

- `push(forward, backward, meta?)`
    - Executes `forward()` immediately.
    - Records the step **only if** `forward()` succeeds (no exception).
    - Returns a `Promise` that resolves to the return value of `forward()`.

- `pushExecuted(forward, backward, meta?)`
    - Records an already-applied change without executing `forward()`.
    - Returns `Promise<void>`.

- `undo()` / `redo()`
    - Return `Promise<boolean>`.
    - Resolve to `true` when a step was applied, otherwise `false`.
    - Providers are checked **first**; only if none handle it does the internal buffer step fire.

- `clear(options?)`
    - Clears committed stack history.
    - `options.resetProviders` also calls `reset()` on every registered provider.
    - `options.reason` is forwarded inside the `clear` event payload.

- `withoutRecording(fn)`
    - Runs `fn` without recording nested history steps.
    - Nesting is supported (depth-counter based).
    - Returns `Promise<T>`.

- `canUndo()` / `canRedo()`
    - Return `boolean`.
    - Check both registered providers and the internal circular buffer.

- `isBusy()` — returns `true` while any history operation is actively running.
- `pendingCount()` — number of operations currently queued or running.
- `whenIdle()` — `Promise<void>` that resolves when the queue is empty.

### Stack inspection (committed entries only)

- `hasStackUndo()` — `true` if the internal circular buffer has an entry to undo (providers not checked).
- `hasStackRedo()` — `true` if there is a committed redo entry in the buffer.
- `hasAnyStackHistory()` — `true` if either of the above is true.
- `currentUndoMeta()` — returns the `HistoryEntryMeta` of the entry that would be undone next, or `undefined`.
- `currentRedoMeta()` — returns the `HistoryEntryMeta` of the entry that would be redone next, or `undefined`.

### `HistoryEntryMeta`

Optional metadata object stored alongside each history entry.

```ts
interface HistoryEntryMeta {
    /** Human-readable label shown in "Undo {{name}}" / "Redo {{name}}" UI. */
    name?: string;
    /** Machine-readable action identifier, e.g. "annotations.import". */
    type?: string;
    [key: string]: any;
}
```

Always include `name` when calling `push()`/`pushExecuted()` so the app bar can display contextual undo/redo labels.

### History buffer size

```ts
APPLICATION_CONTEXT.history.size = 200; // default is 99
```

Reducing the size does **not** truncate existing entries immediately; new pushes eventually evict old ones.

### Provider API

Providers can intercept undo/redo for transient state (e.g. mid-draw polygon editing) before the committed buffer is consulted.

```ts
class MyProvider extends XOpatHistory.XOpatHistoryProvider {
    get importance() { return 10; } // higher = checked first
    async undo() { /* ... */ return true; }  // return true = handled
    async redo() { /* ... */ return true; }
    canUndo() { return true; }
    canRedo() { return false; }
    async reset() { /* optional – called by clear({resetProviders: true}) */ }
}

const unregister = APPLICATION_CONTEXT.history.registerProvider(new MyProvider());
// Later:
unregister(); // or APPLICATION_CONTEXT.history.unregisterProvider(provider)
```

> Providers are sorted by descending `importance`. The first provider that returns `true` from `undo()`/`redo()` wins; the buffer is not touched.

### History events

All events are fired on `APPLICATION_CONTEXT.history` (an `OpenSeadragon.EventSource`):

| Event | Payload | When |
|---|---|---|
| `push` | `{ meta: HistoryEntryMeta \| undefined }` | After `forward()` succeeds and the entry is committed |
| `undo` | `{ step: HistoryEntryMeta }` (buffer) or `{ provider }` (provider) | After the undo action completes |
| `redo` | `{ step: HistoryEntryMeta }` (buffer) or `{ provider }` (provider) | After the redo action completes |
| `clear` | options object | After the buffer and providers are reset |
| `register-provider` | `{ provider }` | After a provider is registered |
| `unregister-provider` | `{ provider }` | After a provider is unregistered |
| `change-size` | `{ size: number }` | After `size` setter is called |
| `history-busy-change` | `{ busy, queued, running, pending }` | Whenever the queue state changes |
| `error` | `{ action: string, error }` | When any history action throws |