import { config } from "../fixtures/configurations"
import { default as utils } from "../support/utilities"

describe('OIDC and XOpatUser Integration', () => {

    beforeEach(() => {
        // Ensure a clean state for each test run
        cy.window().then((win) => {
            win.sessionStorage.clear();
            win.localStorage.clear();
        });
    });

    it('Provides secrets to HttpClient via the context-aware store', () => {
        cy.launch({
            params: config.params(),
            data: config.data('tissue'),
            background: config.background({}, 0),
        });
        utils.waitForViewer();

        cy.window().then(async (win) => {
            const user = win.XOpatUser.instance();
            const HttpClient = win.HttpClient;

            // Manually set a secret to simulate a logged-in state
            user.login('test-id', 'Test User', '', 'core');
            user.setSecret('test-jwt-token', 'jwt', 'core');

            // Initialize a client for a specific context
            const client = new HttpClient({
                baseURL: 'https://api.example.com',
                auth: { contextId: 'core', types: ['jwt'] }
            });

            // Verify that the HttpClient internal _authHeaders can retrieve the secret
            const headers = await client._authHeaders('https://api.example.com/data', 'GET');

            expect(headers).to.have.property('Authorization');
            expect(headers.Authorization).to.equal('Bearer test-jwt-token');
        });
    });

    it('Provides secrets to HttpClient via the context-aware store', () => {
        cy.launch({
            params: config.params(),
            data: config.data('tissue'),
            background: config.background({}, 0),
        });
        console.log("1");
        utils.waitForViewer();
        console.log("2");
        cy.window().then(async (win) => {
            console.log("3", win);
            const user = win.XOpatUser.instance();
            const HttpClient = win.HttpClient;

            // Manually set a secret to simulate a logged-in state
            user.login('test-id', 'Test User', '', 'core');
            user.setSecret('test-jwt-token', 'jwt', 'core');

            // Initialize a client for a specific context
            const client = new HttpClient({
                baseURL: 'https://api.example.com',
                auth: { contextId: 'core', types: ['jwt'] }
            });

            // Verify that the HttpClient internal _authHeaders can retrieve the secret
            const headers = await client._authHeaders('https://api.example.com/data', 'GET');

            expect(headers).to.have.property('Authorization');
            expect(headers.Authorization).to.equal('Bearer test-jwt-token');
        });
    });
});