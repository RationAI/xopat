Network = function () {
    //comply to the documentation:
	this.id = "histoviso_explain";

    //controlPanelId is incomming parameter, defines where to add HTML
    PLUGINS.appendToMainMenu("Network control panel", "<!--nothing in title html-->", `HERE I CAN ADD CUSTOM CONTROLS, HTML CONTENT etc...`, "idOfTheOuterDivContainer", this.id);

    //it is also possible to add elements to body:
    //$("body").append("<!--some html-->");
    // we will create element to append our html and js
    PLUGINS.addHtml("<div id='network-scripts'></div>", this.id);
    // for now just create some invisible container and append there 'rubbish', later, this html is used
    // for controlling the shader, we will probably want to place it somewhere, e.g. inside this.controlPanelId
    PLUGINS.addHtml("<div id='network-html' style='display:none'></div>", this.id);
}

Network.prototype = {

    //delayed after OSD initialization is finished...
    openSeadragonReady: function () {
        //this in callback != this here
        var _this = this;

        if (!PLUGINS.dataLayer) {
            throw "Histoviso interactive explainability plugin needs TiledImage class instance of the data visualisation layer in order to work.";
        }

        //Requires Annotations plugin
        let annotationPlugin = PLUGINS.each[PLUGINS.each[this.id].requires];
        if (!annotationPlugin || !annotationPlugin.loaded) {
            throw "Histoviso interactive explainability plugin needs Annotations plugin in order to work.";
        }

        this._fabricOverlay = annotationPlugin.instance;

        this.viaGL = new WebGLWrapper({
            //where to append html/css designed for shaders to use, these containers are emptied before append!
            htmlControlsId: "network-html",
            scriptId: "network-scripts",
            //just a custom function names to avoid collision
            jsGlLoadedCall: "glNetworkLoaded",
            jsGlDrawingCall: "glNetworkDrawing",
            //where are shaders fetched
            shaderGenerator: "/visualization/client/dynamic_shaders/build.php",
            //some callbacks
            visualisationReady: function (i, visualisation) {

            },
            visualisationInUse: function (visualisation) {

            },
            onFatalError: function (vis) {
                //use vis["error"] -> user message
                // vis["desc"] -> dev detailed message
                alert("Error in network plugin:" + vis["error"] + (vis["desc"] ? vis["desc"] : ""));
            },

            //must re-define (kinda design error, will be fixed, just now leave it here)
            gl_drawing: function (tile, e) {
                glNetworkDrawing(_this.viaGL.gl, e);
                return true; //always draw
            }
        });


        //API is not finished yet so it contains unused elements, or some things need not to make sense 
        this.viaGL.setVisualisation({
            name: "Visualisation name",
            //data: "unused_field",
            //todo data?
            params: {
                unique_id: "network" //voluntary parameter, avoids namespace collision
            },
            shaders: {
                "__automaticaly_generated_data": {
                    data: "Annotation layer", //unique ID and name in one, will be probably separated
                    //todo: here would probably wanted to keep URL to the data - tiled image, yet to be implemented, also this visualisation does not support tiled image so...
                    //also, only one image supported for now (Martin Kačenga is working on it)
                    type: "identity", // now only 'edge' or 'color' or 'identity'
                    visible: "1", //unused for now
                    params: { //parameters passed to shader
                        //no params for identity
                    }
                }
            }
        });

        this.viaGL.prepareAndInit();

        //on enter hit:
        document.addEventListener('keydown', (e) => {
            if (e.code === "Enter") {
                //https://openseadragon.github.io/examples/viewport-coordinates/
                //OSD coordinate system: viewport coordinates: float-based coord system (small numbers 0,1,2...etc), internal fomat
                //                       screen/web coordinates: integer-based screen X,Y - coordinates the browser works with, e.g. event.pageX (cursor position...)
                //                       image coordinates: integer-based image X,Y coordinates in the image, i.e. 'pixel coordinates'

                //get clipping wiewport, in wiewport coordinates
                var clipBounds = PLUGINS.osd.viewport.getConstrainedBounds(false);
                //go from viewport to image so that we can tell the network which pixels are to be processed....
                // https://openseadragon.github.io/docs/OpenSeadragon.TiledImage.html#viewportToImageCoordinates
                var imageBounds = PLUGINS.imageLayer.viewportToImageRectangle(clipBounds.x, clipBounds.y, clipBounds.width, clipBounds.height, true); //send these coords to network
                //go from image to screen so that canvas can be properly placed:
                var pointLeftTop = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(imageBounds.x, imageBounds.y));
                var pointRightBottom = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(imageBounds.x + imageBounds.width, imageBounds.y + imageBounds.height));

                //make ajax call to server for data (demo image here)
                const url = "/visualization/client/plugins/network/eowyn.jpg";
                fetch(`${window.origin}/extract-tiles`, {
                    method: "POST",
                    body: JSON.stringify(coords),
                    cache: "no-cache",
                    headers: new Headers({
                        "content-type": "application/json"
                    })
                }).then(
                    response => response.blob()
                ).then(
                    blob => {
                        //todo feed blob instantly to GPU?
                        var myImage = document.createElement('img');
                        let urlCreator = window.URL || window.webkitURL;
                        myImage.src = urlCreator.createObjectURL(blob);

                        //once data ready
                        myImage.onload = () => {
                            var width = pointRightBottom.x - pointLeftTop.x;
                            var height = pointRightBottom.y - pointLeftTop.y;
                            //canvas dimensions to be equal to screen dimensions, a bit unsafe to set image dimensions (big numbers)
                            _this.viaGL.setDimensions(width, height);

                            // Render a webGL canvas to an input canvas using cached version
                            // Only one image supported at the time, will be given to all shaders defined in visualisation, will change soon
                            var output = _this.viaGL.toCanvas(myImage, e);
                            var canvas = _this._fabricOverlay.overlay.fabricCanvas();

                            fabric.Image.fromURL(output.toDataURL(), function (img) {
                                img.left = imageBounds.x;
                                img.top = imageBounds.y;
                                img.width = imageBounds.width;
                                img.height = imageBounds.height;
                                img.selectable = true;

                                canvas.add(img);
                                img.bringToFront();

                                canvas.renderAll();
                            });

                        };
                    }
                );
            }
        });
    },

    myOtherFunction: function () {
        //todo some stuff...
    }
}

registerPlugin(Network);