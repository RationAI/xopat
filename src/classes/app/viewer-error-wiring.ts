// Wires the user-facing error/warning broadcast handlers onto VIEWER_MANAGER.
// Extracted from src/app.ts. Three of these are documented as VIEWER events
// (`warn-user`, `error-user`, `add-item-failed`) — keeping the JSDoc bodies
// here so the doc generator picks them up.

import type OpenSeadragon from "openseadragon";

export function wireViewerErrorHandlers(viewerManager: any): void {
    /**
     * Event to fire if you want to avoid explicit warning handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires a dialog with provided message if not handled.
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event warn-user
     */
    viewerManager.broadcastHandler('warn-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_WARN, false);
    }, null, -Infinity);
    /**
     * Event to fire if you want to avoid explicit error handling,
     * recommended in modules where module should give plugin chance hande it.
     * The core fires an error dialog with provided message if not handled.
     * @property originType: `"module"`, `"plugin"` or other type of the source
     * @property originId: unique code component id, e.g. a plugin id
     * @property code: unique error identifier, e.g. W_MY_MODULE_ERROR
     * @property message: a brief description of the case
     * @property preventDefault: if true, the core will not fire default event
     * @property trace: optional data or context object, e.g. an error object from an exception caught
     * @memberOf OpenSeadragon.Viewer
     * @event error-user
     */
    viewerManager.broadcastHandler('error-user', (e: ErrorUserEvent) => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50 * e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, null, -Infinity);
    viewerManager.broadcastHandler('plugin-failed', (e: PluginFailedEvent) => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));

    let notified = false;
    //todo error?
    viewerManager.broadcastHandler('add-item-failed', (e: OpenSeadragon.ViewerEventMap["add-item-failed"] & OpenSeadragon.ViewerEvent) => {
        if (notified) return;
        const msg = e.message;
        const statusCode = msg && typeof msg !== 'string' ? msg.statusCode : undefined;
        if (statusCode) {
            //todo check if the first background
            switch (statusCode) {
                case 401:
                    e.eventSource.getMenu().getNavigatorTab().setTitle($.t('main.global.tissue'), true);
                    Dialogs.show($.t('error.slide.401'),
                        20000, Dialogs.MSG_ERR);
                    XOpatUser.instance().logout(); //todo really logout? maybe request login instead?
                    break;
                case 403:
                    e.eventSource.getMenu().getNavigatorTab().setTitle($.t('main.global.tissue'), true);
                    Dialogs.show($.t('error.slide.403'),
                        20000, Dialogs.MSG_ERR);
                    break;
                case 404:
                    Dialogs.show($.t('error.slide.404'),
                        20000, Dialogs.MSG_ERR);
                    break;
                default:
                    break;
            }
            notified = true;
        } else {
            // Error is thrown by OSD
            console.info('Item failed to load and the event does not contain reliable information to notify user. Notification was bypassed.');
        }
    });
}
