import {config, shaders, withBrowser} from "../fixtures/configurations"
import {testBasic} from "./routines"
import {default as utils} from "../support/utilities"

describe('Shader Menu Testing', withBrowser, () => {
    it('Start with identity, test out changes', () => {
        let visualisation = {
            params: config.params({viewport: config.viewport('tissue', 0)}),
            data: config.data('tissue'),
            background: config.background({}, 0),
            visualizations: [
                config.visualization({

                },
                    shaders.identity({
                        fixed: false
                    }, 1),
                    shaders.identity({
                        fixed: false
                    },2),
                    shaders.identity({
                        fixed: false
                    }, 3)
                )
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

    });
});