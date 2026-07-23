/**
 * Core hardening: a broken plugin/module must not be able to stop the viewer.
 *
 * OpenSeadragon dispatches handlers without try/catch and re-arms its
 * requestAnimationFrame loop only *after* the frame's handlers returned, so before
 * `src/classes/app/event-isolation.ts` a single throwing handler on an event raised
 * during the update cycle killed canvas rendering permanently.
 */
const SLIDE = ["https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"];

// Self-contained POST visit: these tests need no fixture slide server, only a viewer
// that opens something. Falls back to the local dev server.
const launch = () => {
    cy.visit({
        url: Cypress.env('viewer') || 'http://localhost:9000/',
        method: 'POST',
        body: JSON.stringify({
            visualization: {
                params: {
                    locale: "en",
                    bypassCookies: true,
                    theme: "dark",
                    webGlPreferredVersion: "2.0",
                    viewport: {"zoomLevel": 1.85, "point": {"x": 0.58, "y": 0.66}},
                },
                data: SLIDE,
                background: [{dataReference: 0, name: "FirstIndex", protocol: "data"}],
            }
        })
    });
    cy.waitUntil(() => cy.window().then(win => !!win.VIEWER && win.VIEWER.isOpen && win.VIEWER.isOpen()),
        {timeout: 60000, interval: 500});
};

describe('Core event isolation', () => {
    it('keeps rendering when a handler throws on every animation-finish', () => {
        launch();

        cy.window().then(win => {
            const viewer = win.VIEWER;
            win.__faultCalls = 0;
            win.__bad = () => {
                win.__faultCalls++;
                throw new Error("boom from a broken plugin");
            };
            win.__handlersBefore = viewer.numberOfHandlers('animation-finish');
            viewer.addHandler('animation-finish', win.__bad);
            expect(viewer.numberOfHandlers('animation-finish')).to.eq(win.__handlersBefore + 1);
        });

        // Each zoom raises animation-finish from inside updateOnce — exactly where an
        // unguarded throw leaves requestAnimationFrame unscheduled and kills the canvas.
        for (let i = 0; i < 4; i++) {
            cy.window().then(win => {
                win.VIEWER.viewport.zoomBy(1.1);
                win.VIEWER.viewport.applyConstraints();
            });
            cy.wait(700);
            cy.window().should(win => {
                expect(win.VIEWER._updateRequestId, `render loop alive after ${i + 1} zooms`).to.not.be.null;
            });
        }

        cy.window().should(win => {
            expect(win.__faultCalls, 'handler faulted').to.be.greaterThan(0);
            // Three consecutive faults ⇒ offender unregistered, other subscribers kept.
            expect(win.VIEWER.numberOfHandlers('animation-finish'), 'faulty handler unregistered')
                .to.eq(win.__handlersBefore);
        });

        // The loop must still run after removal: pan and confirm the viewport moves.
        cy.window().then(win => {
            win.__centerBefore = win.VIEWER.viewport.getCenter().x;
            win.VIEWER.viewport.panBy(new win.OpenSeadragon.Point(0.05, 0));
            win.VIEWER.viewport.applyConstraints();
        });
        cy.wait(700);
        cy.window().should(win => {
            expect(win.VIEWER.viewport.getCenter().x, 'viewport still animates').to.not.eq(win.__centerBefore);
        });
    });

    it('keeps the abort contract of before-* events', () => {
        launch();
        cy.window().then(win => {
            // Sync throw on an abort-critical event must still propagate to the raiser.
            win.VIEWER_MANAGER.addHandler('before-open', () => { throw new Error("abort!"); });
            expect(() => win.VIEWER_MANAGER.raiseEvent('before-open', {}), 'sync throw re-thrown')
                .to.throw('abort!');

            // An async handler's rejection must still reach raiseEventAwaiting.
            win.VIEWER_MANAGER.addHandler('before-app-init', async () => { throw new Error("async abort!"); });
            return win.VIEWER_MANAGER.raiseEventAwaiting('before-app-init', {}).then(
                () => { throw new Error("expected the awaiting raise to reject"); },
                (e) => { expect(String(e)).to.contain('async abort!'); }
            );
        });
    });

    it('still cancels a broadcast handler through the wrapper', () => {
        launch();
        cy.window().then(win => {
            let calls = 0;
            const handler = () => calls++;
            win.VIEWER_MANAGER.broadcastHandler('animation-finish', handler);

            win.VIEWER.viewport.zoomBy(1.1);
            win.VIEWER.viewport.applyConstraints();
            cy.wait(700).then(() => {
                expect(calls, 'broadcast handler fires').to.be.greaterThan(0);
                const seen = calls;

                win.VIEWER_MANAGER.cancelBroadcast('animation-finish', handler);
                win.VIEWER.viewport.zoomBy(1.1);
                win.VIEWER.viewport.applyConstraints();
                cy.wait(700).then(() => {
                    expect(calls, 'handler no longer fires after cancelBroadcast').to.eq(seen);
                });
            });
        });
    });

    it('quarantines a module whose constructor throws', () => {
        launch();
        cy.on('uncaught:exception', () => false);

        cy.window().then(win => {
            // A registered, not-yet-instantiated module id (throwaway page, so
            // re-registering the id under a failing class is harmless).
            const id = Object.keys(win.xmodules)
                .find(k => !k.startsWith('ViewerInstance::') && !win.xmodules[k].__self);
            expect(id, 'found a registered, uninstantiated module id to test with').to.be.a('string');

            const failed = [];
            win.VIEWER_MANAGER.addHandler('module-failed', e => failed.push(e.id));

            const Bad = class extends win.XOpatModuleSingleton {
                constructor() {
                    super();
                    // Register a handler first: quarantine must tear it back down.
                    win.VIEWER.addHandler('animation-finish', () => {});
                    throw "synthetic boom";
                }
            };
            const handlersBefore = win.VIEWER.numberOfHandlers('animation-finish');
            win.addModule(id, Bad);

            let first, second;
            try { Bad.instance(); } catch (e) { first = String(e); }
            try { Bad.instance(); } catch (e) { second = String(e); }

            expect(first, 'original error propagates to the caller').to.contain('synthetic boom');
            expect(second, 'later instance() fails loudly instead of returning a half-built object')
                .to.contain('failed to load and was disabled');
            expect(Bad.__self, 'half-built instance dropped').to.eq(undefined);
            expect(failed, 'module-failed raised').to.contain(id);
            expect(String(Bad.__failed), 'module marked failed').to.contain('synthetic boom');
            expect(win.VIEWER.numberOfHandlers('animation-finish'), 'handlers of the dead module removed')
                .to.eq(handlersBefore);
        });
    });
});
