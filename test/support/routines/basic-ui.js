export default {
    testBackgroundUI(params) {
        [
            "#global-tissue-visibility",
            "#panel-navigator",
            "#navigator-pin"
        ].forEach(x =>  cy.get(x).should('be.visible'))

        cy.get("#navigator-pin").should('have.class', 'inline-pin')
            .should('not.have.class', 'pressed')

        cy.get("#global-export").should('be.visible').should('have.title', 'Export visualisation together with plugins data')
        cy.get("#copy-url").should('be.visible').should('have.title', 'Get the visualisation link')

        cy.get("#main-panel-hide").click()
            [
            "#global-tissue-visibility",
                "#panel-navigator",
                "#global-export"
            ].forEach(x =>  cy.get(x).should('not.be.visible'))

        cy.get("#main-panel-show").click()

        cy.get("#global-help").should('be.visible').should('have.title', 'Show tutorials')
        cy.get("#add-plugins").should('be.visible').should('have.title', 'Add plugins to the visualisation')
        cy.get("#settings").should('be.visible').should('have.title', 'Settings').click()

        //settings
        cy.get("#app-settings").contains('label', 'Debug Mode').find('input').should('not.to.be.checked')

    },
}