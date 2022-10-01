export default {
    mainMenu(config) {
        if (!config.params.bypassCookies) {
            cy.log("mainMenu:: Test without bypassCookies is not intended to pass.");
        }

        ["#global-tissue-visibility", "#panel-navigator", "#navigator-pin",
            "#global-export", "#copy-url"].forEach(x =>  cy.get(x).should('be.visible'))

        cy.get("#navigator-pin").should('have.class', 'inline-pin')
            .should('not.have.class', 'pressed')

        cy.get("#main-panel-hide").click();

        ["#global-tissue-visibility", "#panel-navigator", "#global-export", "#add-plugins"].forEach(x =>  cy.get(x).should('not.be.visible'))

        cy.get("#main-panel-show").click();


        ["#add-plugins", "#panel-navigator", "#navigator-pin", "#main-panel-hide",
            "#global-export", "#add-plugins"].forEach(x =>  cy.get(x).should('be.visible'))
    },

    settingsMenu(config) {
        if (!config.params.bypassCookies) {
            cy.log("settingsMenu:: Test without bypassCookies is not intended to pass.");
        }

        const menu = cy.get("#app-settings");
        menu.should('not.be.visible')

        cy.get("#settings").should('be.visible').and('have.title', 'Settings').click()

        menu.contains('label', 'Show ToolBar').find('input').should('be.checked');
        menu.contains('label', 'Show ScaleBar').find('input').should(
            (config.params.scaleBar ? '' : 'not.to.') + 'be.checked');

        menu.contains('label', 'Disable Cookies').find('input').should(
            (config.params.bypassCookies ? '' : 'not.to.') + 'be.checked');

        menu.contains('label', 'Debug Mode').find('input').should(
            (config.params.debugMode ? '' : 'not.to.') + 'be.checked');
        menu.contains('label', 'Debug Rendering').find('input').should(
            (config.params.webglDebugMode ? '' : 'not.to.') + 'be.checked');
    },
}