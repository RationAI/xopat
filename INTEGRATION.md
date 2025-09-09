# xOpat Integration Within Your System

The docker image pretty much shows all basics necessary to set up the viewer.
Here we discuss further possibilities and corner cases.


## Cloning & Building

The viewer can be used AS-IS. Its configuration can be done through ``env/env.json`` file. Certain
things must be set up correctly (depends on the server the viewer runs on). The viewer (as well as OpenSeadragon)
use ``grunt`` command line tool. It can be installed as `npm install -g grunt-cli`.

To build the configuration file example, run

> ``npm install && grunt env``

##### OpenSeadragon

The viewer builds on OpenSeadragon - a _proxy_ repository can be found here: https://github.com/RationAI/openseadragon.git.
You can use the original repository - here you just have guaranteed compatibility.

In order to install the library you have to clone it and generate the source code:

> ``cd xopat && git clone https://github.com/RationAI/openseadragon.git``
>
> building requires grunt and npm
>
> ``cd openseadragon && npm install && grunt build``
>
> you should see `build/` folder. For more info on building see [the guide](https://github.com/RationAI/openseadragon/blob/master/CONTRIBUTING.md).

Optionally, you can get the OpenSeadragon code from somewhere (**v 4.1.0+**) and place it under
a custom folder - just update the path to the library.



## Plugins&Modules API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the generated ENV example files. There might be
configurations you need to adjust.


## Setting up the viewer: client server
After you succesfully set up correct conbfiguration values (see `env/README.md`),
the viewer is now running and listening for requests with JSON configurations
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

#### CORS policy violation with foreign servers
In case you fetch data from servers that are not hosted on the same
server as the viewer, you need to overcome this issue. You can try
to set up correct header values for both client and server to mutually
accept each other. The most stable and versatile solution that requires
only client-side server modification is to set-up a reverse proxy to 
trick browsers into thinking they access local server.

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
<VirtualHost *:443>
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
Based on your image server abilities the integration of xOpat can happen
in several ways. xOpat protmotes synchronous tile fetching, i.e.
server sends all tiles for given position (level / x / y) at once.

We provide a IIPImage modification able to serve images synchronously.
Setting up an image server is out of scope of this document, still, there
are requirements and gotchas you can do on the viewer to adjust for image
server needs.

### Asynchronous Protocols as Fallback
Most image servers support only single tile fetching per request. To enable easy integration
with such servers, you can configure the viewer for asynchronous fetching. This is an ENV file 
example for ``DeepZoom`` protocol configuration:
````json
{
  "core": {
    "active_client": "prod",
    "client": {
      "prod": {
        "image_group_server": "https://my.custom.viewer.url",
        "data_group_server": "https://my.custom.viewer.url",
        "data_group_protocol": "`${path}?Deepzoom=${data}.dzi`"
      }
    },
    "setup": {
      "fetchAsync": true
    }
  }
}
````
This will simply adjust existing protocol in the system to work with for multi-tile
requests. Note that the image metadata is not checked for consistency by default, the
data you are viewing should have compatible metadata. Manual consistency checking can be
implemented for the desired protocol, please follow the log directions in browser console.
>Note: auto multiplexing works only for protocols that send response data as ``Image`` objects.

### Custom Authentication
For authentication through headers, please set-up headers in the viewer configuration (
either parameters or ENV file - run `grunt build` to create example ENV file).

For other authentication methods, please adjust existing protocol or use a custom one - see below.

### Custom Image Protocols
You do not have to use our protocol and image server, 
use any other protocol that can either handle tile fetching transfer through ``Images``
or even (better option but harder to implement) handle image arrays and correctly parse its metadata.
See the [documentation of OpenSeadragon](https://openseadragon.github.io/examples/tilesource-custom/) on how to add new, custom protocols.
It is also possible to add script that injects code to and modifies existing tile sources.

> Note that instead of inline configuration, you have to create a new protocol class and register it
so that auto-detection routine recognizes the protocol (`supports()` returns `true`); and modify
the default protocols (through parameters or ENV) to conform to the protocol configuration phase. 

A great example on implementing the protocol interface are existing implementations in the OpenSeadragon library.
Also, for multi-tile fethching see ``src/external/dziexttilesource.js`` Extended DZI protocol implementation.

> The internal renderer can natively work with concatenated image or image arrays.
> Missing images must be present as black tiles - either in array or concatenated at the right position.
> The tile position is given by the URL position. This data is given to the protocol constructor
>  (see ``data_group_protocol``), which is used to fetch image metadata and this metadata is sent to
> the ``TileSource::configure()`` function, where you can parse the URL or metadata to build your own tile
> urls. Just remember to keep the order of URLs given as ``data`` param to ``data_group_protocol``.

### Extending TiledImage

TiledImage can be extended to add custom functionality. The api supports:

````js
/**
 * Set required image lossless format for transfer.
 * @param {Boolean} value
 */    
requireLossless(value) {
    
}

/**
 * Slide Metadata
 * @typedef {Object} SlideMetadata
 * @property {string} [error=undefined] - error, if present, the slide is treated as errorenous with the cause taken as the value
 * @property {number} [microns=undefined] - The microns in average.
 * @property {number} [micronsX=undefined] - The pixel size in X direction, can be used instead of microns.
 * @property {number} [micronsY=undefined] - The pixel size in Y direction, can be used instead of microns.
 */

/**
 * Retrieve slide metadata. Can be arbitrary key-value list, even nested.
 * Some properties, hovewer, have a special meagning. These are documented in the 
 * return function.
 * @return {SlideMetadata|undefined}
 */
getMetadata() {
    return undefined;
}

TODO... also probably attach them to the prorotype to trigger docs or at least force the docs by using @function and @memberof
````

# FIXME update docs
 
### Custom Synchronous And Asynchronous Protocols
We prefer for the visualization data to come in synchronous requests due to scalability.
It is a fact that most image servers do not support queries for multiple images at once;
therefore it is possible to create custom protocols that implement desired approach.
The best example is the ``ExtendedDZI`` protocol implementation that supports
both synchronous and asynchronous transfer, which you can relate to when implementing the below.

Request/response posibilities of OpenSeadragon are documented in the library itself.
Note that you can add your custom headers, use both GET and POST and even implement
your custom data fetching and presentation logics.

Step by step for synchronous transfer implementation
1. First, you need to configure the viewer so that it uses your protocol - 
in the viewer configuration JSON, set up ``data_group_protocol`` to your protocol. 
It is an one-liner expression evaluated at startup. This can be done in several ways using different data:
    1. `string` - treated as an URL, issues the initial request for the data. It should return data that your desired protocol understands.
       Example:
        >    "data_group_protocol": \`${path}?Deepzoom=${data[0]}.dzi\`
    2. `object` - treated as custom configuration, it is up to the implementation to decide how to fetch metadata
        and individual tiles. The advantage is that this request does not fire URL immediatelly, but it is under your control. 
        Object properties are arbitrary. Example:
        >    "data_group_protocol": \`{"type": "myCustomProtocol", "data": "${data[0]}"}`
2. If you are using one of existing protocols, you are done. Otherwise, you need to provide interaction logics.
2. To provide interaction logics, implement a ``TileSource`` interface and attach it to the `OpenSeadragon` namespace.
    - ``supports()`` - make sure when the response of `data_group_protocol` - dependent request
    - ``configure()`` - make sure the response data, given url and post-data present in the url after `#` sign (if applicable)
   is correctly parsed to provide the ``TileSource`` with necessary metadata. All the metadata required
   is present in the ``TileSource`` class, in short you need to read the `tileSize`, `maxLevel`, `witdh`, `height` of the data,
   which you have to decide for yourself how to aggregate (e.g. ``maxLevel = min(maxLevel1, ...)``).
   - **API Extension** ``getMetadata()`` - implement method to access image metadata for each image source in the array independently - 
   this methods can be omitted, but if present the viewer adjusts layer UI with error warning on all layers that use the data for which
   the metadata contains ``error`` key (with a message).
3. Implement a ``TileSource`` interface that uses the metadata available from stage 2 to fetch multiple tiles.
Build a request, send query and read all image tiles from the server response. See  [Advanced Data API model documentation](https://openseadragon.github.io/examples/advanced-data-model/).  
   - You must respect the tile order and provide
a black tile in case some tile is missing. Tiles must have the same ``tileSize``. 
   - You do not have to care about cache-related API of ``TileSource``, this is handled by the rendering routine. But:
   - The renderer can work by default with vertically-concatenated tiles in a single image or image arrays.  If you finish job with different data type, custom rendering methods can be added to the WebGL data loader - see the module docs.

<details>
<summary>Exemplary Implementation</summary>
Note this approach does not explicitly verify the image array meta compatibility. `this` refers
to the tile source instance, as if we called this in some method that injects the 

````js
OpenSeadragon.MyCustomTileSource = class extends OpenSeadragon.TileSource {

    constructor(options) {
        super(options);
        // Example support for authentication within tileSource
        // FIXME: make this tile-source-wide support no matter the implementation
        if (this.ajaxHeaders && this.ajaxHeaders["Authorization"]) {
            const user = XOpatUser.instance();
            user.addHandler('login', e => this.ajaxHeaders["Authorization"] = null);
            user.addHandler('secret-updated', e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = e.secret));
            user.addHandler('secret-removed', e => e.type === "jwt" && (this.ajaxHeaders["Authorization"] = null));
            user.addHandler('logout', e => this.ajaxHeaders["Authorization"] = null);
        }
    }


    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @param {(Object|Array<Object>)} data
     * @param {String} url
     */
    supports( data, url ) {
        if (data.data && data.type && data.type === "myCustomProtocol") {
            data.ajaxHeaders = data.ajaxHeaders || {};
            const user = XOpatUser.instance();
            const secret = user.getSecret();
            if (secret) {
                data.ajaxHeaders["Authorization"] = user.getSecret();
            }
            return true;
        }
        return false;
    }

    /**
     * Configure is called once we agree to handle certain data. Since we have not used a string,
     * it is simply given the object we created. Pass it further, we will fetch the info ourselves.
     * @param {(Object|XMLDocument)} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure( data, url, postData ) {
        if (data.type === "myCustomProtocol" && data.url) {
            // data.url is set, which will trigger getImageInfo() and call configure second time with real data
            return data;
        }
        throw new Error("Invalid configuration: supports should've returned false!");
    }

    /**
     * Not needed to define if we use string to initialize a tile source. But here, we have a custom 
     * object and thus need to somehow define logics of how to handle the data.
     * @param url
     */
    getImageInfo(url) {
        fetch(url, {
            headers: this.ajaxHeaders || {}
        }).then(async res => {
            const text = await res.text();
            const json = JSON.parse(text);
            if (res.status !== 200) {
                throw new HTTPError("Empaia standalone failed to fetch image info!", json, res.error);
            }
            return json;
        }).then(imageInfo => {
            const data = this.configure(imageInfo, url, null);
            // necessary TileSource props that wont get set manually
            data.dimensions  = new OpenSeadragon.Point( data.width, data.height );
            data.aspectRatio = data.width / data.height;
            data.ready = true;
            OpenSeadragon.extend(this, data);
            this.raiseEvent('ready', {tileSource: this});
        }).catch(e => {
            this.raiseEvent( 'open-failed', {
                message: e,
                source: url,
                postData: null
            });
        });
    }

    getMetadata() {
        return this.metadata;
    }

    /**
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @return {string}
     */
    getTileUrl( level, x, y ) {
        // todo: define your way of getting a tile url. example:
        return `localhost:8080/${level}/${x}_${y}.png`;
    }
};
````

</details>

### Implemented, Out-of-box working Image Data Providers
As discussed, the _data group_ is fetched as a single image array request
for each tile in the visualization, no matter how many data items are rendered. Our IIPServer modification supports Extended Deep Zoom protocol described below.
The image server can be found at https://github.com/RationAI/iipsrv.

#### Extended DZI - the request
We modified DZI protocol to support this feature - the client
side implementation is available in ``src/external/dziexttilesource``.

The protocol works pretty much as DZI, the only exceptions in the configuration (GET/POST) phase are
 - the GET/POST parameter name is ``DeepZoomExt``
   - this arguments accepts a comma-separated list of file paths
   - i.e. ``DeepZoomExt=[file list].dzi``

> All files are required to share *ASPECT RATIO* and *TILE SIZE*, the viewer detects incompatible metadata.
 
The actual data is requested as **POST** request to the server (as before) with
 `DeepZoomExt=comma.tif,separated.tif,file.tif,list.tif_files/0/1_2.png`
The pattern is therefore:
`DeepZoomExt=[file list]_files/[level]/[x]_[y].[format]`. 

#### Extended DZI - the response
The configuration response should
- have root element is expected to be ``<ImageArray>`` tag
    - ``rationai.fi.muni.cz/deepzoom/images`` as its `xmlns` property or `namespaceURI`
- the children nodes are individual Image nodes as in DZI
    - we expect ``Format`` presence - `jpg`, `png` or `zip`
- optionally, root element can be ``<Error>`` with `<Message>` child
- for all missing files in the request
  - the image node should have width and height set to 0 (or negative)
  - if all images are missing, no subsequent requests are sent

Expected response from the server is a vertically-concatenated
tiles image in the requested order; or a zip file (based on `format`). 
Missing tiles should be replaced with a black (zero) image (with required bandwidth)
or an empty entry in case of zip files.
The concatenated image must have the same bandwidth as the highest bands count
across all tiles.

The protocol does not assume server ability to derive inconsistent levels, 
it is programmed so that the deepest _common_ level is fetched only.


### Custom Data Pipeline
In order to be able to render custom data types you must define how the data is 
[stored within the system](https://openseadragon.github.io/examples/advanced-data-model/)
as well as how to load it to the GPU, unless you call ``finish`` with either vertically concatenated image or an image array.
Note that canvas objects are accepted too.

#### Custom Data GPU Loading (WebGL)
The WebGL module responsible for interactive visualizations supports
different contexts for different versions of WebGL. In order to
support all versions, you have to correctly define how your data
is loaded as a texture to the GPU.

This is done by implementing target _convertors_ or ensuring the viewer has support for
your data type. FIXME: allow custom types in the drawer, support custom data for textures.

Doing so will enable you to use ANY (raster) data in the viewer, e.g.,
reading from a zip file.

> Support for vector data is on the TODO list. You can use the annotations module or fabric.js module to
> add vector data atop the canvas for now.

##### For other viewer-related API details, check src/README.md
