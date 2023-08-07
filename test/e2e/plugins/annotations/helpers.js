export default {
    presetUi: (presetIndex) => cy.get("#preset-no-" + presetIndex),
    presetUiColor: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(1).find("input"),
    presetUISelect: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(0).find("select"),
    presetUiNthMetaContainer: (presetIndex, metaIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(metaIndex + 2),
    presetUiNthMeta: (presetIndex, metaIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(metaIndex + 2).find("input"),
    presetUiNewMetaName: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children().last().find("input"),
    presetUiNewMetaButton: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children().last().find("span"),
    presetUiSelectLeft: () => cy.get("#select-annotation-preset-left"),
    presetUiSelectRight: () => cy.get("#select-annotation-preset-right"),
    presetUiLeft: () => cy.get("#annotations-left-click"),
    presetUiRight: () => cy.get("#annotations-right-click"),

    ALTdown: () => cy.keyDown("Alt", {altKey: true, focusCanvas: true}),
    ALTup: () => cy.keyUp("Alt", {altKey: true, focusCanvas: true}),

    /*
     * Compare methods return error message in case of issue
     */

    checkPropertyError(template, actual, name) {
        if (!actual) actual = {};
        if (template[name]) {
            if (typeof template[name] !== typeof actual[name]) {
                return `Template ${name} '${template[name]}' (${typeof template[name]}) 
differ in type from actual ${name} '${actual[name]}' (${typeof actual[name]})`;
            }

            if (template[name] !== actual[name]) {
                return `Template ${name} '${template[name]}' differs from actual ${name} '${actual[name]}'`;
            }
            return 0;
        }
        return actual[name] ?
            `Template ${name} '${template[name]}' differs from actual ${name} '${actual[name]}'` : 0;
    },

    checkPointError(tp, ap, details) {
        if (Math.abs(tp.x - ap.x) > 0.1 || Math.abs(tp.y - ap.y) > 0.1) {
            return `Pointwise comparison: differs at ${details} - template: [${Object.values(tp).join(",")}] | actual: [${Object.values(ap).join(",")}]`;
        }
        return 0;
    },

    checkObjectGeometryError(template, actual, ignoreTextual=false) {
        if (template.type === "group") {
            for (let i = 0; i < template.objects.length; i++) {
                //ignore textual data comparison, which get updated based on the project
                const message = this.checkObjectGeometryError(template.objects[i], actual._objects[i],
                    template.factoryID === "ruler");
                if (message) return "Group child objects are not equal: " + message;
            }
            return 0;
        }

        if (template.points) {
            if (template.points.length !== actual.points.length) {
                return "Template has points array, but its length differs from rendered object points length!";
            }

            for (let i = 0; i < template.points.length; i++) {
                const msg = this.checkPointError(template.points[i], actual.points[i], `position ${i}`);
                if (msg) return msg;
            }
        }

        if (!ignoreTextual && template.text && template.text !== actual.text) {
            return `Template text '${template.text}' differs from actual text '${actual.text}'`;
        }

        if (!ignoreTextual && template.measure && template.measure !== actual.measure) {
            return `Template measure '${template.measure}' differs from actual measure '${actual.measure}'`;
        }

        if (template.autoScale !== undefined && template.autoScale
                && Math.round(template.fontSize) !== Math.round(actual.fontSize)) {
            return `Template measure '${template.measure}' differs from actual measure '${actual.measure}'`;
        }

        if (template.left) {
            const msg = this.checkPointError({x:template.left, y:template.top},
                {x:actual.left, y:actual.top}, `[left, top] coords`);
            if (msg) return msg;
        }

        if (template.width) {
            const msg = this.checkPointError({x:template.width, y:template.height},
                {x:actual.width, y:actual.height}, `[width, height] dims`);
            if (msg) return msg;
        }

        if (template.rx) {
            const msg = this.checkPointError({x:template.rx, y:template.ry},
                {x:actual.rx, y:actual.ry}, `[rx, ry] dims`);
            if (msg) return msg;
        }

        if (template.x1) {
            const msg = this.checkPointError({x:template.x1, y:template.y1},
                {x:actual.x1, y:actual.y1}, `[x1, y1] position`);
            if (msg) return msg;
        }

        if (template.x2) {
            const msg = this.checkPointError({x:template.x2, y:template.y2},
                {x:actual.x2, y:actual.y2}, `[x2, y2] position`);
            if (msg) return msg;
        }
    },

    checkPresetMetaError(template, actual) {
        for (let key in template) {
            let msg = this.checkPropertyError(template[key], actual[key], 'name');
            if (msg) return msg;
            msg = this.checkPropertyError(template[key], actual[key], 'value');
            if (msg) return msg;
        }
    },

    checkPrestsError(template, actual, avoid=[]) {
        let msg = this.checkPropertyError(template, actual, 'color');
        if (msg && !avoid.includes('color')) return msg;
        //factoryID replaced with objectFactory live reference
        msg = this.checkPropertyError(template, actual.objectFactory, 'factoryID');
        if (msg && !avoid.includes('factoryID')) return msg;
        msg = this.checkPropertyError(template, actual, 'presetID');
        if (msg && !avoid.includes('presetID')) return msg;

        msg = this.checkPresetMetaError(template.meta, actual.meta);
        if (msg) return msg;
        return undefined;
    },

    checkObjectsError(template, actual, avoid=[]) {
        let msg = this.checkPropertyError(template, actual, 'factoryID');
        if (msg && !avoid.includes('factoryID')) return msg;
        msg = this.checkPropertyError(template, actual, 'type');
        if (msg && !avoid.includes('type')) return msg;
        msg = this.checkPropertyError(template, actual, 'presetID');
        if (msg && !avoid.includes('presetID')) return msg;
        msg = this.checkPropertyError(template, actual, 'layerID');
        if (msg && !avoid.includes('layerID')) return msg;

        msg = this.checkObjectGeometryError(template, actual);
        if (msg) return msg;
        return undefined;
    },
}
