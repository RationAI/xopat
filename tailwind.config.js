/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./ui/**/*"],
  // safelist: [
  //   {
  //     pattern: /./, // the "." means "everything"
  //   },
  // ],
  theme: {
    extend: {},
  },
  plugins: [require("@catppuccin/tailwindcss")],
}

