import {config, shaders, withBrowser} from "../../../fixtures/configurations"
import {default as utils} from "../../../support/utilities"
import helpers from "./helpers";

describe('Annotations - User Controls', withBrowser, () => {

    //tested: ["polygon", "rect", "ellipse", "ruler"]

    let ANNOTATIONS;

    it('Get reference', () => {

        let visualisation = {
            params: config.params({
                viewport: config.viewport('tissue', 0)
            }),
            data: config.data('tissue'),
            background: config.background({}, 0),
            visualizations: [config.visualization({"name":"Standard visualization.",},
                shaders.heatmap({}, 2),
                shaders.bipolarHeatmap({}, 3),
                shaders.edge({}, 1)
            )],
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


    it ('Test Hotkeys', () => {
        expect(ANNOTATIONS.mode, "Annotations are in Auto Mode").eq(ANNOTATIONS.Modes.AUTO);
        helpers.ALTdown().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);
        helpers.ALTup().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    });

    it ('Setup Presets', () => {

        cy.get("#annotations-cloud").should('be.visible')
        cy.get("#show-annotation-board").should('be.visible')
        cy.get("#enable-disable-annotations").should('be.visible')

        cy.get("#annotations-left-click").click();
        cy.get("#preset-add-new").click();
        cy.get("#preset-add-new").click();
        cy.get("#preset-add-new").click();
        cy.get("#preset-add-new").click();

        helpers.presetUiNewMetaName(0).type("My New Awesome Meta");
        helpers.presetUiNewMetaButton(0).click();
        helpers.presetUiNthMeta(0, 1).type("The AWESOME Value");

        helpers.presetUISelect(1).select(1);
        helpers.presetUiNthMeta(1, 0).type("Ctverecek");

        helpers.presetUiNewMetaName(2).type("Empty meta");
        helpers.presetUiNewMetaButton(2).click();
        helpers.presetUiNewMetaName(2).type("Another Empty");
        helpers.presetUiNewMetaButton(2).click();
        helpers.presetUISelect(2).select(2);

        helpers.presetUISelect(3).select(3);

        helpers.presetUi(1).click();
        helpers.presetUiSelectRight().click();

        cy.get("#annotations-left-click").should('contain.text', 'Polygon');
        cy.get("#annotations-right-click").should('contain.text', 'Ctverecek');
    });


    it ("Preset #1", function () {
        helpers.ALTdown().draw(cy.get('#osd'), {x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130});
        cy.canvas().matchImage({title: "S1 - polygon"});

        helpers.ALTup();

        cy.canvas().matchImage({title: "S1 - polygon finished"});
        cy.wrap(ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
    })

    it ("Preset #2", function () {
        cy.get("#annotations-tool-bar label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.drawRight(cy.get('#osd'), {x: 200, y: 200}, {x: 20, y: 220},{x: 220, y: 240},{x: 220, y: 20});

        cy.canvas().matchImage({title: "S2 - polygon, ellipse"});
        cy.get("#annotations-tool-bar label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("History Undo n Redo", function () {
        cy.keyDown("Ctrl", {ctrlKey: true})
        cy.key("z", {ctrlKey: true})
            .then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
        cy.wait(150)

        cy.canvas().matchImage({title: "S3 - undo"});

        cy.keyDown("Shift", {ctrlKey: true, shiftKey: true})
        cy.key("Z", {ctrlKey: true, shiftKey: true}).then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)

        cy.wait(300)
        cy.canvas().matchImage({title: "S4 - redo"});

        cy.keyUp("Ctrl", {shiftKey: true})
        cy.key("Z", {shiftKey: true}).then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);

        cy.keyUp("Shift")
        cy.key("z").then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
            .then(() => ANNOTATIONS.canvas._objects.length).should('eq', 2);
        cy.canvas().matchImage({title:  "S4 - redo"});
    })
});