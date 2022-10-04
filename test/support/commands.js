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
    /**
     * Load the Pathopus Viewer
     * @param configuration config objects with data and params, plugins, rendering opts...
     * @param data additional data to include
     * @return {Cypress.Chainable<Cypress.AUTWindow>}
     */
    launch(configuration, data={}) {
        cy.log("Launch Viewer with:", {
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
    /**
     * @return Cypress.Chainable - the OpenSeadragon canvas DOM element
     */
    canvas() {
        return cy.get(".openseadragon-canvas>canvas").first()
    },
    /**
     * @param type text to type, {key} for specific key names (such as shift...)
     * @return Cypress.Chainable - builder pattern
     */
    keyDown(type) {
        return cy.get('body').type(type, { release: false });
    },
    /**
     * @param type text to type, {key} for specific key names (such as shift...)
     * @return Cypress.Chainable - builder pattern
     */
    keyUp(type) {
        return cy.get('body').type(type, { release: true });
    },
    /**
     * Draw over 'this' target - must be called on a DOM element
     * @param target string selector or a selected DOM element (cy.get(...))
     * @param points objects with x, y props
     * @return Cypress.Chainable - builder pattern
     */
    draw(target, ...points) {
        if (typeof target === "string") target = cy.get(target);
        target = target.trigger('mousedown', {
            eventConstructor: 'MouseEvent',
            button: 0,
            clientX: points[0].x, clientY: points[0].y, screenX: points[0].x, screenY: points[0].y, pageX: points[0].x, pageY: points[0].y})
            .wait(100);
        for (let i = 1; i<points.length-1; i++) {
            const p = points[i];
            target = target.trigger('mousemove', { eventConstructor: 'MouseEvent',
                clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, pageX: p.x, pageY: p.y });
        }
        const last = points[points.length-1];
        return target.trigger('mouseup', { eventConstructor: 'MouseEvent',
            clientX: last.x, clientY: last.y, screenX: last.x, screenY: last.y, pageX: last.x, pageY: last.y});
    }
});


// Cypress.Commands.add('draw',  { prevSubject: true }, (self, ...points) => {
//     // const node = Cypress.$(self)[0];
//     //
//     // node.dispatchEvent(new MouseEvent('mousedown'));
//     // for (let p of points) {
//     //     node.dispatchEvent(new MouseEvent('mousemove', {clientX: p.x, clientY: p.y}));
//     //     cy.wait(50);
//     // }
//     // node.dispatchEvent(new MouseEvent('mouseup'));
//
//     self = self.trigger('mousedown', { which: 1});
//     for (let p of points) {
//         self = self.trigger('mousemove', { which: 1, pageX: p.x, pageY: p.y });
//     }
//     return self.trigger('mouseup', { which: 1});
// });
//
// Cypress.Commands.add('drawRight',  { prevSubject: true }, (self, ...points) => {
//     self.dispatchEvent(new MouseEvent('mousedown', {which: 3}));
//     for (let p of points) {
//         self.dispatchEvent(new MouseEvent('mousemove', {clientX: p.x, clientY: p.y, which: 3}));
//         cy.wait(50);
//     }
//     self.dispatchEvent(new MouseEvent('mouseup', {which: 3}));
//     return self;
// });
