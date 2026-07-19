/**
 * Viewer `params` contract tests (see /dev_setup, src/config.json `setup`).
 * Asserts on app state (APPLICATION_CONTEXT, VIEWER) and DOM, not screenshots.
 */
import {config} from "../fixtures/configurations"
import {default as utils} from "../support/utilities"

const launchViewer = (params, extra = {}) => {
    cy.launch({
        params: config.params(params),
        data: config.data('tissue'),
        background: config.background({}, 0),
        ...extra,
    });
    return utils.waitForViewer();
};

describe('Viewer params: deployment env defaults', () => {

    //resolves a ui.* default: nested ui key, then deprecated flat alias, then true
    const uiDefault = (setup, key) => {
        const nested = setup?.ui?.[key];
        if (nested !== undefined && nested !== null) return !!nested;
        const flat = setup?.[key];
        if (flat !== undefined && flat !== null) return !!flat;
        return true;
    };

    it('params omitted by the session fall back to ENV.setup and reach the UI', () => {
        launchViewer({}).then(win => {
            const ctx = win.APPLICATION_CONTEXT;
            //expectations come from the env, so the test holds under any XOPAT_ENV
            const setup = ctx.env.setup;

            //theme + debugMode pinned by the fixture
            expect(ctx.getOption("theme")).to.equal("dark");
            cy.get("body").should('have.attr', 'data-theme', 'xOpat-dark');
            expect(ctx.getOption("debugMode")).to.be.false;

            //ui visibility flags follow the deployment defaults
            const scaleBar = uiDefault(setup, "scaleBar");
            expect(ctx.getUiOption("scaleBar"), "scaleBar option").to.equal(scaleBar);
            expect(win.VIEWER.scalebar._active, "scalebar active").to.equal(scaleBar);
            cy.get("#osd-0-scale-bar").should(scaleBar ? 'be.visible' : 'not.be.visible');
            cy.get("#osd-0-navigator").should(
                uiDefault(setup, "navigator") ? 'be.visible' : 'not.be.visible');
            cy.get("#viewer-container-dock").should(
                uiDefault(setup, "globalMenu") ? 'be.visible' : 'not.be.visible');
            cy.get("#toolbar-checkbox input").should(
                uiDefault(setup, "toolBar") ? 'be.checked' : 'not.be.checked');
            cy.get("#main-menu-checkbox input").should(
                uiDefault(setup, "mainMenu") ? 'be.checked' : 'not.be.checked');

            cy.get("#top-side-badges").should(
                (setup.isStaticPreview ? '' : 'not.') + 'contain.text', 'Exported Session');

            const ids = ctx.shortcuts.list().map(s => s.id);
            if (setup.preventNavigationShortcuts) {
                expect(ids).to.not.include("core.viewport.zoomIn");
            } else {
                expect(ids).to.include("core.viewport.zoomIn");
            }
        });
    });
});

describe('Viewer params: theme, debugMode and ui.* visibility', () => {

    it('applies light theme, debug mode and hides scaleBar, navigator, toolBar and mainMenu', () => {
        launchViewer({
            theme: "light",
            debugMode: true,
            ui: {
                scaleBar: false,
                navigator: false,
                toolBar: false,
                mainMenu: false,
            },
        }).then(win => {
            const ctx = win.APPLICATION_CONTEXT;

            expect(ctx.getOption("theme")).to.equal("light");
            cy.get("body").should('have.attr', 'data-theme', 'xOpat-light');

            expect(ctx.getOption("debugMode")).to.be.true;
            cy.get("#debug-checkbox input").should('be.checked');

            expect(ctx.getUiOption("scaleBar"), "scaleBar option").to.be.false;
            //toolBar and mainMenu have no boot-visible DOM effect here,
            //so only the option state and its settings checkbox are asserted
            expect(ctx.getUiOption("toolBar"), "toolBar option").to.be.false;
            expect(ctx.getUiOption("mainMenu"), "mainMenu option").to.be.false;
            expect(win.VIEWER.scalebar._active, "scalebar active").to.be.false;
            cy.get("#osd-0-scale-bar").should('not.be.visible');
            cy.get("#osd-0-navigator").should('not.be.visible');
            cy.get("#toolbar-checkbox input").should('not.be.checked');
            cy.get("#main-menu-checkbox input").should('not.be.checked');
        });
    });
});

describe('Viewer params: viewport and activeBackgroundIndex', () => {

    it('opens at the requested viewport position', () => {
        const viewport = config.viewport('tissue', 0);
        launchViewer({viewport}).then(win => {
            //viewport apply may still be settling
            cy.waitUntil(() => Math.abs(win.VIEWER.viewport.getZoom() - viewport.zoomLevel) < 0.01, {
                description: "Waiting for the viewport zoom to settle.",
                timeout: 5000, interval: 200,
            });
            cy.then(() => {
                const center = win.VIEWER.viewport.getCenter();
                expect(center.x, "center x").to.be.closeTo(viewport.point.x, 0.01);
                expect(center.y, "center y").to.be.closeTo(viewport.point.y, 0.01);
            });
        });
    });

    it('activates the requested background', () => {
        launchViewer({activeBackgroundIndex: 1}, {
            background: config.background({}, 0, 1),
        }).then(win => {
            const active = win.APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
            expect(active, "normalized active background indexes").to.deep.equal([1]);

            const background = win.VIEWER.scalebar?.getReferencedTiledImage()?.getConfig("background");
            expect(background?.dataReference, "rendered background").to.equal(1);
        });
    });
});

describe('Viewer params: preventNavigationShortcuts', () => {

    it('keyboard zoom works when enabled and is disabled by the param', () => {
        const viewport = config.viewport('tissue', 0);

        //pinned explicitly so the deployment env cannot flip the baseline
        launchViewer({viewport, preventNavigationShortcuts: false}).then(win => {
            expect(win.APPLICATION_CONTEXT.shortcuts.list().map(s => s.id))
                .to.include("core.viewport.zoomIn");

            const zoomBefore = win.VIEWER.viewport.getZoom();
            cy.key("+");
            cy.waitUntil(() => win.VIEWER.viewport.getZoom() > zoomBefore + 0.1, {
                description: "Waiting for the keyboard shortcut to zoom in.",
                timeout: 5000, interval: 200,
            });
        });

        launchViewer({viewport, preventNavigationShortcuts: true}).then(win => {
            expect(win.APPLICATION_CONTEXT.shortcuts.list().map(s => s.id))
                .to.not.include("core.viewport.zoomIn");

            const zoomBefore = win.VIEWER.viewport.getZoom();
            cy.key("+");
            cy.wait(500);
            cy.then(() => {
                expect(win.VIEWER.viewport.getZoom(), "zoom unchanged").to.be.closeTo(zoomBefore, 0.001);
            });
        });
    });
});

describe('Viewer params: sanitization and deprecated aliases', () => {

    it('drops unknown params and honors the deprecated flat scaleBar alias', () => {
        launchViewer({
            scaleBar: false, //old form of ui.scaleBar, tests backward compatibility
            someUnknownParam: 42,
            ui: {unknownNestedParam: true},
        }).then(win => {
            const params = win.APPLICATION_CONTEXT._dangerouslyAccessConfig().params;
            expect(params, "unknown top-level key dropped").to.not.have.property("someUnknownParam");
            expect(params.ui || {}, "unknown nested key dropped").to.not.have.property("unknownNestedParam");

            expect(win.APPLICATION_CONTEXT.getUiOption("scaleBar"), "flat alias honored").to.be.false;
            expect(win.VIEWER.scalebar._active, "scalebar inactive").to.be.false;
            cy.get("#osd-0-scale-bar").should('not.be.visible');
        });
    });
});

describe('Viewer params: identity and limits', () => {

    it('applies sessionName, historySize, maxImageCacheCount and disablePluginsUi', () => {
        launchViewer({
            sessionName: "cypress-params-session",
            historySize: 7,
            maxImageCacheCount: 456,
            disablePluginsUi: true,
        }).then(win => {
            const ctx = win.APPLICATION_CONTEXT;

            expect(ctx.sessionName, "session name").to.equal("cypress-params-session");
            expect(ctx.history.BUFFER_LENGTH, "history buffer size").to.equal(7);
            expect(win.VIEWER.maxImageCacheCount, "OSD tile cache limit").to.equal(456);

            //plugins tab not registered at all
            expect(ctx.getOption("disablePluginsUi")).to.be.true;
            cy.get("#fullscreen-menu-service-b-app-plugins").should('not.exist');
            //fixture always sets bypassCookies
            cy.get("#cookies-checkbox input").should('be.checked');
        });
    });
});

describe('Viewer params: app chrome and static preview', () => {

    it('shows the static-preview banner, top notifications and hides the global menu dock', () => {
        launchViewer({
            isStaticPreview: true,
            notificationsPosition: "top",
            ui: {globalMenu: false},
        }).then(win => {
            expect(win.APPLICATION_CONTEXT.getOption("isStaticPreview")).to.be.true;
            cy.get("#top-side-badges").should('contain.text', 'Exported Session');
            cy.get("#dialogs-container").should('have.class', 'toast-top');
            cy.get("#viewer-container-dock").should('not.be.visible');
        });
    });

    it('appBar:false boots with the chrome collapsed', () => {
        launchViewer({ui: {appBar: false}}).then(win => {
            expect(win.APPLICATION_CONTEXT.getUiOption("appBar"), "appBar option").to.be.false;
            cy.get("#viewer-container-dock").should('not.be.visible');
            cy.get("#osd-0-navigator").should('not.be.visible');
        });
    });
});

describe('Viewer params: scroll-to-zoom policy', () => {

    const wheel = (opts = {}) => cy.canvas().trigger('wheel', {
        deltaY: -120, //wheel up
        clientX: 500, clientY: 350,
        bubbles: true,
        force: true, //without force Cypress refuses to fire events on the canvas
        ...opts,
    });

    //shared base for all scroll tests: every launch starts from these values
    //and each test overrides only the single flag it verifies
    const scrollBase = {scrollRequiresCtrl: false, reverseScroll: false, snapZoomToMagnification: true};

    it('plain wheel zooms and reverseScroll inverts the direction', () => {
        const viewport = config.viewport('tissue', 0);

        launchViewer({viewport, ...scrollBase}).then(win => {
            const zoomBefore = win.VIEWER.viewport.getZoom();
            wheel();
            cy.waitUntil(() => win.VIEWER.viewport.getZoom() > zoomBefore, {
                description: "Waiting for wheel-up to zoom in.",
                timeout: 5000, interval: 200,
            });
        });

        launchViewer({viewport, ...scrollBase, reverseScroll: true}).then(win => {
            const zoomBefore = win.VIEWER.viewport.getZoom();
            wheel();
            cy.waitUntil(() => win.VIEWER.viewport.getZoom() < zoomBefore, {
                description: "Waiting for wheel-up to zoom out with reverseScroll.",
                timeout: 5000, interval: 200,
            });
        });
    });

    it('snapZoomToMagnification snaps to stops when on, continuous when disabled', () => {
        const viewport = config.viewport('tissue', 0);

        //snap on: jumps to a magnification stop, not a zoomPerScroll multiple
        launchViewer({viewport, ...scrollBase}).then(win => {
            const zoomBefore = win.VIEWER.viewport.getZoom();
            wheel();
            cy.waitUntil(() => win.VIEWER.viewport.getZoom() > zoomBefore, {
                description: "Waiting for the snapped zoom-in.",
                timeout: 5000, interval: 200,
            });
            cy.then(() => {
                const continuous = zoomBefore * win.VIEWER.zoomPerScroll;
                expect(Math.abs(win.VIEWER.viewport.getZoom() - continuous),
                    "snapped zoom differs from the continuous step").to.be.greaterThan(0.1);
            });
        });

        //snap off: exactly one zoomPerScroll step
        launchViewer({viewport, ...scrollBase, snapZoomToMagnification: false}).then(win => {
            const zoomBefore = win.VIEWER.viewport.getZoom();
            wheel();
            cy.waitUntil(() => win.VIEWER.viewport.getZoom() > zoomBefore, {
                description: "Waiting for the continuous zoom-in.",
                timeout: 5000, interval: 200,
            });
            cy.then(() => {
                expect(win.VIEWER.viewport.getZoom(), "continuous zoomPerScroll step")
                    .to.be.closeTo(zoomBefore * win.VIEWER.zoomPerScroll, 0.01);
            });
        });
    });

    it('scrollRequiresCtrl ignores plain wheel and zooms with Ctrl held', () => {
        const viewport = config.viewport('tissue', 0);

        launchViewer({viewport, ...scrollBase, scrollRequiresCtrl: true}).then(win => {
            const zoomBefore = win.VIEWER.viewport.getZoom();
            wheel();
            cy.wait(500);
            cy.then(() => {
                expect(win.VIEWER.viewport.getZoom(), "zoom unchanged without Ctrl")
                    .to.be.closeTo(zoomBefore, 0.001);
            });
            wheel({ctrlKey: true});
            cy.waitUntil(() => Math.abs(win.VIEWER.viewport.getZoom() - zoomBefore) > 0.01, {
                description: "Waiting for Ctrl+wheel to zoom.",
                timeout: 5000, interval: 200,
            });
        });
    });
});

describe('Viewer params: canvas smoke', () => {

    //baseline is env+machine specific; other envs skip via --env skipPixelTests=1
    it('renders the expected scene at a fixed viewport', function () {
        if (Cypress.env('skipPixelTests')) this.skip();
        launchViewer({viewport: config.viewport('tissue', 0)}).then(win => {
            cy.waitUntil(() => win.VIEWER.world.getItemAt(0)?.getFullyLoaded(), {
                description: "Waiting for tiles at the fixed viewport.",
                timeout: 10000, interval: 300,
            });
            //let the renderer paint the last decoded tiles
            cy.wait(500);
            //per-browser baseline: rasterization differs across browsers
            cy.canvas().matchImage({title: `canvas-smoke-${Cypress.browser.name}`});
        });
    });
});
