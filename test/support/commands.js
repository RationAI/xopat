// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

import "cypress-plugin-snapshots/commands"


/**
 * Remove OpenSeadragon XHR
 */
if (Cypress.config('hideXHRInCommandLog')) {
    const app = window.top;
    if (
        app &&
        !app.document.head.querySelector('[data-hide-command-log-request]')
    ) {
        const style = app.document.createElement('style');
        style.innerHTML =
            '.command-name-request, .command-name-xhr { display: none }';
        style.setAttribute('data-hide-command-log-request', '');

        app.document.head.appendChild(style);
    }
}

Cypress.Commands.addAll({
    launch(configuration, data={}) {
        cy.log("POST", {
            visualisation: configuration,
            ...data
        });
        return cy.visit({
            url: Cypress.env('viewer'),
            headers: Cypress.env('headers'),
            method: 'POST',
            body: {
                visualisation: configuration,
                ...data
            }
        })
    },
    canvas() {
        return cy.get(".openseadragon-canvas > canvas");
    }
});