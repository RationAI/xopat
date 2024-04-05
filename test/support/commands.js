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

import '@frsource/cypress-plugin-visual-regression-diff';
import "cypress-real-events/support";

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

function _draw(button) {
    return (target, ...points) => {
        if (typeof target === "string") target = cy.get(target);
        target = target.trigger('mousedown', {
            eventConstructor: 'MouseEvent', button: button,
            clientX: points[0].x, clientY: points[0].y, screenX: points[0].x, screenY: points[0].y, pageX: points[0].x, pageY: points[0].y})
            .wait(150);
        for (let i = 1; i<points.length-1; i++) {
            const p = points[i];
            target = target.trigger('mousemove', { eventConstructor: 'MouseEvent', button: button,
                clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, pageX: p.x, pageY: p.y }).wait(7);
        }
        const last = points[points.length-1];
        return target.trigger('mouseup', { eventConstructor: 'MouseEvent', button: button,
            clientX: last.x, clientY: last.y, screenX: last.x, screenY: last.y, pageX: last.x, pageY: last.y});
    }
}

Cypress.Commands.addAll({
    /**
     * Load the xOpat Viewer
     * @param configuration config objects with data and params, plugins, rendering opts...
     * @param data additional data to include
     * @return {Cypress.Chainable<Cypress.AUTWindow>}
     */
    launch(configuration, data={}) {
        cy.log("Launch Viewer with:", {
            visualization: configuration,
            ...data
        });

        //unfortunately it has to manually reattach the headers
        cy.intercept(Cypress.env('interceptDomain'), (req) => {
            const viewerContentType = Cypress.env('headers')['content-type'],
                viewerAuth = Cypress.env('headers')['authorization'];
            if (viewerContentType) req.headers['content-type'] = viewerContentType;
            if (viewerAuth) req.headers['authorization'] = viewerAuth;
        })

        console.log(Cypress.env('headers'))

        return cy.visit({
            url: Cypress.env('viewer'),
            headers: Cypress.env('headers'),
            method: 'POST',
            body: JSON.stringify({
                visualization: configuration,
                ...data
            })
        })
    },
    /**
     * @return Cypress.Chainable - the OpenSeadragon canvas DOM element
     * @memberOf Cypress.cy
     */
    canvas() {
        return cy.get(".openseadragon-canvas>canvas").first()
    },
    /**
     * @return Cypress.Chainable - builder pattern
     * @param key
     * @param opts
     */
    key(key, opts) {
        return cy.keyDown(key, opts).trigger('keyup', { ...opts, eventConstructor: 'KeyboardEvent', key: key, release: true });
    },
    /**
     * @return Cypress.Chainable - builder pattern
     * @param key
     * @param opts
     * @memberOf Cypress.cy
     */
    keyDown(key, opts) {
        return cy.document().trigger('keydown', { ...opts, eventConstructor: 'KeyboardEvent', key: key, release: false })
            .trigger('keypress', { eventConstructor: 'KeyboardEvent', key: key, release: false });
    },
    /**
     * @return Cypress.Chainable - builder pattern
     * @param key
     * @param opts
     * @memberOf Cypress.cy
     */
    keyUp(key, opts) {
        return cy.document().trigger('keyup', { ...opts, eventConstructor: 'KeyboardEvent', key: key, release: true });
    },
    /**
     * Draw over 'this' target - must be called on a DOM element
     * @param target string selector or a selected DOM element (cy.get(...))
     * @param points objects with x, y props
     * @return Cypress.Chainable - builder pattern
     * @memberOf Cypress.cy
     */
    draw: _draw(0),
    /**
     * Draw over 'this' target with right button - must be called on a DOM element
     * @param target string selector or a selected DOM element (cy.get(...))
     * @param points objects with x, y props
     * @return Cypress.Chainable - builder pattern
     * @memberOf Cypress.cy
     */
    drawRight: _draw(2),
});

Cypress.on('fail', (error, runnable) => {
    if (error.message.includes("Image diff factor")
        && error.message.includes("is bigger than maximum threshold option")) {

        console.warn("Test Regression Failure!", runnable.title, "\n", error.message);
        return true;
    }
    throw error;
});

Cypress.on('test:after:run', (test) => {
    // @ts-expect-error Property runnner is not exposed by Cypress
    if (test.state !== 'passed' && test.retries > 0) Cypress.runner.stop()
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
