/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./ui/**/*", "./src/user-interface.js", "./server/templates/index.html"],
  darkMode: ["selector", '[data-theme="light"]', '[data-theme="dark"]'],
  theme: {

  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: [
      {
        "light": {
          primary: "#668ca1",
          secondary: "#4494bb",
          accent: "#668ca1",
          neutral: "#271818",
          "base-100": "#e1e1e1",
        },
        "dark": {
          primary: "#668ca1",
          secondary: "#4494bb",
          accent: "#668ca1",
          neutral: "#271818",
          "base-100": "#3f3f3f",
        }
      },
    ],
  },
}

