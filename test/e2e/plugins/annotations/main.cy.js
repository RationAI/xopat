import {config, shaders} from "../../../fixtures/configurations"
import {default as utils} from "../../../support/utilities"
import {default as elements} from "../../routines/basic-ui-elements"
import helpers from "./helpers";

describe('Annotations - User Controls', () => {

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
                    factories: ["polygon", "rect", "ellipse", "ruler", "point", "polyline", "text"], //load force order
                    focusWithZoom: false,  //do not perform zooming since it might fail to compare visually
                    modalHistoryWindow: false, //attach board to the menu so that we can easily access it
                }
            }
        }

        cy.launch(visualisation);

        utils.waitForViewer().then(w => {
            ANNOTATIONS = w.OSDAnnotations.instance();
        });
    });


    it ('Test Hotkeys', () => {
        elements.closeDialog(); //preventive

        expect(ANNOTATIONS.mode, "Annotations are in Auto Mode").eq(ANNOTATIONS.Modes.AUTO);
        helpers.ALTdown().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);
        helpers.ALTup().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    });

    it ('Setup Presets', () => {
        elements.openMenuArrow("#shaders-pin", false);

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

        helpers.presetUISelect(1).select(2);
        helpers.presetUiNthMeta(1, 0).type("Ctverecek");

        helpers.presetUiNewMetaName(2).type("Empty meta");
        helpers.presetUiNewMetaButton(2).click();
        helpers.presetUiNewMetaName(2).type("Another Empty");
        helpers.presetUiNewMetaButton(2).click();
        helpers.presetUISelect(2).select(1);

        helpers.presetUISelect(3).select(3);

        helpers.presetUi(1).click();
        helpers.presetUiSelectRight().click();

        cy.get("#annotations-left-click").should('contain.text', 'Polygon');
        cy.get("#annotations-right-click").should('contain.text', 'Ctverecek');
    });

    //preset index and factory index (factories array)
    function selectPresetFactory(preset, factory) {
        cy.get("#annotations-left-click").click();
        helpers.presetUi(preset).click();
        helpers.presetUISelect(preset).select(factory);
        helpers.presetUiSelectLeft().click();
    }


    it ("Preset RightClick#1", function () {
        helpers.ALTdown().draw(cy.get('#osd'), {x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130});
        cy.canvas().matchImage({title: "S1 - polygon"});
        helpers.ALTup();

        cy.canvas().matchImage({title: "S1 - polygon finished"});
        cy.wrap(ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
    })

    it ("Preset LeftClick#2", function () {
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.drawRight(cy.get('#osd'), {x: 200, y: 200}, {x: 20, y: 220},{x: 220, y: 240},{x: 220, y: 20});

        cy.canvas().matchImage({title: "S2 - polygon, ellipse"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("History Undo n Redo", function () {
        cy.keyDown("Ctrl", {ctrlKey: true})
        cy.key("z", {ctrlKey: true})
            .then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
        cy.wait(150)

        cy.canvas().matchImage({title: "S3 - undo"}); //ellipse should be gone

        cy.keyDown("Shift", {ctrlKey: true, shiftKey: true})
        cy.key("Z", {ctrlKey: true, shiftKey: true}).then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)

        cy.wait(300)
        cy.canvas().matchImage({title: "S4 - redo"}); //ellipse should be back

        //lift ctrl, no actions will now make history work
        cy.keyUp("Ctrl", {shiftKey: true})
        cy.key("Z", {shiftKey: true}).then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);

        cy.keyUp("Shift")
        cy.key("z").then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO)
            .then(() => ANNOTATIONS.canvas._objects.length).should('eq', 2);
        cy.canvas().matchImage({title:  "S4 - redo"}); //ellipse should be still here
    })

    it ("Preset #3", function () {
        selectPresetFactory(3, 3);
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.drawRight(cy.get('#osd'), {x: 500, y: 500}, {x: 520, y: 550});

        cy.canvas().matchImage({title: "S5 - ruler"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("Preset Set ruler and draw", function () {
        selectPresetFactory(3, 3);
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.draw(cy.get('#osd'), {x: 500, y: 500}, {x: 520, y: 550});

        cy.canvas().matchImage({title: "S5 - ruler"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("Preset Set point and draw", function () {
        selectPresetFactory(3, 4);
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.draw(cy.get('#osd'), {x: 420, y: 180});

        cy.canvas().matchImage({title: "S5 - ruler"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("Preset Set polyline and draw", function () {
        selectPresetFactory(1, 5);
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.draw(cy.get('#osd'), {x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130});

        cy.canvas().matchImage({title: "S5 - ruler"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

    it ("Preset Set text and draw", function () {
        selectPresetFactory(1, 5);
        cy.get("#annotations-tool-bar-tools-panel label[for=custom-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);

        cy.draw(cy.get('#osd'), {x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130});

        cy.canvas().matchImage({title: "S5 - ruler"});
        cy.get("#annotations-tool-bar-tools-panel label[for=auto-annotation-mode]").click().then(_ => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
    })

});