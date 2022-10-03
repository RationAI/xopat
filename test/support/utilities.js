import 'cypress-wait-until';

export default {
    /**
     * Wait for image loading job finish
     * @param afterViewerLoad if true, it waits also for 'loaded' event on the viewer
     */
    waitForViewer(afterViewerLoad=true) {

        let window = undefined;
        let initialized = false; //wait for load event
        cy.window().then((win) => {
            window = win;

            if (afterViewerLoad)  {
                window.VIEWER.addHandler('loaded', () => initialized = true);
            } else {
                //give some space to the viewer so that image loader is not still without job
                setTimeout(() => initialized = true, 100);
            }
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