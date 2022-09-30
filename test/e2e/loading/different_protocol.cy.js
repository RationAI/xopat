import {config, shaders} from "../../support/configurations"


describe('Third party pyramidal image', () => {
    it('Background only: custom protocol', () => {
        cy.launch({
            params: config.params({viewport: config.viewport('book', 0)}),
            data: config.data('book'),
            background: config.background({protocol: "data"}, 0)
        })

        cy.wait(5000)
        cy.canvas()
        //.toMatchImageSnapshot()
    })
})

describe('Third party pyramidal image', () => {
    it('Full rendering options: only one layer available.', () => {
        cy.launch({
            params: config.params({viewport: config.viewport('book', 0)}),
            data: config.data('book'),
            background: config.background({"protocol": "data"}, 0),
            visualizations:[
                config.visualization({
                    "name":"The book is rendered twice, once as overlay.",
                    "protocol":"data[0]",
                }, shaders.heatmap(0))
            ]
        })
        cy.debug()
        //todo set some trigger that allows the set?
        cy.canvas()
            //.toMatchImageSnapshot()
    })
})