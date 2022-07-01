/**
 * Matrix view for annotations, not yet implemented
 */
AnnotationsGUI.Previewer = class {

    constructor(selfName, context) {
        this.context = context;
        this.self = context.id + '.' + selfName;
        USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-preview", "Preview",
            `<button class="btn" onclick="${this.self}.load();">Load previews</button><div id="preview-of-annotations"></div>`);
        this._previews = {};
    }

    async load() {
        const container = $("preview-of-annotations");
        container.html("");
        //todo let the user chose? or render both?
        let tiledImage = VIEWER.bridge.getTiledImage();
        for (let object of this.context.context.canvas.getObjects()) {
            let factory = this.context.context.getAnnotationObjectFactory(object.factoryId);
            if (factory) {
                container.append(`
<div onclick="${this.context.id}.context.focusObject(${factory.getObjectFocusZone(object)});" style="" class="d-inline-block">Click me</div>
            `);
            }
        }
    }
};
