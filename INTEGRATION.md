# xOpat Integration Within Your System

The docker image pretty much shows all basics necessary to set up the viewer.
Here we discuss further possibilities and corner cases.


## Cloning & Building

The viewer builds on OpenSeadragon - a _proxy_ repository can be found here: https://github.com/RationAI/openseadragon.git.
You can use the original repository - here you just have the compatibility confidence.

In order to install the library you have to clone it and generate the source code:

> ``cd xopat && git clone https://github.com/RationAI/openseadragon.git``
>
> building requires grunt and npm
>
> ``cd openseadragon && npm install && grunt build``
>
> you should see `build/` folder. For more info on building see [the guide](https://github.com/RationAI/openseadragon/blob/master/CONTRIBUTING.md).

Optionally, you can get the OpenSeadragon code from somewhere (**compatiblity not guartanteed**) and playce it under
a custom folder - just update the ``config.php`` path to the library.



## Plugins API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the plugin README to learn what is needed
to fix the issue.


## Setting up the viewer: client server
xOpat runs on PHP, a PHP server is needed to run it. The setup is pretty
standard and many options (WampServer, Apache, ngnix...) are available.

The viewer uses ``config.php`` to configure and customize its behaviour:
````php
//path to the viewer CORE code
define('PROJECT_ROOT', '');
//path to the viewer CORE code
define('PROJECT_SOURCES', PROJECT_ROOT . 'src/');
//path to the viewer MODULES code
define('MODULES_FOLDER', PROJECT_ROOT . 'modules/');
//path to the viewer PLUGINS code
define('PLUGINS_FOLDER', PROJECT_ROOT . 'plugins/');

//plugins and modules can be removed and added at will,
//the only requirement is an existence of `include.json`
//file within. See README files for each. 

//url path-part to the viewer (without domain), i.e. to the main index.php file
define('VISUALISATION_ROOT', dirname($_SERVER['SCRIPT_NAME'])); 
//path to external sources
define('EXTERNAL_SOURCES', PROJECT_SOURCES . 'external/');
//path to assets
define('ASSETS_ROOT', PROJECT_SOURCES . 'assets/');
//path to CORE locales
define('LOCALES_ROOT', PROJECT_SOURCES . 'locales/');

//path to OpenSeadragon build
define('OPENSEADRAGON_BUILD', './openseadragon/build/openseadragon/openseadragon.js');

// use http:// OR https://
define('PROTOCOL', "https://");
// define the server host name including scheme (protocol)
define('SERVER', PROTOCOL . $_SERVER['HTTP_HOST']);
//auto domain: ($_SERVER['HTTP_HOST'] != 'localhost') ? $_SERVER['HTTP_HOST'] : false
    
//define cookies behaviour 
define('JS_COOKIE_EXPIRE', 365); //days
define('JS_COOKIE_PATH', "/");
define('JS_COOKIE_SAME_SITE', "None");
define('JS_COOKIE_SECURE', "false");

/* 
 * DEFAULT IMAGE SERVER DEFINITION: 
 * NOTE: THESE SERVERS CAN BE OVERRIDEN VIA CONFIGURATION 
 */

//define background server endpoint
//a server that can handle regular images
define('BG_TILE_SERVER', "https://some.url/iipsrv.fcgi"); 

//define data server endpoint
//a server that can handle image arrays, can be the same server but does not have to
define('LAYERS_TILE_SERVER', "https://some.other.url/iipsrv.fcgi"); 


//the whole URL to the viewer
define('VISUALISATION_ROOT_ABS_PATH', SERVER . VISUALISATION_ROOT);
//the whole URL to assets
define('EXTERNAL_SOURCES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . EXTERNAL_SOURCES);
//the whole URL to modules
define('MODULES_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . MODULES_FOLDER);
//the whole URL to plugins
define('PLUGINS_ABS_PATH', VISUALISATION_ROOT_ABS_PATH . "/" . PLUGINS_FOLDER);

/**
 * Version is attached to javascript
 * sources so that an update is enforced
 * with change
 */
define('VERSION', "1.0.1");

/**
 * Default protocol = DZI
 * one-liner javascript expression with two available variables:
 *  - path: server URL
 *  - data: requested images ids/paths (comma-separated if multiple)
 *  - do not use " symbol as this is used to convert the value to string (or escape, e.g. \\")
 *
 * preview is an url creator for whole image preview fetching
 */
define('BG_DEFAULT_PROTOCOL', '`${path}?Deepzoom=\${data}.dzi`');
define('BG_DEFAULT_PROTOCOL_PREVIEW', '`${path}?Deepzoom=\${data}_files/0/0_0.jpg`');
define('LAYERS_DEFAULT_PROTOCOL', '`${path}#DeepZoomExt=\${data.join(",")}.dzi`');

/**
 * Headers used to fetch data from image servers
 */
define('COMMON_HEADERS', array());

/**
 * Path/URL to a context page
 * (where user should be offered to go in case of failure)
 */
define('GATEWAY', '../index.php');
````

The viewer is now running and listening for requests with JSON configurations
(details in `src/README.md`). There is a small issue: although the viewer can
request images from any server (the php configuration only sets up defaults),
the browser might not _accept_ responses from such servers (see CORS policy).
This issue does not occur if the image server is hosted on the same server as 
the viewer.

#### HTTPS Urls
To access images from servers using HTTPS, your server needs to have SSL enabled.
This might be natural on production servers, but localhost playgrounds such as
WampServer needs to set up things explicitly (self-signed certificate etc).
There are plenty of examples on the internet.

#### CORS policy violation
To solve this issue, your viewer server needs to set up a reverse proxy.
Setting up a reverse proxy to HTTP target is easier, the example for Apache
sets up `/iipsrv.fcgi` URL as a proxy to a distant image server to avoid CORS
violation (config php file will use `/iipsrv.fcgi` image server URL(s)):

````apacheconf
<VirtualHost *:8080>
    ServerName localhost
    ProxyPreserveHost On

    # Reverse Proxy To Deal With CORS
    #Server image is build under name 'server', mapping host to docker ports 9000 -> 9000
    #Here, under the same docker composite, we are within docker -> use [name]:[port] to access
    ProxyPass /iipsrv.fcgi http://server.url
    ProxyPassReverse /iipsrv.fcgi http://server.url
</VirtualHost>
````
For HTTPS:
````apacheconf
<VirtualHost>
    #Hints: for HTTPS external server, you probably need to avoid CORS policy violation using reverse proxy
    #as well SSL set up:
    #enable apache proxy_module, proxy_http_module
    #set up your cerificate, key and update httpd-ssl.conf
    #set upt the proxy:

    SSLEngine On
    SSLProxyEngine On
    ProxyRequests Off
    SSLProxyVerify none
    SSLProxyCheckPeerCN off
    SSLProxyCheckPeerName off
    SSLProxyCheckPeerExpire off

    ProxyPass /iipsrv.fcgi https://server.url
    ProxyPassReverse /iipsrv.fcgi https://server.url
</VirtualHost>
````

## The Image Server
We provide a IIPImage modification able to serve images as we need them.
Setting up an image server is out of scope of this document, still, there
are requirements and gotchas you can do on the viewer to adjust for image
server needs.

### (Data) Image Server Requirements
The _data group_ is fetched as one request per visualization.
That means an array of tiles is fetched from multiple files at once.

#### Extended DZI - the request
We modified DZI protocol to support this feature - the client
side implementation is available in ``src/external/dziexttilesource``.

The protocol works pretty much as DZI, the only exceptions in the configuration (GET/POST) phase are
 - the GET/POST parameter name is ``DeepZoomExt``
   - this arguments accepts a comma-separated list of file paths
   - i.e. ``DeepZoomExt=[file list].dzi``

> All files are assumed to have the same *ASPECT RATIO* and *TILE SIZE*
 
The actual data is requested as **POST** request to the server (as before) with
 `DeepZoomExt=comma.tif,separated.tif,file.tif,list.tif_files/0/1_2.png`
The pattern is therefore:
`DeepZoomExt=[file list]_files/[level]/[x]_[y].[format]`. 

#### Extended DZI - the response
The configuration response should
- have root element is expected to be ``<ImageArray>`` tag
    - ``rationai.fi.muni.cz/deepzoom/images`` as its `xmlns` property or `namespaceURI`
- the children nodes are individual Image nodes as in DZI
    - we expect ``Format`` presence - e.g. `jpg` or `png`
        - see ``OpenSeadragon.imageFormatSupported()`` for supported list
- optionally, root element can be ``<Error>`` with `<Message>` child
- for all missing files in the request
  - the image node should have width and height set to 0 (or negative)
  - if all images are missing, no subsequent requests are sent

Expected response from the server is a vertically-concatenated
tiles image in the requested order. 
Missing tiles should be replaced with a black (zero) image (with required bandwidth).
The concatenated image must have the same bandwidth as the highest bands count
across all tiles.

The protocol does not assume server ability to derive inconsistent levels, 
it is programmed so that the deepest _common_ level is fetched only.

In future, we will add support for ZIP instead of concatenation which
could significantly help with performance.


### Custom Image Protocols
You do not have to use our protocol, use any other protocol that can handle image arrays
and correctly parse its metadata.
See the [documentation of OpenSeadragon](https://openseadragon.github.io/examples/tilesource-custom/) on how to add new, custom protocols.
Note that you would like to, instead of inline configuration, create a new protocol class and register it
so that auto-detection routine recognizes the protocol (``configure() returns true``); and modify
the ``config.php`` default protocols to conform to the protocol configuration phase.

An example is already existing Extended Dzi implementation.

> Such protocol MUST still return the actual data concatenated vertically
> with missing images as black tiles - except you define your own custom data pipeline.

### Custom Data Pipeline
You actually do not have to even return the data in vertical image as said above. But,
in order to be able to do that you must define how the data is 
[stored within the system -- todo link to the new data API OSD docs after release](https://github.com/openseadragon/openseadragon/pull/2148)
as well as how to load it to the GPU.

#### Custom Data GPU Loading (WebGL)
The WebGL module responsible for interactive visualizations supports
different contexts for different versions of WebGL. In order to
support all versions, you have to correctly define how your data
is loaded as a texture to the GPU.
The process happens as follows:
 - define what data is getting fetched inside your child protocol by overriding ``OpenSeadragon.TileSrouce::downloadTileStart``
   - ``finish()`` method of the options is given the data
   - you should override this method to return custom data instead of trying to try to load it as an image object
   - you do not have to override any other cache (or rendering) -related methods in this function, everything else is taken care of
     - **only when used for ``data`` group, otherwise see below**
 - this data is being propagated automatically all the way to the WebGL module
   - note that this is not true for ``background`` group and you should define also how cache works in that case
 - the module uses ``dataLoader.js`` to load textures to the GPU - you should re-define necessary methods (see the file itself)
   - you get the same data as ``data`` object within `toCanvas(...)` method
   - for WebGL 1.0, `i`th texture is loaded as `TEXTURE_i` - up to max texture units of the given machine
   - for WebGL 2.0, `i`th texture is loaded as `2D_TEXTURE_ARRAY` `i`th element, sampled as texture 3D with `z` coordinate = `i`
   - you can load the texture any way you like, ignoring the above, but you should make sure that ``sampleChannel(index, ...)`` samples `index=i`th texture
   - all sampling overflows should be wrapped, e.g. overflow of texture coordinates behaves as
     - ``TEXTURE_WRAP_S``
     - ``TEXTURE_WRAP_T``

Doing so will enable you to use ANY (raster) data in the viewer, e.g.,
reading from a zip file.

> Support for vector data is on the TODO list.

##### For other viewer-related details, check README_DEV.md
