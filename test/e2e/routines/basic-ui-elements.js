export default {
    menuArrow(selector, shoudBeOpened) {
        if (shoudBeOpened) {
            cy.get(selector).should('have.class', 'opened')
        } else {
            cy.get(selector).should('not.have.class', 'opened')
        }
    },
    menuPin(selector, shoudBeOpened) {
        if (shoudBeOpened) {
            cy.get(selector).should('have.class', 'pressed')
        } else {
            cy.get(selector).should('not.have.class', 'pressed')
        }
    }
}