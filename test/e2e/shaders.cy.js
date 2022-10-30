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
                    shaders.identity({  //bottom, probability
                        overrides: {
                            fixed: false
                        }
                    },2),
                    shaders.identity({  //bottom, probability
                        overrides: {
                            fixed: false
                        }
                    },3),
                    shaders.identity({  //bottom, probability
                        overrides: {
                            fixed: false
                        }
                    },1),
                )
            ]
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        cy.get("#shaders-pin").click();

        const probabilityId = "0";
        const explainId = "1";
        const annotationId = "2";

        //todo shaders selects hidden by default enable

        cy.canvas().matchImage({title: "S1 identities rendered atop, visible annotations"});

        cy.get("#" + explainId + "-change-render-type").select("bipolar-heatmap");

        cy.canvas().matchImage({title: "S2 same as before, but the underlying rendering ahs already changed"});

        cy.get("#" + annotationId + "-change-render-type").select("edges");

        cy.canvas().matchImage({title: "S3 suddenly rendering two overlays, visible probability identity"});

        cy.get("#" + probabilityId + "-change-render-type").select("heatmap");

        cy.canvas().matchImage({title: "S4 common rendering we are used to"});


        //cy.get("#data-layer-options .shader-part").children().eq(1).

    });
});