# HTTP Traffic interception

This module adds capabilities for http traffic
interception.

Usage (see https://github.com/Netflix/pollyjs).

````js
//Intercept XHR traffic only.
const server = new pollyjs.Polly('', {
    adapters: [pollyjs.XHRAdapter],
    persister: pollyjs.NoPersister
}).server;

//.get(), .post(), .any() ...
server.any().on('request', (req, res) => {
    req.headers['X-Auth-Token'] = 'abc123';
});
````

The release is built using ``npm`` and `browserify` over a customized
entrypoint script in the repository root:

> index.js
> ````js
> const pollyjs = require("./packages/@pollyjs/core/dist/cjs/pollyjs-core");
> pollyjs.XHRAdapter = require("./packages/@pollyjs/adapter-xhr/dist/cjs/pollyjs-adapter-xhr");
> pollyjs.FetchAdapter = require("./packages/@pollyjs/adapter-fetch/dist/cjs/pollyjs-adapter-fetch");
> pollyjs.Adapter = require("./packages/@pollyjs/adapter/dist/cjs/pollyjs-adapter");
> pollyjs.Persister = require("./packages/@pollyjs/persister/dist/cjs/pollyjs-persister");
> 
> pollyjs.NoPersister = class extends pollyjs.Persister {
>   static get id() {
>     return 'no-persister';
>   }
>
>   onFindRecording() {}
>
>   onSaveRecording() {}
>
>   onDeleteRecording() {}
> };
>
> window.pollyjs = pollyjs;
> ````


And built using
 ````
 npm install -g browserify
 npm install
 npm run build
 browserify index.js > polly.js
 ````


