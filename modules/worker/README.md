# Thread Worker for xOpat

A simple, unified, generic interface for asynchronous offscreen workload. Callbacks are given the same
objects as events. For the API description, see JS docs of ``interface.js``.

### `success` | e: `{status:string, payload: any}`
Fired on success if the worker was not provided with a success callback.

### `failure` | e: `{status:string, payload: any}`
Fired on failure if the worker was not provided with a failure callback.




