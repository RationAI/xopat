Playground.AlgorithmMenu = class {

    constructor(context, selfName) {
        this.refreshFormsCall = `window.opener.plugin('${context.id}').refreshMenuForms`;
        this.windowId = "pp_algo_list";
        this.algoChangedCall = `window.opener.plugin('${context.id}').switchAlgorithm`;
        this.context = context;
    }

    open(fromJSON, activeAlgId, refresh=false) {
        let ctx = Dialogs.getModalContext(this.windowId),
            parsed = this._algoDataToHtml(fromJSON, activeAlgId);

        if (ctx) {
            if (!ctx.window) {
                Dialogs.closeWindow(this.windowId);
                return parsed[1];
            }
            try {
                if (refresh) ctx.window.getElementById("content").innerHTML = parsed[0];
                ctx.window.focus();
            } catch (e) {
                console.warn("The stupid error TODO fix", e);
            }
            return parsed[1];
        }

        const _this = this;
        Dialogs.showCustomModal(this.windowId, "Available algorithms", `
        <span class='f3-light'>Available Algorithms</span> <span style="float: right;" class="material-icons btn-pointer" onclick="${this.refreshFormsCall}()">refresh</span>`,
            `<div id="content">${parsed[0]}</div>
<style>
img { width:75px; min-height: 60px; border: 1px solid var(--color-bg-tertiary); }
.opened .to-open { display: block !important; }
.opened .material-icons { transform: rotate(90deg); }
input:checked + label { background-color: var(--color-btn-primary-selected-bg); }
</style>
<script>
window.addEventListener("beforeunload", (e) => {
    ${this.refreshFormsCall}();
}, false);
</script>`);

        return parsed[1];
    }

    cacheInputs() {
        const _this = this;
        this._cache = {};
        let ctx = Dialogs.getModalContext(this.windowId);
        if (!ctx) return;
        let body = ctx.window.document.body;
        $(body).find(".playground-inputs-own-content").each((i, item) => {
            let node = $(item);
            if (node) _this._cache[node.data("id")] = node.serializeArray();
        });
    }

    getCachedInput(id) {
        return this._cache[id] || [];
    }

    _algoDataToHtml(data, activeAlgId) {
        let html = [];

        //todo also set cached values if available
        let bg = "";
        for (let algoId in data) {
            if (data.hasOwnProperty(algoId)) {
                let content = data[algoId];
                let controlContent = "";

                if (content.hasOwnProperty("error")) {
                    controlContent = `<label class="btn v-align-top mt-2" disabled>
<span class="material-icons p-0" style="font-size: 16px;margin-top: -2px;margin-left: -4px;">warning</span> Error</label><div>
<span class="d-block" style="cursor:pointer;" onclick="$(this).parent().toggleClass('opened');">
<span class="material-icons" style="font-size: 18px; padding-bottom: 1px;">chevron_right</span> Error details</span>
<div class="to-open" style="display: none;">${content.error}</div></div>`;
                    bg = "background: var(--color-bg-tertiary);"
                } else {
                    if (!activeAlgId) activeAlgId = algoId;

                    let checked = activeAlgId === algoId ? "checked" : "";
                    controlContent = `<input type="radio" name="algorithm" id="${algoId}-radio" ${checked} class="d-none" value="${algoId}" 
onchange="${this.algoChangedCall}(this.value);"><label for="${algoId}-radio" class="btn v-align-top mt-2">Select</label>`;
                    if (content.data.hasOwnProperty("html")) {
                        controlContent += `<div>
<span class="d-block" style="cursor:pointer;" onclick="$(this).parent().toggleClass('opened');">
<span class="material-icons" style="font-size: 18px; padding-bottom: 1px;">chevron_right</span> More</span>
<form class="playground-inputs-own-content d-none to-open" data-id="${algoId}">${content.data.html}</form></div>`;}
                }

                html.push(`
<div id="${algoId}" class="mb-2 p-1" style="${bg}">
<img src="data:image/png;base64, ${content.icon}" class="p-1 rounded-3 d-inline-block">
<div class="d-inline-block v-align-top pl-1" style="width: calc(100% - 170px);">
<span class="f3-light">${content.title}</span><p>${content.description}</p></div>
${controlContent}</div>`);
            }
        }
        html = html.join("");
        return [html, activeAlgId];
        //return [html, Object.keys(data)[1]];
    }
};
