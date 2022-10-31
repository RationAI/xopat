import {config, shaders, withBrowser} from "../fixtures/configurations"
import {testBasic} from "./routines"
import {default as utils} from "../support/utilities"

const probabilityId = "0";
const explainId = "1";
const annotationId = "2";

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
                    shaders.identity({  //middle, explainability
                        overrides: {
                            fixed: false
                        }
                    },3),
                    shaders.identity({  //top, annotation
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

        //todo shaders selects hidden by default enable

        cy.canvas().matchImage({title: "S1 identities rendered atop, visible annotations"});
    });

    it ('Test heatmap, edge and bipolar heatmap', () => {
        cy.get("#" + explainId + "-change-render-type").select("bipolar-heatmap", {force: true});

        cy.canvas().matchImage({title: "S2 same as before, but the underlying rendering ahs already changed"});

        cy.get("#" + annotationId + "-change-render-type").select("edge", {force: true});

        cy.canvas().matchImage({title: "S3 suddenly rendering two overlays, visible probability identity"});

        cy.get("#" + probabilityId + "-change-render-type").select("heatmap", {force: true});

        cy.canvas().matchImage({title: "S4 common rendering we are used to"});
    });


    /**
     * try to implement drag n drop
     * const dataTransfer = new DataTransfer();
     *         cy.get("#" + probabilityId + "-shader-part").trigger('dragstart', {
     *             dataTransfer
     *         }).realMouseDown({position: "top"}).realMouseMove(-200, -200, {position: "top"}).trigger('drop', {
     *             dataTransfer
     *         });
     *         does not work error dataTransfer needs coords
     *
     *         nebo .trigger('mousedown', { which: 1, pageX: 600, pageY: 100 })
     *             .trigger('mousemove', { which: 1, pageX: 600, pageY: 600 })
     *             .trigger('mouseup')
     *
     *             but I need for the second example also coords
     */

    it ('Mask testing', () => {
        cy.get("#" + annotationId + "-change-render-type").select("heatmap", {force: true});
        cy.get("#" + annotationId + "-mode-toggle").click();

        cy.canvas().matchImage({title: "S5 - global mask on annotation removes all other parts"});

        cy.get("#" + annotationId + "-shader-part").rightclick();
        cy.get("#drop-down-menu").contains("Clipping mask").click();

        cy.canvas().matchImage({title: "S6 - clipping mask affects only explainability"});
    })
});