//constructing individual tests before moving them to their folder


import {config, shaders, withBrowser} from "../fixtures/configurations"
import {testBasic, testElements} from "./routines"
import {default as utils} from "../support/utilities"

describe('Correct Active Indexes with stackedBackground:false', withBrowser, () => {

   it("Bindings of indices initial state", ()=>  {
       let visualisation = {
           params: config.params({
               viewport: config.viewport('tissue', 0),
               stackedBackground: false,
               activeBackgroundIndex: 1
           }),
           data: config.data('tissue'),
           background: [
               {dataReference: 0, goalIndex: 1},
               {dataReference: 1, goalIndex: 2},
               {dataReference: 2, goalIndex: 0}
           ],
           visualizations: [
               config.visualization({name: "Vis 0 -> Bg 2"},
                   shaders.heatmap({},0),
               ),
               config.visualization({name: "Vis 1 -> Bg 0"},
                   shaders.heatmap({},1),
               ),
               config.visualization({name: "Vis 2 -> Bg 1"},
                   shaders.heatmap({},2),
               ),
           ]
       };

       cy.launch(visualisation);
       utils.waitForViewer();

       testElements.getSwapBackgroundPlaceholder(1).should('have.class', 'selected');
       testElements.getSwapBackgroundPlaceholder(0).should('not.have.class', 'selected');
       testElements.getSwapBackgroundPlaceholder(2).should('not.have.class', 'selected');

       cy.canvas().matchImage({title: "B1 active visualization goal #2, background #1"});
   })

    it("Bindings after #0 background selected", ()=>  {
        testElements.getSwapBackgroundPlaceholder(0).click();
        utils.waitForViewer(false);

        testElements.getSwapBackgroundPlaceholder(0).should('have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(1).should('not.have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(2).should('not.have.class', 'selected');

        cy.canvas().matchImage({title: "B2 active visualization goal #1, background #0"});
    })

    it("Bindings after #2 background selected", ()=>  {
        testElements.getSwapBackgroundPlaceholder(2).click();
        utils.waitForViewer(false);

        testElements.getSwapBackgroundPlaceholder(2).should('have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(0).should('not.have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(1).should('not.have.class', 'selected');

        cy.canvas().matchImage({title: "B3 active visualization goal #0, background #2"});
    })

    it("Bindings after #2 background changed - keeps the change", ()=> {
        cy.get("#shaders").select(1);
        utils.waitForViewer(false);
        testElements.getSwapBackgroundPlaceholder(1).click();
        utils.waitForViewer(false);
        testElements.getSwapBackgroundPlaceholder(2).click();
        utils.waitForViewer(false);

        testElements.getSwapBackgroundPlaceholder(2).should('have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(0).should('not.have.class', 'selected');
        testElements.getSwapBackgroundPlaceholder(1).should('not.have.class', 'selected');

        cy.canvas().matchImage({title: "B4 active visualization goal #1 change kept for background #2"});
    })
})