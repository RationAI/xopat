import {config, shaders, withBrowser} from "../fixtures/configurations"
import {testBasic, testElements} from "./routines"
import {default as utils} from "../support/utilities"

describe('Third party pyramidal image', withBrowser, () => {
    it('Background only: custom protocol', () => {
        let visualisation = {
            params: config.params({viewport: config.viewport('book', 0)}),
            data: config.data('book'),
            background: config.background({protocol: "data"}, 0)
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        testBasic.mainMenu(visualisation);
        cy.canvas().matchImage(); //do not move the call, screenshot comparison

        testBasic.shadersMainMenu(visualisation);

        visualisation = {
            params: visualisation.params,
            data: config.data('book'),
            background: config.background({"protocol": "data"}, 0),
            visualizations: [config.visualization({
                "name":"The book is rendered twice, once as overlay.",
                "protocol":"data[0]",
            }, shaders.heatmap({}, 0))
            ]
        }

        cy.window().then(window => {
            window.APPLICATION_CONTEXT.prepareViewer(
                visualisation.data,
                visualisation.background,
                visualisation.visualizations
            );
        });

        utils.waitForViewer();
        testBasic.mainMenu(visualisation);
        testBasic.shadersMainMenu(visualisation);
        testBasic.settingsMenu(visualisation);
    })
})


describe('Faulty data', withBrowser, () => {
    it('No valid image in normal mode', () => {
        let visualisation = {
            params: config.params(),
            data: config.data('invalid'),
            background: config.background({}, 0)
        };

        cy.launch(visualisation);
        utils.waitForViewer();
        cy.get("#tissue-title-header").should('contain.text', "Faulty")
    })

    it('Valid background, invalid layers', () => {
        let visualisation = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 0), shaders.identity({}, 1))
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        testElements.systemNotification("Failed to load overlays");
        testBasic.mainMenu(visualisation);
    })

    it('Valid layers, invalid background', () => {
        let visualisation = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1),
            visualizations: [
                config.visualization({}, shaders.identity({}, 0))
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#global-tissue-visibility").should('not.be.visible');
        testBasic.settingsMenu(visualisation);
    })

    it('Valid and invalid background, invalid layers, side-by-side mode, invalid first.', () => {
        let visualisation = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#tissue-title-header").should('contain.text', "Faulty")
        testElements.getSwapBackgroundPlaceholder(1).click();
        utils.waitForViewer(false);
        cy.get("#tissue-title-header").should('not.contain.text', "Faulty")
    })

    it ('Stacked mode three layers', () => {
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

        cy.get("#images-pin").click();
        cy.get("#image-layer-options").children().should('have.length', 3)
            .should('contain.text', 'tissue')
            .should('contain.text', 'annotation')
            .should('contain.text', 'probability')
            .should('not.contain.text', 'Faulty');
    })

    it('Stacked mode no valid data.', () => {
        let visualisation = {
            params: config.params({
                stackedBackground: true
            }),
            data: config.data('invalid'),
            background: config.background({}, 0, 1),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#images-pin").click();

        //first shown is the last rendered - the most visible
        testElements.getStackedImageMenuItem(0).find("input[type=checkbox]").should('not.be.checked')
        testElements.getStackedImageMenuItem(0).should('contain.text', 'Faulty')

        testElements.getStackedImageMenuItem(1).find("input[type=checkbox]").should('not.be.checked')
        testElements.getStackedImageMenuItem(1).should('contain.text', 'Faulty')
        cy.get("#images-pin").click();

        cy.get("#tissue-title-header").should('contain.text', "Faulty")
    })

    it('Valid and invalid background, invalid layers, stacked mode, invalid first.', () => {
        let visualisation = {
            params: config.params({
                stackedBackground: true
            }),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#images-pin").click();

        //first shown is the last rendered - the most visible
        testElements.getStackedImageMenuItem(1).find("input[type=checkbox]").should('be.checked')
        testElements.getStackedImageMenuItem(1).should('not.contain.text', 'Faulty')

        testElements.getStackedImageMenuItem(0).find("input[type=checkbox]").should('not.be.checked')
        testElements.getStackedImageMenuItem(0).should('contain.text', 'Faulty')
        cy.get("#images-pin").click();

        testBasic.mainMenu(visualisation);
    })
})

