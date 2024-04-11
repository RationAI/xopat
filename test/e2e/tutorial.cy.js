import {config, shaders} from "../fixtures/configurations"
import {testBasic, testElements} from "./routines"
import {default as utils} from "../support/utilities"


function tutorialStep() {
    cy.wait(500);
    cy.get(".enjoyhint_next_btn", {timeout: 1000}).click();
}

describe('Basic Tutorial Walkthrough Without Layers But With Many Backgrounds', () => {
    it('Init', () => {
        let visualization = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
                stackedBackground: true
            }),
            data: config.data('tissue'),
            background: config.background({}, 0, 1, 2),
        }

        cy.launch(visualization);
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
        cy.wait(500);
        cy.get("#images-pin", {timeout: 1000}).click();
        tutorialStep(); //stacked images menu
        tutorialStep(); //url
        tutorialStep(); //finish
        cy.get('#tutorials-container', {timeout: 1000}).should('not.be.visible');
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('not.exist');
    })
})

describe('Basic Tutorial Walkthrough Without Stacked Backgrounds', () => {
    it('Init', () => {
        let visualization = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
                stackedBackground: false
            }),
            data: config.data('tissue'),
            background: config.background({}, 0, 1, 2),
        }

        cy.launch(visualization);
        utils.waitForViewer();

        cy.get("#global-help").click();
        cy.get("#tutorials").children().eq(0).click();
    })

    it('Main Panel', () => {
        tutorialStep(); //panel
        tutorialStep(); //navigator
        tutorialStep(); //global controls
        tutorialStep(); //tollbar stacked
        tutorialStep(); //url
        tutorialStep(); //export
        cy.get('#tutorials-container', {timeout: 1000}).should('not.be.visible');
        cy.get(".enjoyhint_next_btn", {timeout: 1000}).should('not.exist');
    })
})

describe('Basic Tutorial Walkthrough With Layer', () => {
    it('Init', () => {
        let visualization = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
            }),
            data: config.data('tissue'),
            background: config.background({}, 0),
            visualizations: [config.visualization({"name":"Standard visualization.",},
                shaders.bipolarHeatmap({}, 3)
            )],
        }

        cy.launch(visualization);

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
