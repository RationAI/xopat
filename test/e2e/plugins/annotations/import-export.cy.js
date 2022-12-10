import {config, shaders, withBrowser} from "../../../fixtures/configurations"
import {testBasic, testElements} from "./../../routines"
import {default as utils} from "../../../support/utilities"
import helpers from "./helpers";

describe('Annotations - User Controls', withBrowser, () => {

    let ANNOTATIONS;

    afterEach(() => {
        //cleanup
        ANNOTATIONS.deleteAllAnnotations();
        ANNOTATIONS.presets.foreach(p => {
            ANNOTATIONS.presets.removePreset(p.presetID);
        });
    });

    it('Get reference', () => {

        let visualisation = {
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

        cy.launch(visualisation);

        utils.waitForViewer().then(w => {
            ANNOTATIONS = w.OSDAnnotations.instance();
        });
    });

    function testSameContent() {
        cy.wait(500);

        cy.get("#advanced-menu-close-button").click();

        cy.canvas().matchImage({title: "IO Test - should be all same images."});

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
    }

    it ('Test Import All - native format', () => {
        //images not tested yet  - export and import does not work

        cy.get("#annotations-cloud").click();

        cy.get("#gui-annotations-io-format").select("native");
        cy.get("#gui-annotations-io-flags").select("everything");

        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/native.all.json", {force: true});

        testSameContent("native");
    });

    it ('Test Import Separate Import - native format', () => {
        cy.get("#annotations-cloud").click();

        cy.get("#gui-annotations-io-format").select("native");
        cy.get("#gui-annotations-io-flags").select("presets");

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/native.presets.json", {force: true});

        cy.get("#gui-annotations-io-flags").select("annotations");

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/native.objects.json", {force: true});

        testSameContent("native");
    });

    it ('Test Import All - GeoJSON', () => {
        //images not tested yet  - export and import does not work

        cy.get("#annotations-cloud").click();

        cy.get("#gui-annotations-io-format").select("geo-json");
        cy.get("#gui-annotations-io-flags").select("everything");

        cy.get("#importAnnotation").next("input").selectFile(
            "test/fixtures/plugins/annotations/geojson.all.json", {force: true});

        testSameContent("geo-json");
    });

    it ('Test Import Separate Import - GeoJSON', () => {
        cy.get("#annotations-cloud").click();

        cy.get("#gui-annotations-io-format").select("geo-json");
        cy.get("#gui-annotations-io-flags").select("presets");

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/geojson.presets.json", {force: true});

        cy.get("#gui-annotations-io-flags").select("annotations");

        cy.get("#importAnnotation").next("input").selectFile("test/fixtures/plugins/annotations/geojson.objects.json", {force: true});

        testSameContent("geo-json");
    });
});