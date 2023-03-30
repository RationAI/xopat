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


### Custom Synchronous And Asynchronous Protocols
We prefer for the visualisation data to come in synchronous requests due to scalability.
It is a fact that most image servers do not support queries for multiple images at once;
therefore it is possible to create custom protocols that implement desired approach.
The best example is the ``ExtendedDZI`` protocol implementation that supports
both synchronous and asynchronous transfer, which you can relate to when implementing the below.

Request/response posibilities of OpenSeadragon are documented in the library itself.
Note that you can add your custom headers, use both GET and POST and even implement
your custom data fetching and presentation logics.

Step by step for synchronous transfer implementation
1. First, you need to configure the viewer so that it uses your protocol:
    > "data_group_protocol": \`${path}?Deepzoom=${data[0]}.dzi\`
2. Then, implement a ``TileSource`` interface to correctly work with the image array metadata
    - ``supports()`` - make sure when the response of `data_group_protocol` - dependent request
    - ``configure()`` - make sure the response data, given url and post-data present in the url after `#` sign (if applicable)
   is correctly parsed to provide the ``TileSource`` with necessary metadata. All the metadata required
   is present in the ``TileSource`` class, in short you need to read the `tileSize`, `maxLevel`, `witdh`, `height` of the data,
   which you have to decide for yourself how to aggregate (e.g. ``maxLevel = min(maxLevel1, ...)``).
   - **API Extension** ``getImageMetaAt()`` - implement method to access image metadata for each image source in the array independently - 
   this methods can be omitted, but if present the viewer adjusts layer UI with error warning on all layers that use the data for which
   the metadata contains ``error`` key (with a message).
   - **API Extension** ``setFormat()`` - that gives you an argument of preferred format (string, e.g. `"png"`) parsed from available viewer static and dynamic configuration,
   you can decide whether to respect the format.
3. Implement a ``TileSource`` interface that uses the metadata available from stage 2 to fetch multiple tiles.
Build a request, send query and read all image tiles from the server response. See  [Advanced Data API model documentation](https://openseadragon.github.io/examples/advanced-data-model/).  
   - You must respect the tile order and provide
a black tile in case some tile is missing. Tiles must have the same ``tileSize``. 
   - You do not have to care about cache-related API of ``TileSource``, this is handled by the rendering routine. But:
   - The renderer can work by default with vertically-concatenated tiles in a single image or image arrays.  If you finish job with different data type, custom rendering methods can be added to the WebGL data loader - see the module docs.

---

Step by step for asynchronous transfer implementation (demonstrated on DeepZoom protocol). Some steps might seem difficult, please check the [Advanced Data API model documentation](https://openseadragon.github.io/examples/advanced-data-model/).
1. Turn on the ``fetchAsync`` flag in the viewer.
2. Now, data group protocol gives you only the first data URL, i.e. ``data[0]``, so construct a protocol like so:
    > "data_group_protocol": \`${path}?Deepzoom=${data}.dzi\` //compatible with DeeepZoom
2. Now, the OSD will recognize the image array requests as a basic DZI protocol. Since we re-use DeepZoom, we
   will adjust the DeepZoom implementation to support tile request mutliplexing:
   - **New API** ``multiConfigure(urls)`` - method gets a list of configuration URLs for all tile sources independently, e.g. 
   ``data_group_protocol`` applied on each tile URL. use this method to remember the URLs and parse necessary metadata
   from them to create requests for each tile (e.g. by regex matching while having an invariant of equal image metadata without
   explicit verification; or by really using the URL and parsing the metadata). 
   The idea is that once you start adjusting the protocol to fetch the tile data, 
   you create a request for each tile and return an array of image results (or other desired type).
4. We now re-implement a data fetching that awaits all tile data of given ``level``, ``x`` and ``y`` coordinates (can be forwarded within the
   post data) and call finish with an array of images. As before, you do not have to care
   about cache-related API of the TileSource, however, providing incompatible data to the system
   means you have to define how the data is loaded to GPU - see the WebGL module.
<details>
<summary>Exemplary Implementation</summary>
Note this approach does not explicitly verify the image array meta compatibility. `this` refers
to the tile source instance, as if we called this in some method that injects the 

    this.multiConfigure = function(urls) {
        //extract tile urls from the post data/url
        if (this.postData) {
            //for simplicity
            console.error('DeepZoom Mutliplex does not support POST queries!');
        } else {
            //just parse DZI to build tile queries without checking the meta
            this.URLs = urls.map(url => url.replace(
                /([^\/]+?)(\.(dzi|xml|js)?(\?[^\/]*)?)?\/?$/, '$1_files/'));
        }
    }

    this.__cached_getTilePostData = this.getTilePostData;
    this.getTilePostData = function(level, x, y) {
        return [level, x, y];
    }

    //see https://stackoverflow.com/questions/41996814/how-to-abort-a-fetch-request
    function abortableFetch(input, init) {
        let controller = new AbortController();
        let signal = controller.signal;
        init = Object.assign({signal}, init);
        let promise = fetch(input, init);
        promise.controller = controller;
        return promise;
    }

    //tile black image data, memoized
    let blackImage = (resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = context.getTileWidth();
        canvas.height = context.getTileHeight();
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const img = new Image(canvas.width, canvas.height);
        img.onload = () => {
            //next promise just returns the created object
            blackImage = (ready, _) => ready(img);
            resolve(img);
        };
        img.onerror = img.onabort = reject;
        img.src = canvas.toDataURL();
    };

    this.downloadTileStart = function(imageJob) {
        let count = URLs.length, errors = 0;
        const context = imageJob.userData,
            finish = (error) => {
                if (error) {
                    imageJob.finish(null, context.promise, error);
                    return;
                }
                count--;
                if (count < 1) {
                    if (context.images.length < 1) context.images = null;
                    if (errors === URLs.length) {
                        imageJob.finish(null, context.promise, "All images failed to load!");
                    } else {
                        imageJob.finish(context.images, context.promise);
                    }
                }
            },
            fallBack = (i) => {
                errors++;
                return blackImage(
                    (image) => {
                        context.images[i] = image;
                        finish();
                    },
                    () => finish("Failed to create black image!")
                );
            };
    
    this.setFormat = function(format) {
        this.fileFormat = format;
    }

    const coords = imageJob.postData,
        success = finish.bind(this, null)
        self = this;

        //ignored: use just ajax allways: if (imageJob.loadWithAjax)...
        context.images = new Array(count);
            for (let i = 0; i < count; i++) {
            const img = new Image();
            img.onerror = img.onabort = fallBack.bind(this, i);
            img.onload = success;
            context.images[i] = img;
        }

        context.promises = URLs.map((url, i) => {
            //re-contruct the data
            let furl;
            if (self.postData) {
                //for simplicity
                console.error('DeepZoom Mutliplex does not support POST queries!');
            } else {
                //Just the old good DZI, query params are parsed in the configure call, reuse for all tiles
                furl = [url, coords[0], '/', coords[1], '_', coords[2], '.', this.fileFormat, this.queryParams ].join( '' ); 
                method = "GET";
            }

            return abortableFetch(furl, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'same-origin',
                headers: imageJob.ajaxHeaders || {},
                body: null
            }).then(data => data.blob()).then(blob => {
                if (imageJob.userData.didAbort) throw "Aborted!";
                context.images[i].src = URL.createObjectURL(blob);
            }).catch((e) => {
                console.log(e);
                fallBack(i);
            });
        });
    }
    this.downloadTileAbort = function(imageJob) {
        imageJob.userData.didAbort = true;
        imageJob.userData.promises?.forEach(p => p.controller.abort());
    }

    //here is a bit of an exception, rendering injects its own data pipeline
    //handling, so we do not have to overide getCache*() functions although
    //we finish() the job with images array, such array is furthermore
    //compatible with the rendering engine so we are done

</details>

### Implemented, Out-of-box working Image Data Providers
As discussed, the _data group_ is fetched as a single image array request
for each tile in the visualisation, no matter how many data items are rendered. Our IIPServer modification supports Extended Deep Zoom protocol described below.
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
The process happens as follows:
 - define what data is getting fetched inside your child protocol by overriding ``OpenSeadragon.TileSrouce::downloadTileStart``
   - ``finish()`` method of the options is given the data
   - you should override this method to return custom data instead of trying to try to load it as an image object
   - you do not have to override any other cache (or rendering) -related methods in this function, everything else is taken care of
     - **only when used for ``data`` group, otherwise see below**
 - this data is being propagated automatically all the way to the WebGL module
   - note that this is not true for ``background`` group and you should define also how cache works in that case
 - the module uses ``dataLoader.js`` to load textures to the GPU - you should either extend the data loading strategy
   - add loading strategy to all ``WebGLModule.DataLoader.V[X]_[Y].loadersByType`` classes for all `X.Y` WebGL versions you want to support. Define
   a key that corresponds to your data type, the type is obtained as ``toString.apply(data)``
 - or implement the whole data loader interface
   - you get the same data as ``data`` object within `toCanvas(...)` method
   - for WebGL 1.0, `i`th texture is loaded as `TEXTURE_i` - up to max texture units of the given machine
   - for WebGL 2.0, `i`th texture is loaded as `2D_TEXTURE_ARRAY` `i`th element, sampled as texture 3D with `z` coordinate = `i`
   - you can load the texture any way you like, ignoring the above, but you should make sure that ``sampleChannel(index, ...)`` samples `index=i`th texture
   - all sampling overflows should be wrapped, e.g. overflow of texture coordinates behaves as
     - ``TEXTURE_WRAP_S``
     - ``TEXTURE_WRAP_T``

Doing so will enable you to use ANY (raster) data in the viewer, e.g.,
reading from a zip file.

> Support for vector data is on the TODO list. You can use the annotations module or fabric.js module to
> add vector data atop the canvas for now.

##### For other viewer-related API details, check src/README.md
