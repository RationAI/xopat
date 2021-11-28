//todo use getters from the parent class and do not rely on jQuery!!!

class HistovisoImage extends AnnotationObjectFactory {
    constructor(context, autoCreationStrategy, presetManager) {
        super(context, autoCreationStrategy, presetManager, "histoviso-explain");
        this._current = null;
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
        let height = theObject.getHeight();
        let width = theObject.getWidth();
        theObject.set({ width: width, height: height, scaleX: 1, scaleY: 1, });
        theObject.calcCoords();
    }

    instantCreate(point, isLeftClick = true) {
        //no support: do not create requests in mistake as the operation is not cheap
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

    selected(theObject) {
        this._selected = theObject;
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

    getASAP_XMLTypeName() {
        return "NN inspector";
    }

    setWebGLRenderer(renderer, dataSource) {
        this._renderer = renderer;
        this._dataSource = dataSource;
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
                    comment: _this._selected.comment
                }
            ));
            img.originalImage = myImage;

            _this._context.replaceAnnotation(_this._selected, img, true);
            img.bringToFront();
            _this._context.canvas().renderAll();
            _this._selected = img;
        });

    }

    _abortSendRequest(message, dummyRect) {
        PLUGINS.dialog.show(message, 8000, PLUGINS.dialog.MSG_ERR);
        if (dummyRect) {
            this._context.deleteHelperAnnotation(dummyRect);
        }
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

        var pointLeftTop = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(imageBounds.x, imageBounds.y));
        var pointRightBottom = PLUGINS.imageLayer.imageToWindowCoordinates(new OpenSeadragon.Point(imageBounds.x + imageBounds.width, imageBounds.y + imageBounds.height));
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

        let begin = setup[0].data.lastIndexOf('/')+1;
        let data = setup[0].data.substr(begin, setup[0].data.length - begin - 4);
        data = {
            slide_name: data,
            coords: coords,
            expl_method: this._dataSource.getMethod(),
            expl_params: $.extend({
                layer_name: this._dataSource.getLayer(),
                feature_map_id: this._dataSource.getLayerFeatureId(),
                model_name: this._dataSource.getModel()
            }, this._dataSource.getAditionalMethodParams())
        };
        console.log(data);

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
                "content-type": "application/json",
                'Authorization': 'Basic cmF0aW9uYWk6cmF0aW9uYWlfZGVtbw=='
            })
        }).then(response => {
            if (response.status == 422) {
                return response.blob()
                    .then(_ => {
                        throw new Error("Selected area is too small or does not contain any tissue.");
                    });
            } else if (response.status < 200 || response.status > 299) {
                return response.blob()
                    .then(_ => {
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
                //todo feed blob instantly to GPU?
                // let urlCreator = window.URL || window.webkitURL;
                //
                // let dataUrl = urlCreator.createObjectURL(blob);
                //
                // fabric.Image.fromURL(dataUrl, function (img) {
                //     img.set($.extend({},
                //         _this._presets.getAnnotationOptions(dummyRect.isLeftClick),
                //         {
                //             left: imageBounds.x,
                //             top: imageBounds.y,
                //             width: imageBounds.width,
                //             height: imageBounds.height,
                //             type: _this.type,
                //             comment: `(${data.expl_method}) Layer ${data.expl_params.layer_name} [feature ${data.expl_params.feature_map_id}]`
                //         }
                //     ));
                //
                //     _this._context.deleteHelperAnnotation(dummyRect);
                //     _this._context.addAnnotation(img);
                //     img.bringToFront();
                //
                //     _this._context.canvas().renderAll();
                // });



            //once data ready
            let urlCreator = window.URL || window.webkitURL;
            //drawing with opengl now not implemented
            var myImage = document.createElement('img');
            myImage.src = urlCreator.createObjectURL(blob);

            myImage.onload = () => {
                //_this.lastDrawn = myImage;
                var width = pointRightBottom.x - pointLeftTop.x;
                var height = pointRightBottom.y - pointLeftTop.y;
                //canvas dimensions to be equal to screen dimensions, a bit unsafe to set image dimensions (big numbers)
                _this._renderer.setDimensions(myImage.width, myImage.height);

                // Render a webGL canvas to an input canvas using cached version
                // Only one image supported at the time, will be given to all shaders defined in visualisation, will change soon

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
                            comment: `(${data.expl_method}) Layer ${data.expl_params.layer_name} [feature ${data.expl_params.feature_map_id}]`
                        }
                    ));
                    img.originalImage = myImage;

                    _this._context.deleteHelperAnnotation(dummyRect);
                    _this._context.addAnnotation(img);
                    img.bringToFront();

                    _this._context.canvas().renderAll();
                });

            };
            }
        ).catch(e => {
            PLUGINS.dialog.show(e, 8000, PLUGINS.dialog.MSG_WARN);
            _this._context.deleteHelperAnnotation(dummyRect);
        });
    }
}

//registering is performed after the plugin has been successfully initialized
//AnnotationObjectFactory.register(HistovisoImage);