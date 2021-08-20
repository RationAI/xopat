History = function (context) {
    this.buffer = [];
    this._buffidx = 0;
    this.BUFFER_LENGTH = null;
    this._lastValidIndex = -1;
    this._autoIncrement = 0;
    this._boardSelected = null;
    this._context = context;
}

History.prototype = {

    //TODO history: populate BOARD when annotation file is loaded (some for object loop)
    init: function (historySize = 30) {
        PLUGINS.appendToMainMenu("Board", `<span class="material-icons" style="color:gray; cursor: pointer;" onclick="openseadragon_image_annotations.history.back()" id="history-undo">undo</span>
		<!--TODO dirty relying on a global-->
		<span class="material-icons" style="color:gray; cursor: pointer;" onclick="openseadragon_image_annotations.history.redo()" id="history-redo">redo</span>
		<button class="btn btn-danger mr-2 position-absolute right-2 top-0" type="button" aria-pressed="false" autocomplete="off" id="deleteAll">Delete All</button>`,
            `<div id="annotation-logger" class="inner-panel px-0 py-2" style="flex-grow: 3;">
			<div id="annotation-logs" class="height-full" style="cursor:pointer;overflow-y: overlay;"></div>
			</div>
		</div>`, 'annotation-board');

        this.board = $("#annotation-logs");
        this.undoBtn = $("#history-undo");
        this.redoBtn = $("#history-redo");

        this.BUFFER_LENGTH = historySize;

        this._context.overlay.fabricCanvas().getObjects().forEach(object => {
            if (object.isType('polygon') || object.isType('rect') || object.isType('ellipse')) { // object is a shape
                this._addToBoard(object);
            }
        });
    },

    back: function () {
        if (this.buffer[this._buffidx]) {
            this._performSwap(this._context.overlay.fabricCanvas(),
                this.buffer[this._buffidx].back, this.buffer[this._buffidx].forward)

            //this.bufferLastRemoved = this.buffer[this._buffidx];
            //this.buffer[this._buffidx] = null;


            this._buffidx--;
            if (this._buffidx < 0) this._buffidx = this.BUFFER_LENGTH - 1;
            //if we went around and finished where we once were, stop
            if (this._lastValidIndex === this._buffidx) {
                //lose one object to prevent from cycling
                this.buffer[this._lastValidIndex] = null;

                this._lastValidIndex--;
                if (this._lastValidIndex < 0) this._lastValidIndex = this.BUFFER_LENGTH - 1;
            }

            if (this.redoBtn) this.redoBtn.css("color", "white");
        }

        if (this.undoBtn) {
            let color = this.buffer[this._buffidx] ? "white" : "gray";
            this.undoBtn.css("color", color);
        }
    },

    redo: function () {
        if (this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex) {
            this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;

            this._performSwap(this._context.overlay.fabricCanvas(),
                this.buffer[this._buffidx].forward, this.buffer[this._buffidx].back)
        }

        if (this.redoBtn) {
            let color = this._lastValidIndex >= 0 && this._buffidx !== this._lastValidIndex ? "white" : "gray";
            this.redoBtn.css("color", color);
        }
        if (this.undoBtn) this.undoBtn.css("color", "white");
    },

    push: function (newObject, previous = null) {
        if (newObject) {
            this._addToBoard(newObject);
        }

        if (previous) {
            //todo not necessarily ID present
            this._removeFromBoard(previous);
        }

        console.log("PREV", previous, "NEXT", newObject);

        this._buffidx = (this._buffidx + 1) % this.BUFFER_LENGTH;
        this.buffer[this._buffidx] = { forward: newObject, back: previous };
        this._lastValidIndex = this._buffidx; //new object creation overiddes history

        if (this.undoBtn && this.redoBtn) {
            this.undoBtn.css("color", "white");
            this.redoBtn.css("color", "gray");
        }
    },

    highlight: function (object) {
        if (this._boardSelected) {
            this.board.find(`#log-object-${this._boardSelected.incrementId}`).removeClass('color-bg-tertiary');
        }
        if (object) {
            this.board.find(`#log-object-${object.incrementId}`).addClass('color-bg-tertiary');
        }
        this._boardSelected = object;
    },

    _focus: function (cx, cy, objectId = null) {
        var target = PLUGINS.dataLayer.imageToViewportCoordinates(new OpenSeadragon.Point(cx, cy));
        if (objectId !== null) {
            var targetObj = this._findObjectOnCanvasById(objectId);
            if (targetObj) {
                this._context.overlay.fabricCanvas().setActiveObject(targetObj);
            }
        }
        PLUGINS.osd.viewport.panTo(target);
        PLUGINS.osd.viewport.applyConstraints();
    },

    _updateBoardText: function (object, text) {
        console.log(text);
        if (!text || text.length < 0) text = this._getObjectDefaultDescription(object);
        this.board.find(`#log-object-${object.incrementId} span.desc`).html(text);
    },

    _removeFromBoard: function (object) {
        this.board.children(`#log-object-${object.incrementId}`).remove();
    },

    _addToBoard: function (object) {
        let desc = "", icon = "";
        if (!object.comment) {
            desc = this._getObjectDefaultDescription(object);
            icon = this._getObjectDefaultIcon(object);
        } else {
            desc = object.comment;
            if (desc === this._context.leftClickLabel || desc === this._context.rightClickLabel) {
                //auto labelling - append coords to distinguish
                desc += ` [${Math.round(object.left)}, ${Math.round(object.top)}]`;
            }
            icon = this._getObjectDefaultIcon(object);
        }

        if (!object.incrementId) {
            object.incrementId = this._autoIncrement;
            this._autoIncrement++;
        }

        let center = object.getCenterPoint();
        //todo relying on a dirty global
        this.board.prepend(`<div id="log-object-${object.incrementId}" onclick="openseadragon_image_annotations.history._focus(${center.x}, ${center.y}, ${object.incrementId});">
			    <span class="material-icons" style="color: ${object.fill}">${icon}</span> 
				<input type="text" class="form-control border-0" disabled="true" class="desc" style="width: calc(100% - 80px); background:transparent;" value="${desc}">
				<span class="material-icons" onclick="
				 if ($(this).html() === 'edit') {
					$(this).prev().prop('disabled', false); 
					$(this).html('save'); 
				 } else {
					 $(this).html('edit');
					 $(this).prev().prop('disabled', true); 
					 openseadragon_image_annotations.history._findObjectOnCanvasById(${object.incrementId}).set({comment: $(this).prev().val()});
				 }">edit</span> 
			</div>`);
    },

    _getObjectDefaultDescription: function (object) {
        switch (object.type) {
            case "rect": return `Rect [${Math.round(object.left)}, ${Math.round(object.top)}]`;
            case "polygon": return `Polygon [${Math.round(object.left)}, ${Math.round(object.top)}]`;
            case "ellipse": return `Ellipse [${Math.round(object.left)}, ${Math.round(object.top)}]`;
            default:
                return;
        }
    },

    _getObjectDefaultIcon: function (object) {
        return { "rect": "crop_5_4", "polygon": "share", "ellipse": "circle" }[object.type];
    },

    _performSwap: async function (canvas, toAdd, toRemove) {
        if (toRemove) {
            let center = toRemove.getCenterPoint();
            this._focus(center.x, center.y);
            await sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.remove(toRemove);
            this._removeFromBoard(toRemove);

            if (toAdd) {
                canvas.add(toAdd);
                this._context.overlay.fabricCanvas().setActiveObject(toAdd);
                this._addToBoard(toAdd);
            }
            canvas.renderAll();

        } else if (toAdd) {
            let center = toAdd.getCenterPoint();
            this._focus(center.x, center.y);
            await sleep(150); //let user to orient where canvas moved before deleting the element
            canvas.add(toAdd);
            this._context.overlay.fabricCanvas().setActiveObject(toAdd);
            canvas.renderAll();
            this._addToBoard(toAdd);
        }
    },

    _findObjectOnCanvasById: function (id) {
        // console.log(this.overlay.fabricCanvas()._objects);
        // console.log(coords);
        // console.log(this.overlay.fabricCanvas()._searchPossibleTargets(this.overlay.fabricCanvas()._objects, coords));

        // return this.overlay.fabricCanvas()._searchPossibleTargets(this.overlay.fabricCanvas()._objects, coords);

        //todo fabric.js should have some way how to avoid linear iteration over all objects...
        let target = null;
        this._context.overlay.fabricCanvas()._objects.some(o => {
            if (o.incrementId === id) {
                target = o;
                return true;
            }
            return false;
        });
        return target;
    }
}