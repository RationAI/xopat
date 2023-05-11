# Testing with Cypress

The testing framework can be run directly from console using `npx cypress open`. The testing happens on a running viewer
url configured in the `cypress.env.json` file, _not necessarily on the source files in this repository_. As the viewer
can serve data across the internet, the testing framework can test any running viewer instance if you have access.
For now, you need to
 - create **``cypress.env.json``** file in the project root, it defines where and how to access the viewer, an example file is ``cypress.env.example.json``
 - run ``npm install`` if you haven't already, it installs build and test tools
 - run ``npx cypress open`` to run the interactive test framework

## Testing on localhost
First, clone xopat-docker repository and build and _run_ the docker compose system.
> Recommended way of building is to set ``DOCKER_BUILDKIT=0`` env variable to prevent docker from
> messing up the build process. For windows, use `set DOCKER_BUILDKIT=0`.
``cypress.env.json`` file needs the WSI slides to test with. These can be downloaded here:
- tissue.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/tissue.php
- annotation.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/annotation.php
- probability.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/probability.php
- explainability.tiff: https://rationai-vis.ics.muni.cz/visualization-demo/data/explainability.php

Move these files to a xopat-docker repository to the ``data`` folder. Finally, provide path
to these files in the env file (relative to the data folder):

``````json
{
  "interceptDomain": "http://localhost:8080/**",
  "viewer": "http://localhost:8080/xopat/index.php",
  "imageServer": "http://localhost:8080/iipsrv/iipsrv.fcgi",
  "headers": {
  },
  "wsi_tissue": "tissue.tiff",
  "wsi_annotation": "annotation.tiff",
  "wsi_probability": "probability.tiff",
  "wsi_explainability": "explainability.tiff"
}
``````
Note that you are _not_ testing the repository code, but the deployed instance
in the docker.


## Writing tests

Inherited from the cypress default hierarchy, you can
 - find test suites and test routines (general scenarios callable 'anytime' that respect the viz params, usualy UI testing)
 in ``e2e/``
 - find configuration methods and static data in ``fixtures/``
 - find custom command and utility definitions in ``support/``
 
The best approach is to copy and modify existing tests.
