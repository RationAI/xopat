export default {
    waitForViewer() {
        cy.waitUntil(() => VIEWER.imageLoader.jobsInProgress === 0);
    }
}