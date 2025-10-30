import van from "../../ui/vanjs.mjs";
import { BaseComponent } from "../../ui/classes/baseComponent.mjs";

const { div, input, textarea, span, button, label, h3 } = van.tags;

class NewAppForm extends BaseComponent {
    constructor(options = {}) {
        options = super(options).options;
        this.id = options.id || 'new-app';
        this.onSubmit = options.onSubmit || (() => {});
        this.values = options.values || {};
        this._el = null;
        this._fields = {};
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

        const closeBtn = button({
            class: 'btn btn-xs btn-circle absolute right-2 top-2',
            type: 'button',
            title: 'Close',
            onclick: (ev) => {
                const el = this._el;
                if (!el) return;
                // Prefer removing the wrapper/container the form was attached into so
                // reopening the dialog places it in the same position instead of
                // creating another sibling wrapper to the right.
                const wrapper = el.parentNode;
                if (wrapper && wrapper.parentNode) {
                    wrapper.parentNode.removeChild(wrapper);
                } else if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }
        }, '✕');
        const titleEl = div({ class: 'relative mb-2' },
            h3({ class: 'text-base font-bold text-center' }, 'New App'),
            closeBtn
        );

        const form = div({ class: 'p-2 bg-base-200 border border-base-300 rounded-md max-w-full relative', style: 'max-width:420px;width:100%;' },
            titleEl,
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

        this._el = form;
        return this._el;
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
        console.info('Edit EAD clicked', this._serialize());
    }

    _onCreate() {
        const data = this._serialize();
        try {
            const r = this.onSubmit(data);
            if (r !== false) console.info('Create submitted', data);
        } catch (e) {
            console.error('NewAppForm onSubmit error', e);
        }
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
