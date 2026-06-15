# Events in RecorderModule

Recordings are **per viewer**: each viewer owns a collection of named recordings
with one active recording. Step/playback events therefore carry the owning
`viewerId` and `recordingId` so listeners can scope UI to the recording on
display (multiple viewers can play in parallel).

### `play` | e: `{viewerId: string, recordingId: string}`
Fired before a viewer's active recording starts playing. With parallel
multi-viewport playback this fires once per playing viewer.

### `stop` | e: `{viewerId: string, recordingId: string | null}`
Fired after a viewer's recording stops playing (once per viewer).

### `enter` | e: `{viewerId: string, recordingId: string, index: number, prevIndex?: number, prevStep?: object, step: object}`
Fired before each step, immediately before the animation happens.

### `create` | e: `{viewerId: string, recordingId: string, index: number, step: object}`
Fired after a step object is created. The object contains all snapshot step data.

### `remove` | e: `{viewerId: string, recordingId: string, index: number, step: object}`
Fired after a step object is removed. The object contains all snapshot step data.

### `update` | e: `{viewerId: string, recordingId: string, index: number, step: object}`
Fired after a step is mutated in place (forward and on undo).

## Recording lifecycle

### `recording-create` | e: `{viewerId: string, recordingId: string, recording: object}`
Fired after a new recording is added to a viewer's collection.

### `recording-delete` | e: `{viewerId: string, recordingId: string}`
Fired after a recording is removed.

### `recording-rename` | e: `{viewerId: string, recordingId: string, name: string}`
Fired after a recording is renamed.

### `recording-active` | e: `{viewerId: string, recordingId: string | null}`
Fired when the active recording for a viewer changes (switch, create, delete,
or after a bundle import rehydrates the collection).
