import {config, shaders, withBrowser} from "../../fixtures/configurations"
import {testBasic} from "../routines"
import {default as utils} from "../../support/utilities"

describe('Third party pyramidal image', withBrowser, () => {
    it('Background only: custom protocol', () => {
        const visualisation = {
            params: config.params({viewport: config.viewport('book', 0)}),
            data: config.data('book'),
            background: config.background({protocol: "data"}, 0)
        };

        cy.launch(visualisation);
        utils.waitForViewer();

        testBasic.mainMenu(visualisation);
        cy.canvas().toMatchImageSnapshot();

        cy.window().then(window => {
            window.APPLICATION_CONTEXT.prepareViewer(
                config.data('book'),
                config.background({"protocol": "data"}, 0),
                [config.visualization({
                    "name":"The book is rendered twice, once as overlay.",
                    "protocol":"data[0]",
                }, shaders.heatmap(0))
                ]
            );
        });

        utils.waitForViewer();
        testBasic.mainMenu(visualisation);


    })
})
//
// describe('Third party pyramidal image', withBrowser, () => {
//     it('Full rendering options: only one layer available.', () => {
//         cy.launch({
//             params: config.params({viewport: config.viewport('book', 0)}),
//             data: config.data('book'),
//             background: config.background({"protocol": "data"}, 0),
//             visualizations:[
//                 config.visualization({
//                     "name":"The book is rendered twice, once as overlay.",
//                     "protocol":"data[0]",
//                 }, shaders.heatmap(0))
//             ]
//         })
//         cy.debug()
//         //todo set some trigger that allows the set?
//         cy.canvas()
//             //.toMatchImageSnapshot()
//     })
// })