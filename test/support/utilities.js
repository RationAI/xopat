import 'cypress-wait-until';
import Controls from "../fixtures/configurations/controls";

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
                if (!win.VIEWER) throw "Viewer was not found on the window context!";
                conf.window = win;
                conf.window.VIEWER.addHandler('open', () => conf.initialized = true);
                // conf.window.VIEWER.addHandler('open', () => conf.initialized = true);  was problematic...
                conf.initialized = true;
            });
        } else {
            //give some space to the viewer so that image loader is not still without a job
            cy.wait(300);
            cy.window().then((win) => {
                conf.window = win;
                conf.initialized = true;
            });
        }

        // ... && window is a trick to return that value on success
        return cy.waitUntil(() => {
            return conf.initialized
                && conf.window.VIEWER.imageLoader.jobsInProgress < 2 //we allow 1 unfinished element
                && conf.window; //returns the window ref upon success
        }, {
            description: "Waiting for the images to load.",
            timeout: 30000,
            interval: 600,
            verbose: false
        });
    }
}
