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

const annotationObjects = (predicateFunName, predicate) => {
    return cy.window().then(w => w.annotations.canvas._objects)[predicateFunName](predicate);
}



describe('Annotations - User Controls', withBrowser, () => {

    //tested: ["polygon", "rect", "ellipse", "ruler"]

    it('Setup Presets', () => {

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
                    //will force to load with
                    factories: ["polygon", "rect", "ellipse", "ruler"]
                }
            }
        }

        cy.launch(visualisation);
        utils.waitForViewer();

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
        let polypoints = [{x: 100, y: 100}, {x: 80, y: 120},{x: 220, y: 140},{x: 120, y: 70},{x: 80, y: 130}];
        cy.keyDown("{alt}");
        cy.draw(cy.get('#osd'), ...polypoints);
        cy.keyUp("{alt}");

        cy.get('#osd').toMatchImageSnapshot();
    })
});