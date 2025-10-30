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
        return div({ class: 'mb-3' },
            label({ class: 'block mb-1 text-sm font-medium' }, labelText),
            fieldNode
        );
    }

    create() {
        if (this._el) return this._el;

        const schemaEl = input({ type: 'text', id: this.id + '-schema', class: 'input input-sm w-full', value: this.values.schema || '' });
        const nameEl = input({ type: 'text', id: this.id + '-name', class: 'input input-sm w-full', value: this.values.name || '' });
        const nsEl = input({ type: 'text', id: this.id + '-namespace', class: 'input input-sm w-full', value: this.values.namespace || '' });
        const descEl = textarea({ id: this.id + '-description', class: 'textarea textarea-sm w-full', rows: 4 }, this.values.description || '');
        const inputsEl = textarea({ id: this.id + '-inputs', class: 'textarea textarea-sm w-full', rows: 3 }, this.values.inputs || '');
        const outputsEl = textarea({ id: this.id + '-outputs', class: 'textarea textarea-sm w-full', rows: 3 }, this.values.outputs || '');
        const jobEl = input({ type: 'text', id: this.id + '-joburl', class: 'input input-sm w-full', value: this.values.jobUrl || '' });

        const btnEdit = button({ class: 'btn btn-secondary mr-2', type: 'button', onclick: (ev) => this._onEdit() }, 'Edit EAD');
        const btnCreate = button({ class: 'btn btn-primary', type: 'button', onclick: (ev) => this._onCreate() }, 'Create');

        const closeBtn = button({
            class: 'btn btn-xs btn-circle absolute right-2 top-2',
            type: 'button',
            title: 'Close',
            onclick: (ev) => {
                const el = this._el;
                if (el && el.parentNode) el.parentNode.removeChild(el);
            }
        }, '✕');
        const titleEl = div({ class: 'relative mb-3' },
            h3({ class: 'text-xl font-bold text-center' }, 'New App'),
            closeBtn
        );

        const form = div({ class: 'p-4 bg-base-200 border border-base-300 rounded-md max-w-2xl relative' },
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
