//todo use getters from the parent class and do not rely on jQuery!!!

class HistovisoImage extends OSDAnnotations.AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager, id, type) {
        super(context, autoCreationStrategy, presetManager, id, type);
        this._current = null;
        this._pending = {};
        this.active = false;

        let _this = this;
        fabric.util.loadImage("plugins/histoviso-explain/loading.png", function(img) {
            _this._pattern = new fabric.Pattern({
                source: img,
                repeat: 'repeat'
            });
        });
    }

    getIcon() {
        return "data_exploration";
    }

    getDescription(ofObject) {
        return `Histoviso: network insight`;
    }

    getCurrentObject() {
        return this._current;
    }

    create(parameters, options) {
        //approximated by a rectangle
        return new fabric.Rect($.extend({}, options, parameters, {
            type: this.type,
            factoryID: this.factoryID,
            stroke: 'gray',
            fill: this._pattern,
            strokeWidth: 16,
            comment: "Loading"
        }));
    }

    /**
     * @param {Object} ofObject fabricjs.Rect object that is being copied
     * @param {Object} parameters object of the following properties:
     *              - left: offset in the image dimension
     *              - top: offset in the image dimension
     *              - rx: major axis radius
     *              - ry: minor axis radius
     */
    copy(ofObject, parameters) {
        //todo allow copy?
        return ofObject;
    }

    edit(theObject) {
        theObject.set({
            hasControls: true,
            lockMovementX: false,
            lockMovementY: false
        });
    }

    recalculate(theObject) {
        let height = theObject.getScaledHeight();
        let width = theObject.getScaledWidth();
        theObject.set({ width: width, height: height, scaleX: 1, scaleY: 1, });
        theObject.calcACoords();
    }

    instantCreate(point, isLeftClick = true) {
        //no support: do not create requests in mistake as the operation is not cheap
        throw "Use ";
    }

    initCreate(x, y, isLeftClick) {
        this._origX = x;
        this._origY = y;
        this._current = this.create({
            left: x,
            top: y,
            width: 1,
            height: 1
        }, this._presets.getAnnotationOptions(isLeftClick));
        this._context.addHelperAnnotation(this._current);
    }

    updateCreate(x, y) {
        if (!this._current) return;
        if (this._origX > x) {
            this._current.set({ left: Math.abs(x) });
        }
        if (this._origY > y) {
            this._current.set({ top: Math.abs(y) });
        }
        let width = Math.abs(x - this._origX);
        let height = Math.abs(y - this._origY);
        this._current.set({ width: width, height: height });
    }

    finishDirect() {
        let obj = this.getCurrentObject();
        if (!obj) return;

        this.sendRequest({
            x: obj.left,
            y: obj.top,
            width: obj.width,
            height: obj.height
        }, obj);

        this._current = undefined;
    }

    /**
     * Not supported: returns undefined
     */
    toPointArray(obj, converter, quality=1) {
        return undefined;
    }

    _setRequestStarted(id, request) {
        if (this._isRequestPending(id)) {
            Dialogs.show("Still working on the task, please, be patient.", 8000, Dialogs.MSG_WARN);
            return;
        }
        let _this = this;
        this._pending[id] = setTimeout((() => {_this._setRequestTimedOut(id, request)}), 90000);
    }

    _setRequestTimedOut(id, request) {
        this._abortSendRequest("Timed out: the server is probably busy. Please, try again.", request.dummyRect);
        this._clearRequestTimeOut(id);
    }

    _isRequestPending(id) {
        return this._pending[id] !== undefined;
    }

    _clearRequestTimeOut(id) {
        clearTimeout(this._pending[id]);
        delete this._pending[id];
    }

    _abortSendRequest(message, dummyRect) {
        Dialogs.show(message, 8000, Dialogs.MSG_ERR);
        if (dummyRect) {
            this._context.deleteHelperAnnotation(dummyRect);
        }
    }
}

class HistovisoImageExplorer extends HistovisoImage {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "_histoviso-explain-explorer", "rect");
    }

    getIcon() {
        return "query_stats";
    }

    setContext(dataSource) {
        this._dataSource = dataSource;
    }

    getDescription(ofObject) {
        return `Histoviso: network insight rendering`;
    }

    selected(theObject) {
        //do nothing
    }

    title() {
        return "NN measure";
    }

    sendRequest(imageBounds, dummyRect=undefined) {
        if (!this.active) {
            this._abortSendRequest("Please wait for the server to download model data.", dummyRect);
            return;
        }

        const _this = this;
        let coords = {
            x1: imageBounds.x,
            y1: imageBounds.y,
            x2: imageBounds.x + imageBounds.width,
            y2: imageBounds.y + imageBounds.height
        }

        if (Math.abs(coords.x1 - coords.x2) > 5000 || Math.abs(coords.y1 - coords.y2) > 5000) {
            this._abortSendRequest("Selected area is too big to process: either zoom closer or select smaller area.", dummyRect);
            return;
        }

        if (!dummyRect) {
            dummyRect = this.create(
                {
                    left: imageBounds.x,
                    top: imageBounds.y,
                    width: imageBounds.width,
                    height: imageBounds.height,
                },
                this._presets.getAnnotationOptions(true)
            );
            this._context.addHelperAnnotation(dummyRect);
        }

        let data = {
            slide_name: this._dataSource.getImageSource(),
            coords: coords,
            params: {
                model_name: this._dataSource.getModel()
                //also top_n, batch_size params, now not send server-default used
            }
        };
        let reqId = imageBounds.toString();
        console.log("Sending request for exploration: ", data);
        this._setRequestStarted(reqId, {dummyRect: dummyRect});
        //make ajax call to server for data (demo image here)
        fetch(`/histoviso-explain/top-feature-maps`, {
            method: "POST",
            body: JSON.stringify(data),
            redirect: 'error',
            mode: 'cors', // no-cors, *cors, same-origin
            credentials: 'same-origin', // include, *same-origin, omit
            cache: "no-cache",
            referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
            headers: new Headers({
                //todo remove headers from everywhere!!
                "content-type": "application/json"
            })
        }).then(response => {
            if (response.status == 422 || response.status == 503) {
                return response.text()
                    .then(e => {
                        console.error("Fetching NN top stats:", e);
                        throw new Error(e);
                    });
            } else if (response.status < 200 || response.status > 299) {
                return response.text()
                    .then(e => {
                        console.error("Fetching NN top stats:", e);
                        throw new Error("There was an error when contacting the server. Is it online?");
                    });
            } else {
                return response.json();
            }
        }).then(json => {
            if (!_this._isRequestPending(reqId)) return;
            _this._clearRequestTimeOut(reqId);

            let html = [
                `<table><tr class="pb-3 border-bottom">
<th><span class=\"material-icons\">layers</span> name </th>
<th><span class="material-icons">functions</span> sum </th>
<th><span class="material-icons">trending_up</span> max </th></tr>`
            ];

            for (let layer in json) {
                html.push(`<tr class="py-2"><td class="px-2">${layer}</td>
<td class="px-2">${json[layer]["sum"].join(", ")}</td>
<td class="px-2">${json[layer]["max"].join(", ")}</td></tr>`);
            }
            html.push("</table>");

            let ctx = Dialogs.getModalContext("nn-explainability-exploration");
            if (ctx) {
                ctx.document.getElementById("nn-explainability-exploration-results").innerHTML = html.join("");
            } else {
                Dialogs.showCustomModal(
                    "nn-explainability-exploration",
                    `Top feature maps for the model <br><b>${data.params.model_name}</b>`,
                    `<div id="nn-explainability-exploration-results">${html.join("")}</div>`,
                    "");
            }
            _this._context.deleteHelperAnnotation(dummyRect);

        }).catch(e => {
            Dialogs.show(e, 8000, Dialogs.MSG_WARN);
            _this._context.deleteHelperAnnotation(dummyRect);
        });
    }
}

class HistovisoImageRenderer extends HistovisoImage {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "_histoviso-network_inspector", "image");
    }

    getIcon() {
        return "assessment";
    }

    setContext(renderer, dataSource) {
        this._renderer = renderer;
        this._dataSource = dataSource;
    }

    getDescription(ofObject) {
        return `Histoviso: network insight rendering`;
    }

    selected(theObject) {
        this._selected = theObject;
    }

    title() {
        return "NN inspector";
    }

    reRenderSelectedObject() {
        if (!this._selected || !this._renderer) return;

        let myImage = this._selected.originalImage;

        this._renderer.setDimensions(myImage.width, myImage.height);
        var output = this._renderer.processImage(myImage, {width: myImage.width, height: myImage.height}, 0, 0);
        let _this = this;
        fabric.Image.fromURL(output.toDataURL(), function (img) {
            img.set($.extend({},
                _this._presets.getAnnotationOptions(_this._selected.isLeftClick),
                {
                    left: _this._selected.left,
                    top: _this._selected.top,
                    width: _this._selected.width,
                    height: _this._selected.height,
                    type: _this.type,
                    factoryID: _this.factoryID
                }
            ));
            img.originalImage = myImage;

            _this._context.replaceAnnotation(_this._selected, img, true);
            img.bringToFront();
            _this._context.canvas.renderAll();
            _this._selected = img;
        });
    }

    reSendRequest() {
        if (!this._selected || !this._renderer) return;

        this._context.deleteAnnotation(this._selected);
        this._current = this.create(  {
                left: this._selected.left,
                top: this._selected.top,
                width: this._selected.width,
                height: this._selected.height,
            },
            this._presets.getAnnotationOptions(this._selected.isLeftClick)
        );
        this._context.addHelperAnnotation(this._current);
        this._selected = null;
        this.finishDirect();
    }

    sendRequest(imageBounds, dummyRect=undefined) {
        if (!this._renderer) {
            this._abortSendRequest("Plugin has not been fully initialized yet or an error has occurred.", dummyRect);
            return;
        }

        if (!this.active) {
            this._abortSendRequest("Please wait for the server to download model data.", dummyRect);
            return;
        }

        const _this = this;

        let coords = {
            x1: imageBounds.x,
            y1: imageBounds.y,
            x2: imageBounds.x + imageBounds.width,
            y2: imageBounds.y + imageBounds.height
        };

        if (Math.abs(coords.x1 - coords.x2) > 5000 || Math.abs(coords.y1 - coords.y2) > 5000) {
            this._abortSendRequest("Selected area is too big to process: either zoom closer or select smaller area.", dummyRect);
            return;
        }

        if (!dummyRect) {
            dummyRect = this.create(
                {
                    left: imageBounds.x,
                    top: imageBounds.y,
                    width: imageBounds.width,
                    height: imageBounds.height,
                },
                this._presets.getAnnotationOptions(true)
            );
            this._context.addHelperAnnotation(dummyRect);
        }

        let data = {
            slide_name: this._dataSource.getImageSource(),
            coords: coords,
            expl_method: this._dataSource.getMethod(),
            expl_params: $.extend({
                layer_name: this._dataSource.getLayer(),
                feature_map_id: this._dataSource.getLayerFeatureId(),
                model_name: this._dataSource.getModel()
            }, this._dataSource.getAditionalMethodParams())
        };
        let reqId = imageBounds.toString();
        console.log("Sending request for explainability: ", data);
        this._setRequestStarted(reqId, {dummyRect: dummyRect});
        //make ajax call to server for data (demo image here)
        fetch(`/histoviso-explain/explainability`, {
            method: "POST",
            body: JSON.stringify(data),
            redirect: 'error',
            mode: 'cors', // no-cors, *cors, same-origin
            credentials: 'same-origin', // include, *same-origin, omit
            cache: "no-cache",
            referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
            headers: new Headers({
                "content-type": "application/json"
            })
        }).then(response => {
            if (response.status == 422 || response.status == 503) {
                return response.text()
                    .then(e => {
                        console.error("Fetching NN image:", e);
                        throw new Error(e);
                    });
            } else if (response.status < 200 || response.status > 299) {
                return response.text()
                    .then(e => {
                        console.error("Fetching NN image:", e);
                        throw new Error("There was an error when contacting the server. Is it online?");
                    });
            } else {
                let adjustedCoords = response.headers.get('new_coords');
                if (adjustedCoords) {
                    try {
                        adjustedCoords = JSON.parse(adjustedCoords);
                        imageBounds = {
                            x: adjustedCoords.x1,
                            y: adjustedCoords.y1,
                            width: adjustedCoords.x2 - adjustedCoords.x1,
                            height: adjustedCoords.y2 - adjustedCoords.y1
                        }
                    } catch (e) {
                        //ignore, use sent coords
                    }
                }
                return response.blob();
            }
        }).then(blob => {
            if (!_this._isRequestPending(reqId)) return;
            _this._clearRequestTimeOut(reqId);

            let urlCreator = window.URL || window.webkitURL;
            //drawing with opengl now not implemented
            var myImage = document.createElement('img'), url = urlCreator.createObjectURL(blob);
            myImage.src = url;

            myImage.onload = () => {
                URL.revokeObjectURL(url);
                //todo necessary?
                _this._renderer.setDimensions(myImage.width*2, myImage.height*2); //idk why 2* but it works

                // Render a webGL canvas to an input canvas using cached version
                // Only one image supported at the time, will be given to all shaders defined in visualization, will change soon

                var output = _this._renderer.processImage(myImage, {width: myImage.width , height: myImage.height}, 0, 0);
                fabric.Image.fromURL(output.toDataURL(), function (img) {
                    img.set($.extend({},
                        _this._presets.getAnnotationOptions(dummyRect.isLeftClick),
                        {
                            left: imageBounds.x,
                            top: imageBounds.y,
                            width: imageBounds.width,
                            height: imageBounds.height,
                            type: _this.type,
                            factoryID: _this.factoryID,
                            comment: `(${data.expl_method}) Layer ${data.expl_params.layer_name} [feature ${data.expl_params.feature_map_id}]`
                        }
                    ));
                    img.originalImage = myImage;

                    _this._context.deleteHelperAnnotation(dummyRect);
                    _this._context.addAnnotation(img);
                    img.bringToFront();

                    _this._context.canvas.renderAll();
                });

            };
        }).catch(e => {
            Dialogs.show(e, 8000, Dialogs.MSG_WARN);
            _this._context.deleteHelperAnnotation(dummyRect);
        });
    }
}

//registering is performed after the plugin has been successfully initialized
OSDAnnotations.registerAnnotationFactory(HistovisoImageRenderer);
OSDAnnotations.registerAnnotationFactory(HistovisoImageExplorer);
