# Pathopus - OpenSeadragon-based histology data visualizer

A flexible way of visualisation of multiple high resolution images overlaid.

The visualisation is fully flexible. It, in fact, consists of two main logical groups. The first, **image** groups, 
is rendered AS-IS. It is meant for tissue scan to be shown. The second, **data** groups is rendered using our WebGL 
extension. 

## Environment, Build & Test
The visualization is not based on any framework, it is pure JavaScript application that integrates
various libraries. Automated building and testing is not yet available; you can just use the code as-is.
Later, automated testing and minification will be included.

## Setup
There is _docker_ available: https://github.com/RationAI/pathopus-docker. Although very versatile, setting up
the viewer correctly requires web development knowledge. The docker system is standalone ready to use environment.
It also shows how to configure each component so that the system work together - it is a great example on how to configure 
your servers properly.

#### Plugins API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the plugin README to learn what is needed
to fix the issue.


##### For more details, check README_DEV.md
