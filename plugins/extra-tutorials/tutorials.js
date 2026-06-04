// Allowlist for text fields exposed to the embedder. Mirrors what we've been
// using in tutorial copy (<b>, <br/>, <code>, <i>, <em>). All attributes are
// stripped (no style/class/on*); unknown tags are unwrapped to text.
const SANITIZE_OPTS = {
    allowedTags: ['b','strong','i','em','u','br','code','span','sub','sup'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    allowedSchemes: [],
};

const cleanHtml = (s) => (typeof s === 'string' ? SanitizeHtml(s, SANITIZE_OPTS) : s);

// `image` is a URL, not HTML — reject javascript: schemes; allow http(s)/data/relative.
const cleanImage = (s) => {
    if (typeof s !== 'string') return s;
    return /^\s*javascript:/i.test(s) ? '' : s;
};

// `gradient` is a CSS background string. Reject anything with HTML brackets or
// a javascript: scheme; legitimate gradients have neither.
const cleanGradient = (s) => {
    if (typeof s !== 'string') return s;
    if (/[<>]/.test(s) || /javascript:/i.test(s)) return '';
    return s;
};

function sanitizeStep(step) {
    if (!step || typeof step !== 'object') return step;
    const out = {};
    for (const [key, value] of Object.entries(step)) {
        // Selector keys must never contain HTML — drop entries that do.
        if (typeof key === 'string' && key.includes('<')) continue;
        out[key] = (typeof value === 'string') ? cleanHtml(value) : value;
    }
    return out;
}

function sanitizeTutorial(t) {
    if (!t || typeof t !== 'object') return t;
    const out = { ...t };
    out.title = cleanHtml(t.title);
    out.description = cleanHtml(t.description);
    if (Array.isArray(t.content)) out.content = t.content.map(sanitizeStep);
    if (t.confirm && typeof t.confirm === 'object') {
        out.confirm = {
            ...t.confirm,
            title: cleanHtml(t.confirm.title),
            eyebrow: cleanHtml(t.confirm.eyebrow),
            message: cleanHtml(t.confirm.message),
            acceptLabel: cleanHtml(t.confirm.acceptLabel),
            declineLabel: cleanHtml(t.confirm.declineLabel),
            image: cleanImage(t.confirm.image),
            gradient: cleanGradient(t.confirm.gradient),
        };
    }
    return out;
}

addPlugin("extra-tutorials", class extends XOpatPlugin {
    constructor(id) {
        super(id);
        const raw = this.getOption('data', []);
        // External input — sanitize once at load so the render paths
        // (innerHTML for the welcome modal, EnjoyHint .html() for step labels)
        // never see hostile markup.
        this.tutorials = Array.isArray(raw) ? raw.map(sanitizeTutorial) : [];
    }

    pluginReady() {
        let candidate;
        for (let t of this.tutorials) {
            try {
                if (t.title && t.attach) {
                    USER_INTERFACE.Tutorials.add(this.id, t.title, t.description || "", "", t.content);
                }
                if (!candidate && (t.runDelay || t.confirm)) candidate = t;
            } catch (e) {
                console.error(e);
                //do not prevent from initialization
            }
        }
        if (!candidate) return;

        const delay = candidate.runDelay ? Math.max(candidate.runDelay, 250) : 0;
        const start = () => {
            try {
                USER_INTERFACE.Tutorials.run(candidate.content);
            } catch (e) {
                console.error(e);
            }
        };
        const launch = () => (delay > 0 ? setTimeout(start, delay) : start());

        if (candidate.confirm) {
            this._askToRun(candidate, launch);
        } else {
            launch();
        }
    }

    _askToRun(tutorial, accept) {
        const { div, p, button, img, i: iTag, span } = van.tags;
        const cfg = (typeof tutorial.confirm === 'object' && tutorial.confirm) || {};

        const title = cfg.title || tutorial.title || 'Guided tour';
        const message = cfg.message
            || (tutorial.title
                ? `Would you like to start the “${tutorial.title}” tutorial?`
                : 'Would you like to start a guided tour?');
        const acceptLabel = cfg.acceptLabel || 'Start tour';
        const declineLabel = cfg.declineLabel || 'Skip';
        const accent = cfg.accent || 'primary';
        const eyebrow = cfg.eyebrow || 'Tutorial';

        const gradient = cfg.gradient
            || 'linear-gradient(135deg, #6366f1 0%, #a855f7 35%, #ec4899 70%, #f59e0b 100%)';

        const illustration = cfg.image
            ? img({
                src: cfg.image,
                alt: '',
                style: 'max-width: 78%; max-height: 220px; object-fit: contain; filter: drop-shadow(0 14px 32px rgba(0,0,0,0.25));',
                onerror: (e) => e.target.remove(),
            })
            : iTag({
                class: `ph-light ${cfg.illustrationIcon || 'ph-graduation-cap'}`,
                style: 'font-size: 8.5rem; line-height: 1; color: #ffffff;'
                     + ' filter: drop-shadow(0 12px 28px rgba(0,0,0,0.32));',
            });

        // Glass tuned so circles read through the left pane as soft blurred
        // shapes (glassmorphism) while text stays readable.
        const glassBg = 'hsl(var(--b1) / 0.7)';
        const glassFx = 'backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%);';

        let modal;

        const closeButton = div(
            {
                role: 'button',
                tabindex: '0',
                onclick: () => modal.close(),
                onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); modal.close(); } },
                style: 'position: absolute; top: 0.75rem; right: 0.75rem; z-index: 4;'
                     + ' width: 2rem; height: 2rem; border-radius: 9999px;'
                     + ' display: flex; align-items: center; justify-content: center;'
                     + ' cursor: pointer; color: #ffffff; font-size: 1rem; line-height: 1;'
                     + ' background: rgba(0,0,0,0.18); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);'
                     + ' border: 1px solid rgba(255,255,255,0.25);'
                     + ' transition: background 0.15s ease;',
                onmouseenter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.30)',
                onmouseleave: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.18)',
            },
            iTag({ class: 'ph-light ph-x', style: 'font-size: 1.05rem;' }),
        );

        const leftPane = div(
            {
                style: `position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;`
                     + ` padding: 1.875rem 1.75rem 1.5rem;`
                     + ` background: ${glassBg}; ${glassFx}`
                     + ` mask-image: linear-gradient(90deg, #000 calc(100% - 40px), rgba(0,0,0,0.85) 100%);`
                     + ` -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 40px), rgba(0,0,0,0.85) 100%);`,
            },
            span({
                style: 'display: inline-block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;'
                     + ' color: hsl(var(--p)); opacity: 0.85; margin-bottom: 0.5rem;',
            }, eyebrow),
            div({
                class: 'font-medium',
                style: 'font-size: 1.6rem; line-height: 1.2; letter-spacing: -0.02em; margin-bottom: 0.75rem; padding-right: 1rem;',
            }, title),
            div({
                style: 'width: 2.5rem; height: 3px; border-radius: 9999px; margin-bottom: 1rem;'
                     + ' background: linear-gradient(90deg, hsl(var(--p)), hsl(var(--a)));',
            }),
            (() => {
                const node = p({ style: 'font-size: 0.95rem; line-height: 1.6; opacity: 0.82; flex: 1 1 auto;' });
                node.innerHTML = message;
                return node;
            })(),
        );

        const rightPane = div(
            {
                style: `flex: 0 0 44%; position: relative; min-height: 280px;`
                     + ` display: flex; align-items: center; justify-content: center;`
                     + ` background: ${glassBg}; ${glassFx}`,
            },
            div({ style: 'position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 1.5rem;' }, illustration),
        );

        const footer = div(
            {
                style: `position: relative; z-index: 3; display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem;`
                     + ` padding: 0.875rem 1.25rem;`
                     + ` background: ${glassBg}; ${glassFx}`
                     + ` box-shadow: inset 0 1px 0 hsl(var(--bc) / 0.06);`,
            },
            // Skip: text-only, no background fill — even on hover/focus.
            button({
                style: 'background: transparent; border: none; box-shadow: none;'
                     + ' min-height: 2.25rem; height: 2.25rem; padding: 0 0.875rem;'
                     + ' color: hsl(var(--bc)); opacity: 0.7; cursor: pointer;'
                     + ' font-size: 0.875rem; font-weight: 500;'
                     + ' transition: opacity 0.15s ease;',
                onmouseenter: (e) => e.currentTarget.style.opacity = '1',
                onmouseleave: (e) => e.currentTarget.style.opacity = '0.7',
                onclick: () => modal.close(),
            }, declineLabel),
            // Start: solid white pill — high contrast against the gradient
            // backdrop so it reads as the unmistakable primary CTA.
            button({
                style: 'min-height: 2.25rem; height: 2.25rem; border-radius: 9999px; padding: 0 1.5rem;'
                     + ' background: #ffffff; color: hsl(var(--p));'
                     + ' border: none; cursor: pointer;'
                     + ' font-size: 0.875rem; font-weight: 600; letter-spacing: 0.01em;'
                     + ' box-shadow: 0 8px 20px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04);'
                     + ' transition: transform 0.15s ease, box-shadow 0.15s ease;',
                onmouseenter: (e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.05)';
                },
                onmouseleave: (e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)';
                },
                onclick: () => { modal.close(); accept(); },
            }, acceptLabel),
        );

        const body = div(
            { style: 'position: relative; z-index: 2; display: flex; align-items: stretch; min-height: 280px;' },
            leftPane,
            rightPane,
        );

        // Decorative circles live on the shell so they span the entire card,
        // not just the right pane. They sit BELOW the body (z-index < 2) so the
        // left glass frosts them and the right pane shows them at full clarity.
        const circle = (s) => div({ style: `position: absolute; border-radius: 9999px; pointer-events: none; z-index: 1; ${s}` });

        const shell = div(
            {
                style: `position: relative; display: flex; flex-direction: column;`
                     + ` border-radius: 1rem; overflow: hidden;`
                     + ` background: ${gradient};`
                     + ` box-shadow: 0 24px 60px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.10);`,
            },
            circle('top: -5rem; left: -2rem; width: 16rem; height: 16rem; background: rgba(255,255,255,0.20);'),
            circle('top: 30%; left: 18%; width: 10rem; height: 10rem; background: rgba(255,255,255,0.13);'),
            circle('bottom: -6rem; left: 35%; width: 18rem; height: 18rem; background: rgba(255,255,255,0.14);'),
            circle('top: -3rem; right: -4rem; width: 14rem; height: 14rem; background: rgba(255,255,255,0.18);'),
            circle('top: 45%; right: 22%; width: 5rem; height: 5rem; background: rgba(255,255,255,0.22);'),
            circle('bottom: -4rem; right: 20%; width: 9rem; height: 9rem; background: rgba(255,255,255,0.12);'),
            body,
            footer,
            closeButton,
        );

        modal = new UI.Modal({
            id: `${this.id}-confirm`,
            body: shell,
            width: 'min(700px, 94vw)',
            isBlocking: true,
            allowClose: false,
            borderLess: true,
        });
        modal.create();
        document.body.appendChild(modal.root);
        modal.open();
    }
});
