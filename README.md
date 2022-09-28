# Pathopus - OpenSeadragon-based histology data visualizer

A flexible way of visualisation of multiple high resolution images overlaid.

The visualisation is fully flexible. It, in fact, consists of two main logical groups. The first, **image** groups, 
is rendered AS-IS. It is meant for tissue scan to be shown. The second, **data** groups is rendered using our WebGL 
extension. 

## Setup
There is _docker_ available: https://github.com/RationAI/pathopus-docker. Although very versatile, setting up
the viewer correctly requires web development knowledge. The docker system is standalone ready to use environment.
Each Dockerfile also shows how to configure a component so that the system (the viewer, browser and image server) work together - it is a great example on how to configure 
your servers properly.

#### Manual

The viewer builds on OpenSeadragon - a _proxy_ repository can be found here: https://github.com/RationAI/openseadragon.git.
You can use the original repository - here you just have the compatibility confidence.

In order to install the library you have to clone it and generate the source code:

> ``cd pathopus && git clone https://github.com/RationAI/openseadragon.git``
>
> building requires grunt and npm
>
> ``cd openseadragon && npm install && grunt build``
>
> you should see `build/` folder. For more info on building see [the guide](https://github.com/RationAI/openseadragon/blob/master/CONTRIBUTING.md).

Optionally, you can get the OpenSeadragon code from somewhere (**compatiblity not guartanteed**) and playce it under
a custom folder - just update the ``config.php`` path to the library. 

## Environment, Build & Test

The visualization itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application. However, testing and building uses ``npm``, `grunt` and `cypress`.

> The build and test framework is still in development - for now, the viewer can be used AS-IS just add the OSD library and run from a PHP server.

It defines where and how to access the viewer. The testing framework can be run directly from console using `npx cypress open`.
This naturally involves 
For now, you need to
 - create **``cypress.env.json``** file in the project root, it defines where and how to access the viewer, an example file is ``cypress.env.example.json``
 - run ``npm install`` if you haven't already, it installs build and test tools
 - run ``npx cypress open`` to run the interactive test framework


#### Plugins API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the plugin README to learn what is needed
to fix the issue.


##### For more details, check README_DEV.md
