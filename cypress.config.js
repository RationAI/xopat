//----- base
const { defineConfig } = require("cypress");

//----- plugins
// const { initPlugin } = require("cypress-plugin-snapshots/plugin");
const { initPlugin } = require('@frsource/cypress-plugin-visual-regression-diff/plugins');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      initPlugin(on, config)
    },
    supportFile: 'test/support/e2e.js',
    specPattern: 'test/e2e/**/*.cy.{js,jsx,ts,tsx}',
    hideXHRInCommandLog: true,
    excludeSpecPattern: ['*.hot-update.js', '/image_snapshots/*', '**/__snapshots__/*', '**/__image_snapshots__/*'],
  },
  downloadsFolder: 'test/downloads',
  fileServerFolder:	'.',
  fixturesFolder: 'test/fixtures',
  screenshotsFolder: 'test/screenshots',
  videosFolder:	'test/videos',
  // env: {
  //   "cypress-plugin-snapshots": {
  //     imageConfig: {
  //       threshold: 0.001
  //     }
  //   }
  // }
});
