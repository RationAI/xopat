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
First, download the slide data:
- tissue.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/tissue.php
- annotation.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/annotation.php
- probability.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/probability.php
- explainability.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/explainability.php

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
 

Last but not least, we will use the `node` local viewer server. Do not
forget to download and build OpenSeadragon - the default location is
``./openseadragon`` so you can run `git clone <openseadragon url> && cd openseadragon && npm install`
The viewer must understand the WSI server you are going to use. You can use
``viewer.env.wsi-service.json``, simply run `npm run s-node-test` (server node for tests).

Now you are done and you can start testing (e.g. `npm run test-w` for interactive tests).

### HEADERS object in cypress.env.json
These headers used for cypress access to the viewer domain
(configured in the `interceptDomain` field). This is necessary for the viewer
 server to parse correctly the post data (session).

## Writing tests

Inherited from the cypress default hierarchy, you can
 - find test suites and test routines (general scenarios callable 'anytime' that respect the viz params, usualy UI testing)
 in ``e2e/``
 - find configuration methods and static data in ``fixtures/``
 - find custom command and utility definitions in ``support/``
 
The best approach is to copy and modify existing tests.

## Todo
Testing is very dependent on the deployed instance configuration, 
some even cannot be changed by the test suite (e.g., `secureMode` since
it would be insecure to allow changing it). Test are for now quite unstable, please
first check that the test does not fail due to
 - invalid viewer awaiting
 - different / missing static viewer configuration
 - older viewer version
 - another unknown reasons (try to run it twice)
