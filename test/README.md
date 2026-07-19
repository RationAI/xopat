# Testing with Cypress

The testing framework can be run directly from console using `npx cypress open`. But first,
the testing must be configured, which can be done in many ways:
 - local WSI server and viewer
 - distant WSI server and local viewer
 - both distant WSI server and viewer

The only thing you have to ensure is that the WSI server can access the correct slides required for testing,
and that the slide paths/IDs are provided. Typically, you have to:
 - create **``cypress.env.json``** file in the project root, it defines where and how to access the viewer, see example files in this directory
 - run ``npm install`` if you haven't already, it installs build and test tools
 - run ``npm run test-w`` (alias to ``npx cypress open``) to run the interactive test framework

Configuring the test correctly might be a bit more difficult
than you would expect; therefore we provide almost out-of-box setup for localhost.

## Testing on localhost
First, get the slide data. The suite (including the pixel-diff baseline) uses the
public OpenSlide test slide **CMU-1.tiff**:

- https://openslide.cs.cmu.edu/download/openslide-testdata/Generic-TIFF/CMU-1.tiff (~200 MB)

Place it (as copies or links) wherever your WSI server resolves the ``wsi_*`` IDs
configured in ``cypress.env.json``. The suite actively renders ``wsi_tissue`` (main
background everywhere, also the pixel baseline) and ``wsi_annotation`` (second
background in the activeBackgroundIndex test); ``wsi_probability`` and
``wsi_explainability`` are reserved for future visualization-layer tests. Using a
different slide than CMU-1.tiff works for all state-based tests, but the committed
pixel baseline will not match — run those setups with ``--env skipPixelTests=1``
or record a local baseline.

Next, download a WSI viewer and run it. We recommend using 
[our modification of the Empaia WSI Server](https://github.com/RationAI/WSI-Service). You need
to run the docker compose for the server - in `docker-compose.yml` inside the repository:
 - configure the ENV variables (see e.g. `cypress.env.rationai-mapper.json`)
 - mount the directory where your slides are inside the docker as ``/data``
   - move the downloaded test slides as ``[the-docker-mount-path]/cypress/*.tiff`` 

And then run ``docker compose up``. Move the `cypress.env.rationai-mapper.json` to this repository
root and rename it to `cypress.env.json`.

> Do not forget to remove commens from JSON for cypress env. Cypress does not support
> JSON with comments unlike this viewer.
 

Last but not least, we will use the `node` local viewer server (OpenSeadragon ships
with the repository in ``src/libs/``, no separate download needed).
The viewer must understand the WSI server you are going to use. You can use
``viewer.env.wsi-service.json``, simply run `npm run s-node-test` (server node for tests),
or run against your usual dev setup (`npm run s-node` with ``env/env.json``) — the suite
holds under any ENV, see *Testing across deployment ENVs* below.

The slide keys in ``cypress.env.json`` map to whatever IDs your WSI server resolves
(paths, UUIDs...). The current tests actively render only ``wsi_tissue`` (main
background everywhere) and ``wsi_annotation`` (second background in the
activeBackgroundIndex test); ``wsi_probability`` and ``wsi_explainability`` are
reserved for future visualization-layer tests.

Now you are done and you can start testing (e.g. `npm run test-w` for interactive tests).

### HEADERS object in cypress.env.json
These headers used for cypress access to the viewer domain
(configured in the `interceptDomain` field). This is necessary for the viewer
 server to parse correctly the post data (session).

## Writing tests

Inherited from the cypress default hierarchy, you can
 - find test suites in ``e2e/``
 - find configuration methods (session config generators) and static data in ``fixtures/``
 - find custom command (``cy.launch``, ``cy.canvas``, ``cy.key``, ``cy.draw``) and utility
   definitions (``waitForViewer``) in ``support/``

The best approach is to copy and modify existing tests. Prefer asserting on application
state (``APPLICATION_CONTEXT``, ``VIEWER``) and stable DOM anchors over screenshots;
use ``cy.canvas().matchImage()`` only for a few smoke scenes on the rendered canvas.

## Testing across deployment ENVs

The viewer's behavior depends heavily on the deployment ENV (the ``XOPAT_ENV`` file):
default params (``setup`` block), shipped plugins, slide protocols. The suite is
written to hold under any ENV:

- Tests exercising a param **pin it explicitly** in the session ``params`` — session
  params override ENV defaults, so an ENV cannot flip the tested baseline.
- The *env defaults* test in ``params.cy.js`` derives its expectations from
  ``APPLICATION_CONTEXT.env.setup`` at runtime instead of hard-coding shipped values.
- Pixel-diff tests compare against a baseline recorded under one particular ENV and
  machine; runs against any other ENV skip them via ``--env skipPixelTests=1``. The
  baseline is kept **per browser** (``canvas-smoke-<browser>``): the first run in a
  new browser records it, later runs compare against it — commit the generated
  ``test/e2e/__image_snapshots__/*.png`` for every browser you test with.

There is no "default" ENV — the server always runs with whatever ``XOPAT_ENV`` file it
was started with (``env/env.json`` when the variable is unset). ``npm test`` simply runs
against the server already listening on the ``viewer`` URL from ``cypress.env.json``.
To run the suite against a server with a different ENV file:

    npm run test-env -- <viewer-env-file> [port]      # e.g. test/env/viewer.env.test-custom.json 9001
    npm run test-matrix                                # suite against the running server + the test-custom ENV

``test/run-env.sh`` starts ``node index.js`` with the given ``XOPAT_ENV`` on a side
port (default 9001), waits for it, runs Cypress with ``viewer``/``interceptDomain``
redirected there, and shuts the server down. ``test/env/viewer.env.test-custom.json``
deliberately flips several defaults (hidden scalebar/navigator, top notifications,
disabled nav shortcuts) to prove the suite adapts. The WSI service on :8080 is shared.

## Known limitations
Some deployment options cannot be exercised from the test suite at all — e.g.
`secureMode` is intentionally not overridable from a session (it would be insecure),
so it can only be tested by pointing the suite at a server deployed with it
(``npm run test-env`` with an ENV file setting it). If a test fails unexpectedly,
first check that the target server is actually running with the slides available
(a 30s "Waiting for the viewer" timeout usually means the WSI server could not
resolve the configured slide IDs).
