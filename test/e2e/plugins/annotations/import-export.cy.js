import {config, shaders} from "../../../fixtures/configurations"
import {default as utils} from "../../../support/utilities"
import helpers from "./helpers";
import {objects, presets} from "./templates";
import {default as elements} from "../../routines/basic-ui-elements";

describe('Annotations - User Controls', () => {

    let ANNOTATIONS;

    afterEach(() => {
        if (!ANNOTATIONS) return;
        //cleanup
        ANNOTATIONS.deleteAllAnnotations();
        ANNOTATIONS.presets.foreach(p => {
            ANNOTATIONS.presets.removePreset(p.presetID);
        });
    });

    helpers.setGeometryErrorThreshold(0.1); //pretty precise on IO operations (in image pixel space)

    it('Get reference', () => {

        let visualization = {
            params: config.params({
                viewport: config.viewport('tissue', 0)
            }),
            data: config.data('tissue'),
            background: config.background({}, 0),
            plugins: {
                gui_annotations: {
                    factories: ["polygon", "rect", "ellipse", "ruler"], //will force to load with
                    focusWithZoom: false                                //do not perform zooming since it might fail to compare visually
                }
            }
        }

        cy.launch(visualization);

        utils.waitForViewer().then(w => {
            ANNOTATIONS = w.OSDAnnotations.instance();
        });

        elements.closeDialog(); //preventive
    });

    function testSameContent(imageName, x) {
        cy.wait(500);

        cy.get("#advanced-menu-close-button").click();

        cy.canvas().matchImage({title: imageName});

        cy.get("#annotations-right-click").click();

        //todo upload of images does not work...

        //sorry I am learning japanese at the time, so I could not resist
        helpers.presetUiNthMetaContainer(2, 0).should('contain.html', 'はじめまして'); //nice to meet you
        helpers.presetUiNthMetaContainer(2, 1).should('contain.html', 'ねこ'); // 'neko' - cat
        helpers.presetUi(2).should('contain.text', 'Ruler');

        helpers.presetUiNthMetaContainer(1, 1).should('contain.html', 'Data');
        helpers.presetUi(1).should('contain.text', 'Ruler');

        helpers.presetUiNthMetaContainer(0, 0).should('contain.html', 'SOme');
        helpers.presetUi(0).should('contain.text', 'Polygon');

        helpers.presetUi(2).click();
        helpers.presetUiSelectRight().click();

        helpers.presetUiLeft().should('contain.html', 'SOme');
        return x;
    }

    function testSameObjects(x, presetsOnly=false, avoidsProps=[], avoidsTypes=[]) {
        if (!presetsOnly) {
            for (let i = 0; i < objects.length; i++) {
                const template = objects[i];
                if (avoidsTypes.includes(template.factoryID)) continue;

                const actual = ANNOTATIONS.canvas._objects[i];
                const cmp = helpers.checkObjectsError(template, actual, avoidsProps);
                const ok = cmp === undefined;
                expect(ok).to.equal(true, cmp
                    + " \n\nTemplate:" + JSON.stringify(template)
                    + `\n\nActual: [print ommited, get the object using OSDAnnotations.instance().canvas._objects[${i}]]`);
            }
        }

        for (let i = 0; i < presets.length; i++) {
            const template = presets[i];
            const actual = ANNOTATIONS.presets.get(template.presetID);
            const cmp = helpers.checkPrestsError(template, actual, avoidsProps);
            const ok = cmp === undefined;
            expect(ok).to.equal(true, cmp
                + " \n\nTemplate:" + JSON.stringify(template)
                + " \n\nActual:" + JSON.stringify(actual?.toJSONFriendlyObject()));
        }
        return x;
    }

    it ('Test Import All - native format', () => {
        cy.get("#show-annotation-export").click();

        cy.get("#native-export-format + label").click();

        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/native.all.json", {force: true});

        cy.then(x => testSameContent("1-import-all-native", x));
        cy.then(x => testSameObjects(x));
    });

    it ('Test Import Separate Import - native format', () => {
        cy.get("#show-annotation-export").click();

        cy.get("#native-export-format + label").click();

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/native.presets.json", {force: true});

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/native.objects.json", {force: true});

        cy.then(x => testSameContent("1-import-separate-native", x));
        cy.then(x => testSameObjects(x));
    });

    it ('Test cyclic re-import - native format', () => {
        cy.get("#show-annotation-export").click();
        cy.get("#native-export-format + label").click();
        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/native.all.json", {force: true});

        //download files disabled, not reliably working in cypress
        // cy.get("#geo-json-export-format + label").click();
        // cy.get("#downloadAnnotation").click();
        //refresh
        cy.then(async x => {
            const data = await ANNOTATIONS.export({format: "native"});

            ANNOTATIONS.deleteAllAnnotations();
            ANNOTATIONS.presets.foreach(p => {
                ANNOTATIONS.presets.removePreset(p.presetID);
            });

            ANNOTATIONS.import(data, {format: "native"});

            return x;
        })
        //import
        // cy.get("#importAnnotation").next("input").selectFile(
        //     "test/downloads/" + ANNOTATIONS.defaultFileNameFor("geo-json"), {force: true});

        cy.then(x => testSameContent("1-import-export-native", x));
        cy.then(x => testSameObjects(x));
    });

    it ('Test Import All - GeoJSON', () => {
        //images not tested yet  - export and import does not work

        cy.get("#show-annotation-export").click();

        cy.get("#geo-json-export-format + label").click();

        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/geojson.all.json", {force: true});

        cy.then(x => testSameContent("2-import-all-geojson", x));
        //avoid testing layer ID, not preserved
        cy.then(x => testSameObjects(x, false, ['layerID']));
    });

    it ('Test Import Separate Import - GeoJSON', () => {
        cy.get("#show-annotation-export").click();

        cy.get("#geo-json-export-format + label").click();

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/geojson.presets.json", {force: true});

        cy.then(x => testSameContent("2-import-presets-geojson", x));
        //avoid testing layer ID, not preserved
        cy.then(x => testSameObjects(x, true, ['layerID']));
    });

    it ('Test cyclic re-import - GeoJSON', () => {
        cy.get("#show-annotation-export").click();
        cy.get("#native-export-format + label").click();
        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/native.all.json", {force: true});

        //test
        cy.then(async x => {
            const data = await ANNOTATIONS.export({format: "geo-json"});

            ANNOTATIONS.deleteAllAnnotations();
            ANNOTATIONS.presets.foreach(p => {
                ANNOTATIONS.presets.removePreset(p.presetID);
            });

            ANNOTATIONS.import(data, {format: "geo-json"});

            return x;
        })

        cy.then(x => testSameContent("2-import-export-geojson", x));
        cy.then(x => testSameObjects(x));
    });

    function testQuPath(imageName, x) {
        cy.wait(500);
        cy.get("#advanced-menu-close-button").click();

        cy.canvas().matchImage({title: imageName});

        cy.get("#annotations-right-click").click();
        //preset #2 is on position 1 and vice versa (object loaded in this order, presets created on objects)
        helpers.presetUiNthMetaContainer(1, 0).should('contain.html', 'はじめまして');
        //only category names are preserved
        // helpers.presetUiNthMetaContainer(1, 1).should('contain.html', 'ねこ');
        helpers.presetUi(1).should('contain.text', 'Ruler');

        //not preserved
        // helpers.presetUiNthMetaContainer(2, 1).should('contain.html', 'Data');
        helpers.presetUi(2).should('contain.text', 'Ruler');

        helpers.presetUiNthMetaContainer(0, 0).should('contain.html', 'SOme');
        helpers.presetUi(0).should('contain.text', 'Polygon');

        helpers.presetUi(1).click();
        helpers.presetUiSelectRight().click();

        helpers.presetUiLeft().should('contain.html', 'SOme');

        //avoid testing manually, too different
        //cy.then(x => testSameObjects(x, false, ['layerID', 'presetID'], ['text', 'ruler', 'rect', 'ellipse']));
        return x;
    }

    it ('Test Import All - QuPath', () => {
        //images not tested yet  - export and import does not work

        cy.get("#show-annotation-export").click();

        cy.get("#qupath-export-format + label").click();

        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/qupath.all.json", {force: true});

        cy.then(x => testQuPath("3-import-all-qupath", x));
    });

    // Presets alone not tested, not possible
    // it ('Test Import Separate Import - QuPath', () => {
    // });

    it ('Test cyclic re-import - QuPath', () => {
        cy.get("#show-annotation-export").click();

        cy.get("#native-export-format + label").click();

        //import
        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/native.all.json", {force: true});


        cy.get("#qupath-export-format + label").click();
        cy.get("#downloadAnnotation").click();

        //test
        cy.then(async x => {
            const data = await ANNOTATIONS.export({format: "qupath",
                imageCoordinatesOffset: {x:0, y:0}, trimToDefaultPresets: false});

            ANNOTATIONS.deleteAllAnnotations();
            ANNOTATIONS.presets.foreach(p => {
                ANNOTATIONS.presets.removePreset(p.presetID);
            });

            ANNOTATIONS.import(data, {format: "qupath"});
            return x;
        })

        cy.then(x => testQuPath("3-import-export-qupath", x));
    });
});
