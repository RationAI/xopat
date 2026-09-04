/** @type {import('tailwindcss').Config} */


module.exports = {
    // WARNING: compiling styles for the entire app can take a few minutes
    // `ts` is in here for the same reason the watcher watches it
    // (Gruntfile twinc.watch): a class that exists only in a .ts source was
    // invisible to the full build, so it reached the stylesheet only via that
    // file's incremental delta - and vanished again on the next full build.
    content: [
        './.cache/tw-accumulated.html',
        './ui/**/*.{html,js,mjs,ts}',
        './modules/**/*.{html,js,mjs,ts}',
        './plugins/**/*.{html,js,mjs,ts}',
        './src/**/*.{html,js,mjs,ts}',
        '!**/*.min.js',
        // TODO how to ignore
        // '!./ui/index.js',
        // '!./src/libs/**',
        // '!(.dev-cache)/**'
    ],
    // The `.er-control*` skin at the end of src/assets/tailwind-spec.css targets
    // markup emitted by src/libs/flex-renderer/flex-renderer.js, which puts no
    // DaisyUI class on its own inputs (see UPSTREAM.md, "flex-renderer - basic
    // UI controls carry no DaisyUI classes"). Tailwind tree-shakes custom
    // `@layer components` CSS by class name, and today the only thing keeping
    // that skin alive is the content scan finding these strings in the library
    // source. Two ways that breaks silently: the '!./src/libs/**' TODO above
    // gets uncommented, or the library switches a control to the generic
    // renderInput() helper, whose class is a template literal. Pin them.
    // `er-control__body--colormap` is ALREADY template-built (renderControl
    // ~:6175) and exists nowhere the scanner can see it.
    safelist: [
        'er-control__title',
        'er-control__body',
        'er-control__body--colormap',
        'er-control__input',
        'er-control__input--select',
        'er-control__input--colormap',
        'er-control__input--bool',
        'er-control__input--number',
        'er-control__input--image-number',
        'er-control__input--textarea',
        'er-control__input--color',
        'er-control__display--colormap',
        'er-control__display--custom-colormap',
        'er-control__button--action',
        'er-control__button--image-upload',
        'er-control__input--image-file',
        'er-control__hint--image',
        'er-control__row--image-number',
        'er-control__widget--image',
    ],
    darkMode: ["selector", '[data-theme="xOpat-dark"]', '[data-theme="xOpat-light"'],
    theme: {
        spacing: {
            px: '1px',
            0: '0rem',
            0.5: '0.125rem',   // 2px
            1: '0.25rem',      // 4px
            1.5: '0.375rem',   // 6px
            2: '0.5rem',       // 8px
            2.5: '0.625rem',   // 10px
            3: '0.75rem',      // 12px
            3.5: '0.875rem',   // 14px
            4: '1rem',         // 16px
            // ...continue as you prefer
        },
    },
    plugins: [
        require("daisyui"),
        function ({ addComponents }) {
            addComponents({
                /* New variant: looks exactly like .btn-neutral */
                '.btn-pointer': {
                '--btn-color': 'var(--n)',     // same base color as neutral
                '--btn-content': 'var(--nc)',  // same text color as neutral
                '--bc': 'var(--nc)',
                'cursor': 'pointer'
                },
            });
        },
    ],
    /** usage in css: https://v4.daisyui.com/docs/colors/ */
    daisyui: {
        themes: [
            {
                "xOpat-light": {
                    "primary":   "#570df8",
                    "secondary": "#f000b8",
                    "accent":    "#37cdbe",
                    "neutral":   "#3d4451",
                    "base-100":  "#ffffff",
                    "info":      "#3abff8",
                    "success":   "#36d399",
                    "warning":   "#fbbd23",
                    "error":     "#f87272",
                    '--rounded-box': '0.5rem',
                    '--rounded-btn': '0.375rem',
                    '--rounded-badge': '0.25rem',
                    '--tab-radius': '0.375rem',
                },
                "xOpat-dark": {
                    "primary":   "#793ef9",
                    "secondary": "#f000b8",
                    "accent":    "#37cdbe",
                    "neutral":   "#2a323c",
                    "base-100":  "#1d232a",
                    "info":      "#3abff8",
                    "success":   "#36d399",
                    "warning":   "#fbbd23",
                    "error":     "#f87272",
                    '--rounded-box': '0.5rem',
                    '--rounded-btn': '0.375rem',
                    '--rounded-badge': '0.25rem',
                    '--tab-radius': '0.375rem',
                },
                "xOpat-detached-mode": {
                    primary: "#89b4fa", // blue
                    secondary: "#f5c2e7", // pink
                    accent: "#94e2d5", // teal
                    neutral: "#11111b", // crust
                    "base-100": "#1e1e2e", // base
                    info: "#74c7ec", // sapphire
                    success: "#a6e3a1", // green
                    warning: "#f9e2af", // yellow
                    error: "#f38ba8", // red
                    '--rounded-box': '0.5rem',
                    '--rounded-btn': '0.375rem',
                    '--rounded-badge': '0.25rem',
                    /* (optional) slightly smaller base text */
                    '--tab-radius': '0.375rem',
                },
            },
        ],
    },
}

