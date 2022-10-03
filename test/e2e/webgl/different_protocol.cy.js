import {config, shaders, withBrowser} from "../../fixtures/configurations"
import {testBasic} from "../routines"
import {default as utils} from "../../support/utilities"

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
        cy.canvas().toMatchImageSnapshot(); //do not move the call, screenshot comparison

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
