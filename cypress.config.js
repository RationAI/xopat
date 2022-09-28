const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    supportFile: 'test/support/e2e.js',
    specPattern: 'test/e2e/**/*.cy.{js,jsx,ts,tsx}',
    hideXHRInCommandLog: true
  },
  downloadsFolder: 'test/downloads',
  fileServerFolder:	'.',
  fixturesFolder: 'test/fixtures',
  screenshotsFolder: 'test/screenshots',
  videosFolder:	'test/videos',
});
