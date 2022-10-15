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
    },
    systemError(message, details, chainer='contain.html') {
        cy.get("#system-message-warn").should('contain.text', 'Error');
        cy.get("#system-message-title").should('contain.text', message);

        if (details) {
            cy.get("#system-message-details-btn").click();
            cy.get("#system-message-details").should(chainer, details)
        }
    },
    systemNotification(message, chainer='contain.text') {
        cy.get("#dialogs-container").should('be.visible');
        cy.get("#system-notification").should(chainer, message);
    },
    getSwapBackgroundPlaceholder(index) {
        return cy.get("#tissue-preview-container").children().eq(index);
    },
    getStackedImageMenuItem(index) {
        return cy.get("#image-layer-options").children().eq(index);
    }
}