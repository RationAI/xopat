import {config, shaders} from "../fixtures/configurations"
import {testBasic, testElements} from "./routines"
import {default as utils} from "../support/utilities"

describe('Third party pyramidal image', () => {
    it('Background only: custom protocol', () => {
        let isSecure = false;

        let firstConfig = {
            params: config.params({viewport: config.viewport('book', 0)}),
            data: config.data('book'),
            background: config.background({protocol: "data"}, 0)
        };

        cy.launch(firstConfig);
        utils.waitForViewer().then(x => {
            isSecure = x.APPLICATION_CONTEXT.secure;
        });

        testBasic.RightSideMenu(firstConfig);
        cy.canvas().matchImage()
        testBasic.shadersRightSideMenu(firstConfig);


        let secondConfig = {
            params: firstConfig.params,
            data: config.data('book'),
            background: config.background({"protocol": "data"}, 0),
            visualizations: [config.visualization({
                "name":"The book is rendered twice, once as overlay.",
                "protocol":"data[0]",
            }, shaders.heatmap({}, 0))
            ]
        }

        cy.window().then(window => {
            window.APPLICATION_CONTEXT.openViewerWith(
                secondConfig.data,
                secondConfig.background,
                secondConfig.visualizations
            );
        });

        utils.waitForViewer(false).then(x => {
            if (isSecure) {
                //secure mode prevets loading of custom protocols, will fail
                delete secondConfig.visualizations;
            }


            testBasic.RightSideMenu(secondConfig);
            testBasic.shadersRightSideMenu(secondConfig);
            testBasic.settingsMenu(secondConfig);
        });
    })
})


describe('Faulty data', () => {
    it('No valid image in normal mode', () => {
        let visualization = {
            params: config.params(),
            data: config.data('invalid'),
            background: config.background({}, 0)
        };

        cy.launch(visualization);
        utils.waitForViewer();
        cy.get("#tissue-title-header").should('contain.text', "Faulty")
    })

    it('Valid background, invalid layers', () => {
        let visualization = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 0), shaders.identity({}, 1))
            ]
        };

        cy.launch(visualization);
        utils.waitForViewer().then(x => {
            testElements.systemNotification("Failed to load overlays");
            testElements.closeDialog();
            testBasic.RightSideMenu(visualization);
        });
    })

    it('Valid layers, invalid background', () => {
        let visualization = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1),
            visualizations: [
                config.visualization({}, shaders.identity({}, 0))
            ]
        };

        cy.launch(visualization);
        utils.waitForViewer();

        testBasic.settingsMenu(visualization);
    })

    it('Valid and invalid background, invalid layers, side-by-side mode, invalid first.', () => {
        let visualization = {
            params: config.params(),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualization);
        utils.waitForViewer();

        cy.get("#tissue-title-header").should('contain.text', "Faulty")
        testElements.getSwapBackgroundPlaceholder(1).click();
        utils.waitForViewer(false);
        cy.get("#tissue-title-header").should('not.contain.text', "Faulty")
    })

    it ('Stacked mode three layers', () => {
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

        cy.get("#images-pin").click();
        cy.get("#image-layer-options").children().should('have.length', 3)
            .should('contain.text', 'FirstIndex')
            .should('contain.text', 'SecondIndex')
            .should('contain.text', 'ThirdIndex')
            .should('not.contain.text', 'FourthIndex');
    })

    it('Stacked mode no valid data.', () => {
        let visualization = {
            params: config.params({
                stackedBackground: true
            }),
            data: config.data('invalid'),
            background: config.background({}, 0, 1),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualization);
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
        let visualization = {
            params: config.params({
                stackedBackground: true
            }),
            data: config.data('even-indexes-valid-only'),
            background: config.background({}, 1, 0),
            visualizations: [
                config.visualization({}, shaders.identity({}, 1))
            ]
        };

        cy.launch(visualization);
        utils.waitForViewer();

        //failed image load dialog prevents click
        testElements.closeDialog();
        cy.get("#images-pin").click();

        //first shown is the last rendered - the most visible
        testElements.getStackedImageMenuItem(1).find("input[type=checkbox]").should('be.checked')
        testElements.getStackedImageMenuItem(1).should('not.contain.text', 'Faulty')

        testElements.getStackedImageMenuItem(0).find("input[type=checkbox]").should('not.be.checked')
        testElements.getStackedImageMenuItem(0).should('contain.text', 'Faulty')
        cy.get("#images-pin").click();

        testBasic.RightSideMenu(visualization);
    })
})

