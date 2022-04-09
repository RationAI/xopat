# Python Playground

## Protocol
The API builds on DeepZoom protocol syntax. However, the data is sent by default in JSON.
The server then presents algorithms common interface, that is here described with python
(but can be mapped to any language). The output of each function (algorithm interface)
should be able to return also an `invalud value`, e.g. `None`, for python in case the output
of the function should be ignored, throw a specific exception in case the UI should be notified.

### Discover
The discovery phase sends HTTP GET/POST request to the server:

> protocol://server:port/[..]/prepare?DeepZoom=[data].dzi

Carrying additional (and optional) POST data, an image part example that is being
processed and additional metadata. In case such data is not provided, 
the server must know how to obtain the data by itself. The idea is that both
client and server know how to communicate with the image server and this is pure optimization feature.

Each algorithm is given the following function signature
> def accepts(metadata: dict, image: np.ndarray):

containing the metadata key-value map and a sample image (usualy top level) tile in a format easy
to deal with. The metadata can contain arbitrary values, but pixel-specific
data should be always present: 
 - `width`
 - `height` todo!

The return value should be either a map that can contain any of these arguments:
 - `html`: custom html controls for the given algorithm
 - `mode`: mode it operates in: `batch` (process and save), `online` (show online), `tile` (process only a single tile)
 - `navigationLock`: default `true`, locks view to a selection, toggle-able from UI

These values are extended by the algorithm `include.json` file and sent as a JSON object back to the front-end.
The function should return `None` for the algorithm to be ignored or raise a `AcceptError` message.
//todo describe how the object is being built (alg id -> set mapping, icon sending etc..)

### Initialize
The algorithm initialization sends HTTP GET/POST request to the server:
> protocol://server:port/[..]/init/[algorithm_id]?DeepZoom=[data].dzi

Carrying additional (and optional) POST data, this time only additional image
metadata. 

Each algorithm is given the following function signature
> def init(metadata: dict): 

containing the metadata key-value map and a sample image (usualy top level) tile in a format easy
to deal with. The metadata can contain arbitrary values, but pixel-specific
data should be always present. Since the algorithm already agreed on working with
the inputs, a return value should ne either a map (dictionary) or it should throw a `InitError`
to notify the UI what has gone wrong.

The output `dict` must contain certain values, optional ones are marked [O]
````json
{
  "output": {
    "data": "pixels", // or "geometry"
    "layers": 1, //number of layers in the output, 1 if "geometry"
    [0] "rendering": [
      "shader_type" //type strings or whole configuration objects, see the WebGL module API  
    ]   
  },
  [0] "overlap": 125, //required overlap size, cannot exceed tile size
  [0] "renderOverlap": 0, //rendering with overlap size,
}
````
The output of the `init` function is sent back to the client.

### Process
The algorithm initialization sends HTTP GET/POST request to the server:
> protocol://server:port/[..]/process/[algorithm_id]?DeepZoom=[data].dzi_files[level]/[x]_[y].[format]

Carrying additional (and optional) POST data, an image part example that is being
processed and additional metadata. In case such data is not provided, 
the server must know how to obtain the data by itself, **including required
settings from the initialization phase, namely overlap**. 

Each algorithm is given the following function signature
> def process(image: np.ndarray, metadata: dict):

containing the metadata key-value map and a `level`: [`x`, `y`] tile in a format easy
to deal with. The metadata can contain arbitrary values, but pixel-specific
data should be always present.

The output of the function is described below.

##### Rendering: online/tile
Pixel data is being post-processed by WebGL module. You defined how many layers
the function should output and how these layers are being concatenated (rendering).
The metadata also contains a tile size. The output of the function should thus be
a 2D array that has a width of `tileSize + 2*renderOverlap` or in other words
`image.width - 2*overlap + 2*renderOverlap`. The height is similar, but it should
respect the number of layers, each layer should add one more image (vertical stacking):
`tileSize*layers + 2*renderOverlap`.

Geometry data is being first rasterized and then post-processed. It must have
only one layer (todo allow multiple layers and object layer reference?) and
the following structure: 
````json
[
  {
    "object": [20, 20, 30, 20, 30, 30, 30, 20], 
    "color": [1.0, 1.0, 1.0, 1.0]
  }, ...
]
````
for each object to render. Object are concatenated 2D vertices of the polygon to render, in a tile space.
Allowed are also out-of-bounds values, these are clipped.
The polygon can be assigned a color, that has to be a 0-1 range RGBA array. 

##### Rendering: batch
Not supported yet.


