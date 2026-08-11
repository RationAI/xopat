/**
 * Proves cy.setEnv() rewrites the deployment ENV of an already-running
 * server, with no restart (server re-reads XOPAT_ENV on every request).
 * Run via: npm run test-env-injection
 */
import {config} from "../fixtures/configurations"
import {default as utils} from "../support/utilities"

//envFile is a generic passthrough other runs reuse (e.g. npm run test-matrix
//targets viewer.env.test-custom.json) - only activate on our own scratch file
const SCRATCH_ENV_FILE = 'test/env/runtime.json';
const targetsScratchEnv = () => Cypress.env('envFile') === SCRATCH_ENV_FILE;

const BASELINE_ENV = {
    core: {
        gateway: "/",
        active_client: "localhost",
        client: {
            localhost: {
                domain: "http://localhost:<% XOPAT_NODE_PORT:-9002 %>",
                path: "/",
                slide_protocols: {
                    wsi_service: {
                        url: "`/v3/slides/info?slide_id=${data}`",
                        baseURL: "http://localhost:<% WSI_PORT:-8080 %>",
                    },
                },
                default_background_protocol: "wsi_service",
                default_visualization_protocol: "wsi_service",
                secureMode: false,
            },
        },
        setup: {locale: "en", theme: "auto"},
    },
};

describe('Runtime ENV injection', () => {

    after(function () {
        //restore the committed scratch file; nothing to undo if we never wrote it
        if (!targetsScratchEnv()) return;
        cy.setEnv(BASELINE_ENV);
    });

    it("rewrites the running server's ENV without a restart", function () {
        if (!targetsScratchEnv()) this.skip();

        const changed = {
            ...BASELINE_ENV,
            core: {...BASELINE_ENV.core, setup: {locale: "en", theme: "dark"}},
        };
        cy.setEnv(changed);

        //no theme override in params -> the value must come from the ENV we just wrote
        cy.launch({
            params: {bypassCookies: true, bypassCache: true},
            data: config.data('tissue'),
            background: config.background({}, 0),
        });
        utils.waitForViewer().then(win => {
            //not getOption("theme"): its boot call passes an explicit "auto"
            //default, which always wins over the ENV value (see getOption in
            //src/dist/app.js). env.setup is the raw per-request ENV instead.
            expect(win.APPLICATION_CONTEXT.env.setup.theme).to.equal("dark");
        });
    });
});
