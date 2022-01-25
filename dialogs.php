<?php
/*---------------------------------------------------------*/
/*------------ DIALOGS ------------------------------------*/
/*--All PHP variables are inherited from index.php---------*/
/*---------------------------------------------------------*/
?>
<script type="text/javascript">

/**
 * GUI messaging system:
 *  show(...) and hide(...) to post announcement and notices
 *
 *  showCustom(...) to show a content window with custom HTML content, dependent on unique container ID
 *  showCustomModal(...) to show a content in separate browser window, where
 *      getModalContext(...) will get the context of the window (note: recommended not to store a reference)
 *      if context fails in condition, the window failed to open or is closed by the user
 *      use context.opener to get reference to the original (parent) window
 */
var Dialogs = {
    MSG_INFO: { class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' },
    MSG_WARN: { class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />' },
    MSG_ERR: { class: "Toast--error", icon: '<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />' },
    _timer: null,
    _modals: {},

    init: function() {
        $("body").append(`<div id="annotation-messages-container" class="Toast popUpHide position-fixed" style='z-index: 5050; transform: translate(calc(50vw - 50%));'>
          <span class="Toast-icon"><svg width="12" height="16" id="annotation-icon" viewBox="0 0 12 16" class="octicon octicon-check" aria-hidden="true"></svg></span>
          <span id="annotation-messages" class="Toast-content v-align-middle" style="max-width: 350px;"></span>
          <button class="Toast-dismissButton" onclick="Dialogs._hideImpl(false);">
          <svg width="12" height="16" viewBox="0 0 12 16" class="octicon octicon-x" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"/></svg>
          </button>
          </div>`);

        this._body = $("#annotation-messages-container");
        this._board = $("#annotation-messages");
        this._icon = $("#annotation-icon");

        const _this = this;

        //close all child modals if parent dies
        window.onunload = function () {
            for (let key in _this._modals) {
                if (_this._modals.hasOwnProperty(key)) {
                    let context = _this._modals[key];
                    context.window.close();
                    _this._destroyModalWindow(key, context);
                }
            }
        }
    },

    /**
     * Show notification
     * @param text notification, html-formatted support
     * @param delayMS miliseconds to wait before auto close
     *          use values < 1000 to not to close at all
     * @param importance Dialogs.MSG_[INFO/WARN/ERR] object
     */
    show: function (text, delayMS, importance) {
        this._board.html(text);
        this._icon.html(importance.icon);
        this._body.removeClass(); //all
        this._body.addClass(`Toast position-fixed ${importance.class}`)
        this._body.removeClass("popUpHide");
        this._body.addClass("popUpEnter");

        if (delayMS > 1000) {
            this._timer = setTimeout(this.hide.bind(this), delayMS);
        }
    },

    /**
     * Hide notification
     */
    hide: function () {
        this._hideImpl(true);
    },

    _hideImpl: function(timeoutCleaned) {
        this._body.removeClass("popUpEnter");
        this._body.addClass("popUpHide");

        if (!timeoutCleaned && this._timer) {
            clearTimeout(this._timer);
        }
        this._timer = null;
    },

    /**
     * Show custom/dialog window
     * @param parentId unique ID of the dialog container, you can hide the window by removing this ID from DOM
     *  might not complete or remove existing ID if not unique
     * @param header HTML content to put in the header
     * @param content HTML content
     * @param footer HTML content to put to the footer
     * @param params
     * @param params.defaultHeight custom height, can be a CSS value (string) or a number (pixels)
     * @param params.allowClose whether to show 'close' button, default true
     * @param params.allowResize whether to allow user to change the window size, default false
     */
    showCustom: function(parentId, header, content, footer, params={allowClose:true}) {
        let result = this._buildComplexWindow(false, parentId, header, content, footer,
            `class="position-fixed" style="z-index:999; left: 50%;top: 50%;transform: translate(-50%,-50%);"`, params);
        if (result) $("body").append(result);
    },

    /**
     * Show custom/dialog in a separate browser window
     *  note: the window context does not have to be immediately available
     *  to get the window context, call getModalContext(..)
     *  to perform event-like calls, use the context and register appropriate events on the new window
     * @param parentId unique ID to the modals context (does not have to be unique in this DOM, it has a different one)
     * @param title non-formatted title string (for messages, window title tag...)
     * @param header HTML content to put in the header
     * @param content HTML content
     */
    showCustomModal: function(parentId, title, header, content) {
        if (this.getModalContext(parentId)) {
            console.warn("Modal window " + title + " with id '" + parentId + "' already exists.");
            return;
        }

        this._showCustomModalImpl(parentId, title, this._buildComplexWindow(true, parentId, header, content, '',
            `style="width: 100%; height: 100%"`, {defaultHeight: "100%"}));
    },

    /**
     * Gets the context of a modal window,
     * destroys and cleans the context if necessary (e.g. window was closed by the user)
     * @param id id used to create the window
     * @returns {{self}|{window}|null} window context or undefined
     */
    getModalContext: function(id) {
        let ctx = this._modals[id];
        if (!ctx) return undefined;

        //for some reason does not work without checking 'opener' while inspector closed
        if (!ctx.window || !ctx.opener || !ctx.self) {
            this._destroyModalWindow(id, ctx);
            return null;
        }
        return ctx;
    },

    /**
     * Closes any dialog (modal or not)
     * @param id id used to create the window
     * @returns {boolean} true if managed to close
     */
    closeWindow: function(id) {
        if (!id) {
            console.error("Invalid form: unique container id not defined.");
            return false;
        }

        let node = document.getElementById(id);
        if (node && node.dataset.dialog !== "true") {
            console.error("Invalid form: identifier not unique.");
            return false;
        }
        if (node) $(node).remove();

        let ctx = this._modals[id];
        if (ctx) {
            if (ctx.window) ctx.window.close();
            this._destroyModalWindow(id, ctx);
        }
        return true;
    },

    _showCustomModalImpl: function(id, title, html) {
        if (html) this._cachedHtml = html;
        else html = this._cachedHtml;
        if (!html) return;

        let win = this._openModalWindow(id, title, html);
        if (!win) {
            this.show(`An application modal window '${title}' was blocked by your browser. <a onclick="
Dialogs._showCustomModalImpl('${id}', '${title}', null, null); Dialogs.hide();" class='pointer'>Click here to open.</a>`,
                15000, this.MSG_WARN);
        } else {
            const callback = this._cachedOnload;
            this._modals[id] = win;
            if (callback) {
                win.window.addEventListener('load', function () {
                    callback();
                });
            }
            delete this._cachedHtml;
            delete this._cachedOnload;
        }
    },

    _openModalWindow: function(id, title, content) {
        //todo clean up also object URL? or is it freed automatically? revokeURL...
        return window.open(URL.createObjectURL(
            new Blob([`
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <link rel="stylesheet" href="<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/style.css">
        <link rel="stylesheet" href="<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/external/primer_css.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <script src="https://code.jquery.com/jquery-3.5.1.min.js"><\/script>
    </head>
    <body style="overflow: hidden; height: 100vh;">
    ${content}
    </body>
</html>
`], { type: "text/html" })), id, 'width=450,height=250');
    },

    _destroyModalWindow: function(id, context) {
        //important to clean up
        let body = context.document.getElementById("body");
        if (body) body.innerHTML = "";
        delete this._modals[id];
    },

    _buildComplexWindow: function(isModal, parentId, title, content, footer, positionStrategy, params) {
        //preventive close, applies to non-modals only
        if (!isModal && !this.closeWindow(parentId)) return;
        params = params || {};
        let height = params.defaultHeight === undefined ? "" :
            (typeof params.defaultHeight === "string" ? params.defaultHeight : params.defaultHeight+"px");

        let close = params.allowClose ? this._getCloseButton(parentId) : '';
        let resize = params.allowResize ? "resize:vertical;" : "";
        footer = footer ? `<div class="position-absolute bottom-0 right-0 left-0 border-top"
style="border-color: var(--color-border-primary);">${footer}</div>` : "";

        let limits = isModal ? "style='width: 100%; height: 100vh;'" : "style='max-width:80vw; max-height: 80vh'";
        let diaClasses = isModal ? "" : "Box Box--overlay";

        return `<div id="${parentId}" data-dialog="true" ${positionStrategy}>
<details-dialog class="${diaClasses} d-flex flex-column" ${limits}>
    <div class="Box-header" id="${parentId}-header">
      ${close}
      <h3 class="Box-title">${title}</h3>
    </div>
    <div class="overflow-auto position-relative" style="${resize} height: ${height}; min-height: 63px;">
      <div class="Box-body pr-2" style="padding-bottom: 45px; min-height: 100%">
	  ${content}
	  </div>
       ${footer}
    </div>
</details-dialog>
</div>`;
    },

    _getCloseButton: function(id) {
        return `<button class="Box-btn-octicon btn-octicon float-right" type="button"
aria-label="Close help" onclick="Dialogs.closeWindow('${id}')">
<svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true">
<path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77
4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg></button>`;
    }
}; // end of namespace Dialogs
Dialogs.init();
</script>
