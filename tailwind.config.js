/** @type {import('tailwindcss').Config} */
module.exports = {
  // WARNING: compiling styles for the entire app can take a few minutes
  content: [
    "./ui/**/*.{html,js,mjs}",
    "./modules/**/*.{html,js}",
    "./plugins/**/*.{html,js}",
    "./src/**/*.{html,js}",
    "!**/*.min.js",
  ],
  darkMode: ["selector", '[data-theme="catppuccin-mocha"]', '[data-theme="blood-moon"]'],
  theme: {

  },
  plugins: [
    require("@catppuccin/tailwindcss"),
    require("daisyui")
  ],
  daisyui: {
    themes: [
      {
        "crimson-dawn": {
          primary: "#e57373",
          secondary: "#f06292",
          accent: "#ffb74d",
          neutral: "#ffafaf",
          "base-100": "#ffadad",
          info: "#64b5f6",
          success: "#81c784",
          warning: "#ffca28",
          error: "#e53935",
        },
        "blood-moon": {
          primary: "#d32f2f",
          secondary: "#9c27b0",
          accent: "#b71c1c",
          neutral: "#271818",
          "base-100": "#250c0c",
          info: "#90caf9",
          success: "#a5d6a7",
          warning: "#ffcc80",
          error: "#e57373",
        },
        "catppuccin-latte": {
          primary: "#1e66f5", // blue
          secondary: "#ea76cb", // pink
          accent: "#179299", // teal
          neutral: "#dce0e8", // crust
          "base-100": "#eff1f5", // base
          info: "#209fb5", // sapphire
          success: "#40a02b", // green
          warning: "#df8e1d", // yellow
          error: "#d20f39", // red
        },
        "catppuccin-frappe": {
          primary: "#8caaee", // blue
          secondary: "#f4b8e4", // pink
          accent: "#81c8be", // teal
          neutral: "#232634", // crust
          "base-100": "#303446", // base
          info: "#85c1dc", // sapphire
          success: "#a6d189", // green
          warning: "#e5c890", // yellow
          error: "#e78284", // red
        },
        "catppuccin-macchiato": {
          primary: "#8aadf4", // blue
          secondary: "#f5bde6", // pink
          accent: "#8bd5ca", // teal
          neutral: "#181926", // crust
          "base-100": "#24273a", // base
          info: "#7dc4e4", // sapphire
          success: "#a6da95", // green
          warning: "#eed49f", // yellow
          error: "#ed8796", // red
        },
        "catppuccin-mocha": {
          primary: "#89b4fa", // blue
          secondary: "#f5c2e7", // pink
          accent: "#94e2d5", // teal
          neutral: "#11111b", // crust
          "base-100": "#1e1e2e", // base
          info: "#74c7ec", // sapphire
          success: "#a6e3a1", // green
          warning: "#f9e2af", // yellow
          error: "#f38ba8", // red
        },
      },
    ],
  },
}

