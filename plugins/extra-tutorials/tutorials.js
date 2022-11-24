addPlugin("extra-tutorials", class {
    constructor(id, params) {
        this.id = id;
        this.PLUGIN = `plugin('${id}')`;
        this.data = params.data || [];
    }

    pluginReady() {
        let selection;
        for (let t of this.data) {
            try {
                let name = t.title;
                if (name && t.attach) {
                    USER_INTERFACE.Tutorials.add(this.id, name, t.description || "", "", t.content);
                }
                if (!selection && t.runDelay) selection = t;
            } catch (e) {
                console.error(e);
                //do not prevent from initialization
            }
        }
        if (selection) {
            try {
                setTimeout(() => USER_INTERFACE.Tutorials.run(selection.content), Math.max(selection.runDelay || 0, 250))
            } catch (e) {
                console.error(e);
                //do not prevent from initialization
            }
        }
    }
});
