# Events in Snapshots

### `play` | e: undefined
Fired before a sequence starts playing.

### `stop` | e: undefined
Fired after a sequence that has been playing stops.

### `before-enter` | e: undefined
Fired before each sequence, including the waiting time.

### `enter` | e: undefined
Fired before each sequence, immediately before the animation happens.

### `create` | e: `{index: number, step: object}`
Fired after a step object is created. The object contains all snapshot step data.

### `remove` | e: `{index: number, step: object}`
Fired after a step object is removed. The object contains all snapshot step data.

