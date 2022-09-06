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

## Environment, Build & Test
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


The visualization itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. Automated building and testing is not yet available; you can just use the code as-is.
Later, automated testing and minification will be included.

#### Plugins API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the plugin README to learn what is needed
to fix the issue.


##### For more details, check README_DEV.md
