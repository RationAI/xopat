import {config, shaders, withBrowser} from "../fixtures/configurations"
import {testBasic, testElements} from "./routines"
import {default as utils} from "../support/utilities"


//todo does not work in cypress broken tutorial  libs
function tutorialStep() {
    cy.wait(500);
    cy.get(".enjoyhint_next_btn", {timeout: 1000}).click();
}

describe('Basic Tutorial Walkthrough Without Layers But With Many Backgrounds', withBrowser, () => {


    it('Init', () => {
        let visualisation = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
                stackedBackground: true
            }),
            data: config.data('tissue'),
            background: config.background({}, 0, 1, 2),
        }

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#global-help").click();
        cy.get("#tutorials").children().eq(0).click();
    })

    it('BTutorial Movement', () => {
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('be.visible');
        cy.key("ArrowUp");

        cy.key("Add");
        cy.key("ArrowRight");
        cy.key("Subtract");
    })

    it('Main Panel', () => {
        tutorialStep(); //panel
        tutorialStep(); //navigator
        tutorialStep(); //global controls
        tutorialStep(); //bottom image swap
        cy.wait(500);
        cy.get("#images-pin", {timeout: 1000}).click();
        tutorialStep(); //stacked images menu
        tutorialStep(); //url
        tutorialStep(); //export
        tutorialStep(); //finish
        cy.get('#tutorials-container', {timeout: 1000}).should('not.be.visible');
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('not.exist');
    })
})

describe('Basic Tutorial Walkthrough With Layer', withBrowser, () => {
    it('Init', () => {
        let visualisation = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
            }),
            data: config.data('tissue'),
            background: config.background({}, 0),
            visualizations: [config.visualization({"name":"Standard visualization.",},
                shaders.bipolarHeatmap({}, 3)
            )],
        }

        cy.launch(visualisation);

        cy.get("#global-help").click();
        cy.get("#tutorials").children().eq(0).click();
    })

    it('BTutorial Movement', () => {
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('be.visible');
        cy.key("ArrowUp");

        cy.key("Add");
        cy.key("ArrowRight");
        cy.key("Subtract");
        tutorialStep(); //navigation
    })

    it('Main Panel', () => {
        tutorialStep(); //panel
        tutorialStep(); //navigator
        tutorialStep(); //global controls
        tutorialStep(); //global controls #2
        tutorialStep(); //bottom image swap
        tutorialStep(); //data layer explanation
        cy.wait(500);
        cy.get("#shaders-pin", {timeout: 1000}).click();
        tutorialStep(); //data layer explanation #2
        tutorialStep(); //render layers explanation
        tutorialStep(); //url
        tutorialStep(); //export
        tutorialStep(); //finish
        tutorialStep(); //finish
        cy.get('#tutorials-container', {timeout: 1000}).should('not.be.visible');
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('not.exist');
    })
})
