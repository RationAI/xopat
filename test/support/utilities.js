import 'cypress-wait-until';

export default {
    waitForViewer() {

        let window = undefined;
        let initialized = false; //wait for load event
        cy.window().then((win) => {
            window = win;
            window.VIEWER.addHandler('loaded', () => initialized = true);
        });
        cy.waitUntil(() => {
            return initialized && window.VIEWER.imageLoader.jobsInProgress === 0
        }, {
            description: "Waiting for the images to load.",
            timeout: 30000,
            interval: 600,
            verbose: false
        });
    }
}