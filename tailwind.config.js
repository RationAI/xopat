/** @type {import('tailwindcss').Config} */


module.exports = {
    // WARNING: compiling styles for the entire app can take a few minutes
    content: [
        './.cache/tw-accumulated.html',
        './ui/**/*.{html,js,mjs}',
        './modules/**/*.{html,js}',
        './plugins/**/*.{html,js}',
        './src/**/*.{html,js}',
        '!**/*.min.js',
        // TODO how to ignore
        // '!./ui/index.js',
        // '!./src/libs/**',
        // '!(.dev-cache)/**'
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
            4: '1rem',         // 16px (keep if you need it)
            // ...continue as you prefer
        },
    },
    plugins: [
        require("daisyui")
    ],
    /** usage in css: https://v4.daisyui.com/docs/colors/ */
    daisyui: {
        themes: [
            {
                "xOpat-light": {
                    "primary": "#668ca1",
                    "secondary": "#4494bb",
                    "accent": "#668ca1",
                    "neutral": "#271818",
                    "base-100": "#e1e1e1",
                    "info": "#0ea5e9",
                    "success": "#84cc16",
                    "warning": "#f59e0b",
                    "error":  "#ef4444",
                    '--rounded-box': '0.5rem',
                    '--rounded-btn': '0.375rem',
                    '--rounded-badge': '0.25rem',
                    '--tab-radius': '0.375rem',
                },
                "xOpat-dark": {
                    "primary": "#668ca1",
                    "secondary": "#4494bb",
                    "accent": "#668ca1",
                    "neutral": "#271818",
                    "base-100": "#3f3f3f",
                    "info": "#0ea5e9",
                    "success": "#84cc16",
                    "warning": "#f59e0b",
                    "error":  "#ef4444",
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

