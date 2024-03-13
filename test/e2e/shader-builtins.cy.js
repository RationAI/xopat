import {config, shaders} from "../fixtures/configurations"
import {testBasic} from "./routines"
import {default as utils} from "../support/utilities"
import {default as elements} from "./routines/basic-ui-elements";

const probabilityId = "0";
const explainId = "1";
const annotationId = "2";

/**
 * TODO
 * Tests builtin params except blending mode (already tested)
 *  - visibility of controls
 *  - filters
 *  - channels
 */
describe('WebGL Shader Builtin Testing', () => {
    it('Start with identity, test out changes', () => {
        let visualization = {
            params: config.params({
                viewport: config.viewport('tissue', 0),
            }),
            data: config.data('tissue'),
            background: config.background({}, 0),
            visualizations: [
                //identity that overrides channels stays the same
                config.visualization({},
                    shaders.identity({
                        overrides: {fixed: false},
                        controls: {
                            use_channel0: "r"
                        }
                    },2),
                ),
                //identity that overrides channels stays the same
                config.visualization({},
                    shaders.identity({
                        overrides: {fixed: false},
                        controls: {
                            use_channel0: "r"
                        }
                    },2),
                ),
            ]
        };

        cy.launch(visualization);
        utils.waitForViewer();

        cy.get("#shaders-pin").click();

        //todo test visuals and switch between different settings in params
    });
});

