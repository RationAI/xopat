# Thread Worker for Pathopus

A simple, unified, generic interface for asynchronous offscreen workload. Callbacks are given the same
objects as events.

### `success` | e: `{status:string, payload: any}`
Fired on success if the worker was not provided with a success callback.

### `failure` | e: `{status:string, payload: any}`
Fired on failure if the worker was not provided with a failure callback.




