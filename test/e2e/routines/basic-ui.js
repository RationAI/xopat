import {default as elements} from './basic-ui-elements';

export default {
    mainMenu(config) {
        if (!config.params.bypassCookies) {
            cy.log("mainMenu:: Test without bypassCookies is not intended to pass.");
        }

        ["#panel-navigator", "#navigator-pin", "#copy-url"].forEach(x =>  cy.get(x).should('be.visible'))

        if (config.params.stackedBackground) {
            cy.get("#global-tissue-visibility").should('not.be.visible');
        } else {
            cy.get("#global-tissue-visibility").should('be.visible');
        }

        cy.get("#navigator-pin").should('have.class', 'inline-pin')
            .should('not.have.class', 'pressed')

        cy.get("#navigator-pin").click()

        cy.get("#main-panel-hide").click()

        cy.get("#navigator-pin").should('be.visible').should('have.class', 'pressed')

        cy.get("#panel-navigator").should('be.visible')

        cy.get("#navigator-pin").click()

        cy.get("#panel-navigator").should('not.be.visible');

        ["#global-tissue-visibility", "#global-export", "#add-plugins"].forEach(x =>  cy.get(x).should('not.be.visible'))

        cy.get("#main-panel-show").click()

        if (!config.params.stackedBackground) {
            cy.get("#global-tissue-visibility input").should('be.checked');
        }

        ["#add-plugins", "#panel-navigator", "#navigator-pin", "#main-panel-hide",
            "#add-plugins"].forEach(x =>  cy.get(x).should('be.visible'))
    },

    shadersMainMenu(config) {
        if (!config.visualizations || config.visualizations.length < 1) {
            cy.get("#shaders").should('not.be.visible')
        } else {
            let shaderOpener = cy.get("#shaders-pin");

            cy.get("#shaders").should('be.visible')
            cy.get("#shaders").children('option').then(options => {
                const actual = [...options].map(o => o.innerText)
                expect(actual).to.deep.eq(config.visualizations.map(v => v.name))
            })

            elements.openMenuArrow("#shaders-pin");

            //testing of the submenu is too complex for general setup, tested in shader tests

            if (config.params.webglDebugMode) {
                cy.contains('#test-inner--webgl', 'WebGL Processing I/O (debug mode)')
            }
        }
    },

    settingsMenu(config) {
        if (!config.params.bypassCookies) {
            cy.log("settingsMenu:: Test without bypassCookies is not intended to pass.");
        }

        cy.get("#app-settings").should('not.be.visible')

        cy.get("#settings").should('be.visible').click()

        cy.get("#app-settings").contains('label', 'Show ToolBar').find('input').should('be.checked');
        cy.get("#app-settings").contains('label', 'Show Scale Bar').find('input').should(
            (config.params.scaleBar ? '' : 'not.to.') + 'be.checked');

        cy.get("#app-settings").contains('label', 'Disable Cookies').find('input').should(
            (config.params.bypassCookies ? '' : 'not.to.') + 'be.checked');

        cy.get("#app-settings").contains('label', 'Debug Mode').find('input').should(
            (config.params.debugMode ? '' : 'not.to.') + 'be.checked');
        cy.get("#app-settings").contains('label', 'Debug Rendering').find('input').should(
            (config.params.webglDebugMode ? '' : 'not.to.') + 'be.checked');

        cy.get("#advanced-menu-close-button").should('be.visible').click();
        cy.get("#app-settings").should('not.be.visible')
    },


}
