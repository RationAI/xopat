
Playground.WorkFlow = class {

    constructor(context, selfName) {
        this.selfCall = `window.opener.plugin('${context.id}').${selfName}`;
        this.context = context;
        this.windowId = "playground-workflow";
        this._root = {children: []};
        this._active = this._root;
        this.capturingAll = false;

        const _this = this;
        VIEWER.addHandler('viewport-change', function () {
            if (_this.capturingAll) {
                _this.capture("move");
            }
        });
    }

    open() {
        let ctx = Dialogs.getModalContext(this.windowId);
        if (ctx) {
            ctx.window.focus();
            return;
        }
        Dialogs.showCustomModal(this.windowId, "Available algorithms", `
        <span class='f3-light'>Workflow</span> <span class="material-icons btn-pointer" id="enable-disable-playground" title="Enable/disable" style="float: right;" data-ref="on" onclick="
        let self = $(this);
        if (self.attr('data-ref') === 'on'){
            ${this.context.PLUGIN}.setEnabled(false); self.css('color', ''); self.attr('data-ref', 'off');
        } else {
            ${this.context.PLUGIN}.setEnabled(true); self.css('color', 'var(--color-bg-danger-inverse)'); self.attr('data-ref', 'on');
        }"> track_changes</span>`,
            `<div id="content">${this.refresh()}</div>
<script>
window.addEventListener("beforeunload", (e) => {
   //todo
}, false);
</script>`);

    }

    _getid() {
        return Date.now().toString(36);
    }

    refresh() {
        //todo
        let html = [];
        this._refresh(this._root, html);
        return html.join("");
    }

    _refresh(node, buffer) {
        for (let child of node.children) {
            buffer.push(this._getNodeHtml(node, child));
            this._refresh(child, buffer);
        }
    }

    capture(type) {
        let node = {
            type: type,
            children: [],
            config: JSON.stringify(this.context.configuration),
            algorithm: this.context.algorithm,
            data: this.context.data,
            image: VIEWER.tools.screenshot(true, VIEWER.viewport.getBounds())
        };
        this._active.children.push(node);

        let ctx = Dialogs.getModalContext(this.windowId);
        if (ctx && ctx.window) {
            let html = this._getNodeHtml(this._active, node);
            $(ctx.window.document.body).find(`#${this._active.id}`).append(html);
            this._active = node;
            $(ctx.window.document.body).find(`#${this._active.id}`).prepend(node.image);
        }
    }

    activate(id) {
        let node = this._findNode(this._root, id);
        if (node) {
            this.context.switchState(node.data, node.algorithm, JSON.parse(node.config));
            this._active = node;
        }
    }

    _findNode(node, id) {
        if (node.id === id) return node;
        for (let child of node.children) {
            let find = this._findNode(child, id);
            if (find) return find;
        }
        return undefined;
    }

    _getNodeHtml(parent, child) {
        let id = this._getid();
        child.id = id;
        if (parent.children.length < 1) {
            return `<li onclick="${this.selfCall}.activate('${id}');" id="${id}">${this._getNodeHtmlContent(child)}</li>`;
        }
        return `<ul><li onclick="${this.selfCall}.activate('${id}');" id="${id}">${this._getNodeHtmlContent(child)}</li></ul>`;
    }

    _getNodeHtmlContent(node) {
        if (node.type === "init") {
            return `${node.title}`;
        }

        if (node.type === "move") {
            return node.title;
        }
    }
};
