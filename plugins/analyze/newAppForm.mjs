import van from "../../ui/vanjs.mjs";
import { BaseComponent } from "../../ui/classes/baseComponent.mjs";
import { FloatingWindow } from "../../ui/classes/components/floatingWindow.mjs";

const { div, input, textarea, span, button, label, h3 } = van.tags;

class NewAppForm extends BaseComponent {
    constructor(options = {}) {
        options = super(options).options;
        this.id = options.id || 'new-app';
        this.onSubmit = options.onSubmit || (() => {});
        this.values = options.values || {};
        this._el = null;
        this._fields = {};
        this._floatingWindow = null;
    }

    _row(labelText, fieldNode) {
        return div({ class: 'mb-2' },
            label({ class: 'block mb-1 text-xs font-medium' }, labelText),
            fieldNode
        );
    }

    create() {
        if (this._el) return this._el;

    // use explicit inline sizing so styles apply even if utility classes are missing
    const smallInputStyle = 'height:30px;padding:4px 6px;font-size:12px;line-height:1.1;box-sizing:border-box;';
    const smallTextareaBase = 'padding:6px 6px;font-size:12px;line-height:1.2;box-sizing:border-box;resize:vertical;';
    const schemaEl = input({ type: 'text', id: this.id + '-schema', class: 'input w-full', style: smallInputStyle, value: this.values.schema || '' });
    const nameEl = input({ type: 'text', id: this.id + '-name', class: 'input w-full', style: smallInputStyle, value: this.values.name || '' });
    const nsEl = input({ type: 'text', id: this.id + '-namespace', class: 'input w-full', style: smallInputStyle, value: this.values.namespace || '' });
    const descEl = textarea({ id: this.id + '-description', class: 'textarea w-full', style: smallTextareaBase + 'height:64px;', rows: 4 }, this.values.description || '');
    const inputsEl = textarea({ id: this.id + '-inputs', class: 'textarea w-full', style: smallTextareaBase + 'height:48px;', rows: 3 }, this.values.inputs || '');
    const outputsEl = textarea({ id: this.id + '-outputs', class: 'textarea w-full', style: smallTextareaBase + 'height:48px;', rows: 3 }, this.values.outputs || '');
    const jobEl = input({ type: 'text', id: this.id + '-joburl', class: 'input w-full', style: smallInputStyle, value: this.values.jobUrl || '' });

    const btnEdit = button({ class: 'btn btn-secondary btn-sm mr-2', type: 'button', onclick: (ev) => this._onEdit() }, 'Edit EAD');
    const btnCreate = button({ class: 'btn btn-primary btn-sm', type: 'button', onclick: (ev) => this._onCreate() }, 'Create');

    // remove inner title and close button to rely on the FloatingWindow header
    // increase top padding so the FloatingWindow title has breathing room
    const form = div({ class: 'p-4 bg-base-200 border border-base-300 rounded-md max-w-full relative', style: 'max-width:420px;width:100%;' },
            this._row('Schema:', schemaEl),
            this._row('Name:', nameEl),
            this._row('Namespace:', nsEl),
            this._row('Description:', descEl),
            this._row('Inputs:', inputsEl),
            this._row('Outputs:', outputsEl),
            this._row('Job URL:', jobEl),
            div({ class: 'mt-4 flex gap-2 justify-end' }, btnEdit, btnCreate)
        );

        this._fields = {
            schema: schemaEl,
            name: nameEl,
            namespace: nsEl,
            description: descEl,
            inputs: inputsEl,
            outputs: outputsEl,
            jobUrl: jobEl
        };

        // make the form fill available height inside a FloatingWindow and layout vertically
        try {
            this._el = form;
            // allow flex layout to let textareas expand/shrink with window
            this._el.style.display = 'flex';
            this._el.style.flexDirection = 'column';
            this._el.style.height = '100%';

            // ensure textareas grow and shrink with the container (min-height:0 prevents overflow)
            const makeFlexTA = (el) => {
                if (!el) return;
                el.style.flex = '1 1 auto';
                el.style.minHeight = '0';
                // keep existing padding/box sizing
            };
            makeFlexTA(this._fields.description);
            makeFlexTA(this._fields.inputs);
            makeFlexTA(this._fields.outputs);

            // push buttons to bottom
            const btnContainer = this._el.querySelector('.mt-4');
            if (btnContainer) btnContainer.style.marginTop = 'auto';
        } catch (e) {
            // non-fatal: fall back to previous behavior
            this._el = form;
        }

        return this._el;
    }

    /**
     * Close helper: prefer closing a floating window if we opened one;
     * otherwise close the parent Dialog via Dialogs.closeWindow if present,
     * fallback to removing the element from DOM (legacy behavior).
     */
    _close() {
        try {
            if (this._floatingWindow) {
                try { this._floatingWindow.close(); } catch(_) {}
                this._floatingWindow = null;
                return;
            }
            // if inside a Dialog created via Dialogs.showCustom, find the dialog root
            let root = this._el && this._el.closest ? this._el.closest('[data-dialog="true"]') : null;
            if (root && root.id && window.USER_INTERFACE && USER_INTERFACE.Dialogs && typeof USER_INTERFACE.Dialogs.closeWindow === 'function') {
                try { USER_INTERFACE.Dialogs.closeWindow(root.id); return; } catch (_) {}
            }
            // fallback: traditional removal of the attached wrapper
            const el = this._el;
            if (!el) return;
            const wrapper = el.parentNode;
            if (wrapper && wrapper.parentNode) {
                wrapper.parentNode.removeChild(wrapper);
            } else if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        } catch (e) { console.error('NewAppForm _close error', e); }
    }

    _serialize() {
        const f = this._fields;
        const getVal = (el) => (el && el.value !== undefined) ? el.value : (el && el.textContent) || '';
        return {
            schema: getVal(f.schema),
            name: getVal(f.name),
            namespace: getVal(f.namespace),
            description: getVal(f.description),
            inputs: getVal(f.inputs),
            outputs: getVal(f.outputs),
            jobUrl: getVal(f.jobUrl),
        };
    }

    _onEdit() {
    }

    _onCreate() {
        const data = this._serialize();
        try {
            const r = this.onSubmit(data);
            if (r !== false) {
                try { if (this._floatingWindow) { this._floatingWindow.close(); this._floatingWindow = null; } } catch(_) {}
            }
        } catch (e) {
            console.error('NewAppForm onSubmit error', e);
        }
    }

    /**
     * Show this form inside a FloatingWindow. Returns the FloatingWindow instance.
     * Options may include width/height/title.
     */
    showFloating(opts = {}) {
        try {
            if (this._floatingWindow) return this._floatingWindow;
            const id = this.id + '-window';
            // compute centered start position when possible
            const width = opts.width || 420;
            // increase default height so the form fits comfortably; still allows scrolling
            const height = opts.height || 520;
            const startLeft = (typeof window !== 'undefined') ? Math.max(8, Math.round((window.innerWidth - width) / 2)) : (opts.startLeft || 64);
            const startTop = (typeof window !== 'undefined') ? Math.max(8, Math.round((window.innerHeight - height) / 2)) : (opts.startTop || 64);
            const w = new FloatingWindow({ id, title: opts.title || 'New App', width, height, startLeft, startTop, onClose: () => { this._floatingWindow = null; } }, );
            // attach window to body so it is visible
            w.attachTo(document.body);
            // wrap the form in a scrollable card-body so FloatingWindow keeps expected layout
            const wrapper = document.createElement('div');
            wrapper.className = 'card-body p-3 gap-2 overflow-auto';
            wrapper.style.height = '100%';
            wrapper.appendChild(this.create());
            // set the body to our wrapper node
            w.setBody(wrapper);
            this._floatingWindow = w;
            return w;
        } catch (e) { console.error('NewAppForm showFloating error', e); }
        return null;
    }

    attachTo(parent) {
        const target = (typeof parent === 'string') ? document.getElementById(parent) : parent;
        if (!target) throw new Error('attachTo: parent not found');
        target.appendChild(this.create());
    }

    getValues() {
        return this._serialize();
    }
}

export { NewAppForm };
