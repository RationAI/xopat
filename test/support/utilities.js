import 'cypress-wait-until';

export default {
    /**
     * Wait for image loading job finish
     * @param beforeLoadEvent if true, it waits also for 'loaded' event on the viewer
     * @return {Promise<Window>} iframe window - tested context window object
     */
    waitForViewer(beforeLoadEvent=true) {

        //need object for pass-by-reference in closures
        let conf = {
            window: undefined,
            initialized: false,  //wait for load event
        };

        if (beforeLoadEvent) {
            cy.window().then((win) => {
                conf.window = win;
                conf.window.VIEWER.addHandler('open', () => conf.initialized = true);
            });
        } else {
            //give some space to the viewer so that image loader is not still without job
            cy.wait(300);
            cy.window().then((win) => {
                conf.window = win;
                conf.initialized = true;
            });
        }

        // ... && window is a trick to return that value on success
        return cy.waitUntil(() =>  conf.initialized
                && conf.window.VIEWER.imageLoader.jobsInProgress < 2 //we allow 1 unfinished element
                && conf.window, {
            description: "Waiting for the images to load.",
            timeout: 30000,
            interval: 600,
            verbose: false
        });
    }
}