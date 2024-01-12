# HTTP Traffic interception

This module adds capabilities for low-level http traffic
interception.

### What this library doesn't do
- Does not provide any request matching logic;
- Does not decide how to handle requests.

Usage (see https://github.com/mswjs/interceptors).

````js
import { BatchInterceptor } from '@mswjs/interceptors'
import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest'
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest'

const interceptor = new BatchInterceptor({
    name: 'my-interceptor',
    interceptors: [
        new ClientRequestInterceptor(),
        new XMLHttpRequestInterceptor(),
    ],
})

interceptor.apply()

// This "request" listener will be called on both
// "http.ClientRequest" and "XMLHttpRequest" being dispatched.
interceptor.on('request', listener)
````

The release is built using ``pnpm``
 ````
 npm install -g pnpm browserify
 npm install
 npm run build
 browserify lib/browser/index.js > intercept.js
 ````


