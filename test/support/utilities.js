import 'cypress-wait-until';

export default {
    /**
     * Wait until the viewer is open and images are loaded.
     * window.VIEWER appears asynchronously after page load, so poll for it.
     * @return {Cypress.Chainable<Window>} the tested context window object
     */
    waitForViewer() {
        return cy.window().then(win => cy.waitUntil(() => {
            const viewer = win.VIEWER;
            return !!viewer
                && viewer.world?.getItemCount() > 0
                && viewer.imageLoader?.jobsInProgress < 2; //we allow 1 unfinished element
        }, {
            description: "Waiting for the viewer to open and images to load.",
            timeout: 30000,
            interval: 500,
            verbose: false
        }).then(() => win));
    }
}
