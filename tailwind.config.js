/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./ui/**/*", "./src/user-interface.js", "./server/templates/index.html"],
  darkMode: ["selector", '[data-theme="xOpat-dark"]', '[data-theme="xOpat-light"'],
  theme: {

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
        }
      },
    ],
  },
}
