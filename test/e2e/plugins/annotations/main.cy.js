import {config, shaders, withBrowser} from "../../../fixtures/configurations"
import {testBasic, testElements} from "./../../routines"
import {default as utils} from "../../../support/utilities"

const presetUi = (presetIndex) => cy.get("#preset-no-" + presetIndex);
const presetUiColor = (presetIndex) =>
    cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(1).find("input");
const presetUISelect = (presetIndex) =>
    cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(0).find("select");
const presetUiNthMeta = (presetIndex, metaIndex) =>
    cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(metaIndex + 2).find("input");
const presetUiNewMetaName = (presetIndex) =>
    cy.get("#preset-no-" + presetIndex).children().last().find("input");
const presetUiNewMetaButton = (presetIndex) =>
    cy.get("#preset-no-" + presetIndex).children().last().find("span");
const presetUiSelectLeft = () => cy.get("#select-annotation-preset-left");
const presetUiSelectRight = () => cy.get("#select-annotation-preset-right");

const ALTdown = () => cy.keyDown("Alt", {altKey: true})
const ALTup = () => cy.keyUp("Alt", {altKey: true})


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
        ALTdown().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.CUSTOM);
        ALTup().then(() => ANNOTATIONS.mode).should('eq', ANNOTATIONS.Modes.AUTO);
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

        presetUiNewMetaName(0).type("My New Awesome Meta");
        presetUiNewMetaButton(0).click();
        presetUiNthMeta(0, 1).type("The AWESOME Value");

        presetUISelect(1).select(1);
        presetUiNthMeta(1, 0).type("Ctverecek");

        presetUiNewMetaName(2).type("Empty meta");
        presetUiNewMetaButton(2).click();
        presetUiNewMetaName(2).type("Another Empty");
        presetUiNewMetaButton(2).click();
        presetUISelect(2).select(2);

        presetUISelect(3).select(3);

        presetUi(1).click();
        presetUiSelectRight().click();

        cy.get("#annotations-left-click").should('contain.text', 'Polygon');
        cy.get("#annotations-right-click").should('contain.text', 'Ctverecek');
    });


    it ("Preset #1", function () {
        ALTdown().draw(cy.get('#osd'), {x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130});
        cy.canvas().matchImage({title: "S1 - polygon"});

        ALTup()

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