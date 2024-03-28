
<h1 align="center">XOpat - Explainable Open Pathology Analysis Tool
</h1>
<p align="center">
  <sup>A web based, NO-API oriented WSI Viewer with enhanced rendering of high resolution images overlaid, fully modular and customizable.</sup>
</p>

![The XOpat Viewer](docs/assets/xopat-banner.png)

### Why xOpat?

Configure the viewer to your needs, not vice versa! Here, you can take a half-ready solution
and bring it to something that covers all your needs. With the focus on flexibility, extensibility and modularity, the xOpat
viewer tries to address issues in digital pathology related to analysis and 
AI development.

### Behaves as an enhanced OpenSeadragon*, a popular (feature-less) flexible viewer.
<ul>
:floppy_disk: Full data protocol flexibility. Access any server.<br>
:bar_chart: Powerful visualization capabilities, similar to Photoshop layers.<br>
:gear: Configurability: static & runtime.<br>
:package: Annotations, and other plugins introduce an unusual set of additional features
     that take the WSI far beyond standard.
</ul>

### Powerful set of modules and plugins: Advanced extensibility & Existing features
<ul>
:key: OIDC Authentication<br>
:book: Visualization Storytelling<br>
:memo: Versatile annotations and supported annotation formats.<br>
:bulb: Flexible tutorial system: send viewer session with custom tutorials!<br>
:bookmark_tabs: EMPAIA Integration<br>
:keyboard: Screenshot or viewport copy/paste shortcuts<br>
...<br>
:fast_forward: And more including anything you add!<br>
</ul>

### Servers
To parse existing modules, plugins, read POST data the viewer uses a server. Don't worry,
we try to cover it all!
<ul>
:heavy_check_mark: PHP Server<br>
:heavy_check_mark: Node.js Server<br>
:heavy_check_mark: Server-less: compiled once, used statically!<br>
</ul>


Note that the viewer is still in active development. If you wish to start
using the viewer, please do not hesitate to reach us. Currently, it is used for versatile
offline AI data inspection. We work now on integration workflows and in future
the focus will be on services, namely non-standard integration with an ML pipeline for
effective algorithm/network debugging and profiling with the help of powerful visualization platform.


## Setup
There is _docker_ available: https://github.com/RationAI/xopat-docker. Although very versatile, setting up
the viewer correctly requires web development knowledge. The docker system is standalone ready to use environment.
Each Dockerfile also shows how to configure a component so that the system (the viewer, browser and image server) work together - it is a great example on how to configure 
your servers properly.

## Environment, Build & Test

The visualization itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application. 
However, testing and documentation uses ``npm``, `grunt` and `cypress`.

> The build and test framework is still in development - for now, the viewer can be used AS-IS just add the OSD library and run from a PHP server.

To minify (build) the viewer, you can run

> grunt all

and for plugins only

> grunt plugins

or modules only

> grunt modules

This will create ``index.min.js`` files in respective directories. The viewer core recognizes
existence of these files and loads them instead of all the source scripts.

For more details on components, see README files in respective directories.
For details on integration, see ``INTEGRATION.md``.
For documentation, you can run ``npm install && grunt docs && grunt connect watch``
and open ``localhost:9000/``
