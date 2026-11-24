const { div, span, button, i } = globalThis.van.tags;

/**
 * The control that binds a class to one mouse button. One definition, so the
 * side panel, the toolbar picker and the class editor all show the same thing:
 * a mouse glyph, solid when that button paints with the class, faint otherwise.
 *
 * @param {object} opts
 * @param {boolean} opts.isLeft which mouse button
 * @param {boolean} opts.bound whether the class is bound to it now
 * @param {string} opts.title tooltip
 * @param {boolean} [opts.disabled]
 * @param {(e: MouseEvent) => void} opts.onclick
 * @return {HTMLButtonElement}
 */
export function presetBindButton({ isLeft, bound, title, disabled = false, onclick }) {
    const node = button({
        type: 'button',
        title,
        disabled,
        'aria-pressed': bound ? 'true' : 'false',
        'data-bind-side': isLeft ? 'left' : 'right',
        onclick: (e) => { e.stopPropagation(); onclick?.(e); },
    }, i({ class: `ph-light ${isLeft ? 'ph-mouse-left-click' : 'ph-mouse-right-click'} text-sm` }));
    paintPresetBindButton(node, isLeft, bound);
    return node;
}

/** Restyle a button from {@link presetBindButton} after the binding changed. */
export function paintPresetBindButton(node, isLeft, bound) {
    const tone = isLeft ? 'btn-primary' : 'btn-secondary';
    node.className = `btn btn-xs btn-square shrink-0 ${bound ? tone : 'btn-ghost opacity-30 hover:opacity-100'}`;
    node.setAttribute('aria-pressed', bound ? 'true' : 'false');
}

/**
 * List of annotation classes with their mouse-button bindings — the one class
 * picker, used wherever a class is chosen for drawing.
 *
 * Clicking a row binds its class to the button it was clicked with (left click
 * → left button, right click → right button); the two glyph buttons do the same
 * explicitly, and are the only way to release a binding, so a stray click on an
 * already-active class never unbinds it.
 *
 * View only: it is handed rows and reports intent through `onBind`.
 *
 * @typedef {object} PresetBindRow
 * @property {string} id preset id
 * @property {string} name display name
 * @property {string} [color]
 * @property {string|null} [slotKey] key bound to the class's slot, if any
 * @property {boolean} [dimmed] not preferred in the current context
 */
export class PresetBindList extends UI.BaseComponent {
    /**
     * @param {object} opts
     * @param {PresetBindRow[]} opts.rows
     * @param {string} [opts.leftId] class bound to the left button
     * @param {string} [opts.rightId] class bound to the right button
     * @param {boolean} [opts.disabled]
     * @param {string} [opts.maxHeight] CSS max-height of the scrolling list
     * @param {Node} [opts.empty] shown when there are no rows
     * @param {(key: string) => string} opts.t
     * @param {(id: string, isLeft: boolean, explicit: boolean) => void} opts.onBind
     *   `explicit` is true for the glyph buttons (may release), false for a row click
     */
    constructor({ rows, leftId, rightId, disabled, maxHeight, empty, t, onBind }) {
        super({ extraClasses: {} });
        this.rows = Array.isArray(rows) ? rows : [];
        this.leftId = leftId;
        this.rightId = rightId;
        this.disabled = !!disabled;
        this.maxHeight = maxHeight;
        this.empty = empty;
        this.t = typeof t === 'function' ? t : (k) => k;
        this.onBind = onBind;
        this.classMap = { base: 'flex flex-col gap-0.5 overflow-y-auto' };
    }

    create() {
        if (this.root) return this.root;
        const root = div({ ...this.commonProperties });
        if (this.maxHeight) root.style.maxHeight = this.maxHeight;
        if (this.disabled) {
            root.style.opacity = '0.5';
            root.style.pointerEvents = 'none';
        }
        if (!this.rows.length) {
            if (this.empty) root.append(this.empty);
        } else {
            for (const row of this.rows) root.append(this._row(row));
        }
        this.root = root;
        return root;
    }

    _row(row) {
        const isLeft = row.id === this.leftId;
        const isRight = row.id === this.rightId;
        const bind = (asLeft, explicit) => { if (!this.disabled) this.onBind?.(row.id, asLeft, explicit); };

        // Set through the DOM so a user-supplied colour never lands in markup.
        const tag = i({ class: 'ph-light ph-tag text-base shrink-0' });
        tag.style.color = row.color || '';

        return div({
                class: `flex items-center gap-2 pl-1.5 pr-1 py-0.5 rounded-lg transition-colors cursor-pointer ${(isLeft || isRight) ? 'bg-base-300' : 'hover:bg-base-300/50'} ${row.dimmed ? 'opacity-50' : ''}`.trim(),
                'data-preset-id': row.id,
                title: row.name,
                onclick: () => bind(true, false),
                oncontextmenu: (e) => { e.preventDefault(); bind(false, false); },
            },
            tag,
            span({ class: 'truncate flex-1 min-w-0 text-xs font-medium' }, row.name),
            row.slotKey ? span({ class: 'kbd kbd-xs opacity-60 shrink-0' }, row.slotKey) : null,
            presetBindButton({
                isLeft: true, bound: isLeft, disabled: this.disabled,
                title: this.t('annotations.viewerMenu.leftClickPreset'),
                onclick: () => bind(true, true),
            }),
            presetBindButton({
                isLeft: false, bound: isRight, disabled: this.disabled,
                title: this.t('annotations.viewerMenu.rightClickPreset'),
                onclick: () => bind(false, true),
            })
        );
    }
}
