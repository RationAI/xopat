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
})

