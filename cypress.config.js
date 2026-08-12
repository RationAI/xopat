const { defineConfig } = require("cypress");
const { initPlugin } = require("@frsource/cypress-plugin-visual-regression-diff/plugins");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = __dirname;

module.exports = defineConfig({
    e2e: {
        setupNodeEvents(on, config) {
            initPlugin(on, config);
            on('task', {
                writeEnvFile({path: filePath, content}) {
                    //catches a typo in path, not a security boundary
                    const resolved = path.resolve(PROJECT_ROOT, filePath);
                    if (!resolved.startsWith(PROJECT_ROOT + path.sep)) {
                        throw new Error(`writeEnvFile: refusing to write outside project root: ${resolved}`);
                    }
                    fs.writeFileSync(resolved, JSON.stringify(content, null, 2));
                    return null;
                }
            });
            return config;
        },
        supportFile: 'test/support/e2e.js',
        specPattern: [
            'test/e2e/**/*.cy.{js,jsx,ts,tsx}',
            'plugins/*/test/**/*.cy.{js,jsx,ts,tsx}',
            'modules/*/test/**/*.cy.{js,jsx,ts,tsx}',
        ],
        hideXHRInCommandLog: true,
        excludeSpecPattern: ['*.hot-update.js', '/image_snapshots/*', '**/__snapshots__/*', '**/__image_snapshots__/*'],
    },
    viewportWidth: 1024,
    viewportHeight: 700,
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
