/**
 * Matrix view for annotations, not yet implemented
 */
AnnotationsGUI.AdvancedControls = class {

    constructor(selfName, context) {
        this.context = context;
        this.self = `plugin('${context.id}').${selfName}`;
        USER_INTERFACE.AdvancedMenu.setMenu(this.context.id, "annotations-advanced", "Advanced Upload",
            `<div id="annotations-advanced-content" class="width-full"></div>`);
        this.loadDefaultPage();
    }

    loadDefaultPage() {
        $("#annotations-advanced-content").html(`
        Upload annotations 
        <select id="load-objects-type-load-select" class="form-control float-right"><option selected value="JSON">JSON</option><option disabled value="XML">XML</option></select>
        <br>
        <textarea id="load-objects-custom-area" class="form-control blob-code-inner" style="width: calc(100% - 20px); margin-left: 20px;
display: block; resize: vertical;"></textarea>
<br>
This feature is not yet polished, the loading process will:
<ul class="pl-4"><li>not support XML import unless you ask me to implement this</li><li>not inspect attribute syntax</li><li>use current active preset</li><li>not translate attribute keys for you</li></ul>
<br>
<b>Supported attribute keys (some)</b>:
<p>
"fill", "isLeftClick", "opacity", "strokeWidth", "stroke", "scaleX", "scaleY", "type", "factoryID", "hasRotatingPoint", 
"borderColor", "cornerColor", "borderScaleFactor", "hasControls", "lockMovementX", "lockMovementY", "meta", "presetID", "layerID"
</p>
<b>type="polygon"</b>: "points"<br>
<b>type="rect"</b>: "left", "top", "width", "height"<br>
<b>type="ellipse"</b>: "left", "top", "rx", "ry", "angle"<br>
<b>type="ruller"</b>: --not-supported--<br>
<br>
Example:
<br><pre>[{"left":0, "top":0, "width":500, "height":500, "type":"rect"}, 
{"left":500, "top":0, "width":500, "height":500, "type":"rect"}]</pre>
        <button class="btn float-right" onclick="${this.self}.load()">Load</button>
        `);
    }

    load() {
        const self = this;
        let data = $("#load-objects-custom-area").val();
        const mode = $("#load-objects-type-load-select").val();

        // done inside the API, but with a warning - remove?
        // let preset = this.context.context.presets.left || this.context.context.presets.right;
        // if (!preset) {
        //     Dialogs.show("No preset is active.",
        //         5000, Dialogs.MSG_WARN);
        //     return;
        // }
        //


        try {

            if (mode === "XML") {
                throw "XML annotations not yet implemented.";
            } else {
                data = JSON.parse(data);
            }

            if (!Array.isArray(data)) data = [data];

            this.context.context.loadObjects({objects: data}).then(_ => self.loadDefaultPage());
        } catch (e) {
            Dialogs.show(`Failed to load annotations. The process did not finish, however, some might have been loaded.<br><code>${e}</code>`,
                5000, Dialogs.MSG_ERR);
            console.error(e);
        }
    }

    _parseXML(str) {
        // //todo parses incorrectly :/
        // let data = xmlToJSONMin.parseString(str);
        // let result = [];
        //
        // //data allways in an array
        // if (data.hasOwnProperty("Annotations")) {
        //     data = data.Annotations;
        //     for (let item of data[0]) {
        //         console.log(item[0]);
        //         result.push({
        //             type: "polygon",
        //             points: item[0].Coordinates
        //         })
        //     }
        // }
        // return result;
    }

};
