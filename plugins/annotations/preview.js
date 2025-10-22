/**
 * Matrix view for annotations, not yet implemented
 */
AnnotationsGUI.Previewer = class {

    constructor(selfName, context) {
        this.context = context;
        this.self = `plugin('${context.id}').${selfName}`;
        USER_INTERFACE.AppBar.Plugins.setMenu(this.context.id, "annotations-preview", "Preview",
            `<h3 class="f2-light">Fast Previews</h3><button class="btn float-right" onclick="${this.self}.load();">Reload previews</button><br>
<p>Inspect existing annotations one by one on a single page. Note that the annotation itself is not drawn (defaults to the whole image rectangle).</p>
<div id="preview-of-annotations" class="p-2">No previews were loaded yet.</div>`);
        this._previews = {};
    }

    async load() {
        const container = $("#preview-of-annotations");
        container.html("");
        let counter = 0;
        for (let object of this.context.context.canvas.getObjects()) {
            let factory = this.context.context.getAnnotationObjectFactory(object.factoryID);
            if (factory) {
                let name = this.context.context.getAnnotationDescription(object);
                let bbox = factory.getObjectFocusZone(object);

                //todo hardcoded assets path
                container.append(`
<div onclick="${this.self}.context.context.focusObjectOrArea({left: ${bbox.left}, top: ${bbox.top}, 
width: ${bbox.width}, height: ${bbox.height}}, ${object.incrementId});" class="d-inline-block pointer text-center">
<img alt="preview" width="120" height="120" data-left="${bbox.left}" data-top="${bbox.top}" id="matrix-${counter}-annotation-preview"
data-width="${bbox.width}" data-height="${bbox.height}" src="./src/assets/image.png"><br>${name}
</div>
            `);
                counter++;
            }
        }
        this.loadImagesRecursive(0, counter, 8);
    }

    loadImagesRecursive(step, maxSteps, batchSize) {
        if (step >= maxSteps) return;

        let progress = batchSize;
        const self = this;
        function render(thisStep) {
            let image = document.getElementById(`matrix-${thisStep}-annotation-preview`);
            if (!image) {
                progress--;
                return;
            }

            const region = {
                x: Number.parseInt(image.dataset.left) || 0,
                y: Number.parseInt(image.dataset.top) || 0,
                width: Number.parseInt(image.dataset.width) || 0,
                height: Number.parseInt(image.dataset.height) || 0
            };
            const outputSize = {width: Math.round(region.width / region.height * 120), height: 120};

            VIEWER.tools.offlineScreenshot(region, outputSize, (canvas) => {
                let image = document.getElementById(`matrix-${thisStep}-annotation-preview`);
                if (image) {
                    image.src = canvas.toDataURL();
                    image.width = outputSize.width;
                }
                progress--;
                if (progress < 1) {
                    self.loadImagesRecursive(step+batchSize, maxSteps, batchSize);
                }
            }, outputSize);
        }

        for (let i = 0; i < batchSize; i++) {
            render(step + i);
        }
    }
};
