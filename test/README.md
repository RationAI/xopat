# Testing with Cypress

The testing framework can be run directly from console using `npx cypress open`. The testing happens on a running viewer
url configured in the `cypress.env.json` file, _not necessarily on the source files in this repository_. As the viewer
can serve data across the internet, the testing framework can test any running viewer instance if you have access.
For now, you need to
 - create **``cypress.env.json``** file in the project root, it defines where and how to access the viewer, an example file is ``cypress.env.example.json``
 - run ``npm install`` if you haven't already, it installs build and test tools
 - run ``npx cypress open`` to run the interactive test framework

## Writing tests

Inherited from the cypress default hierarchy, you can
 - find test suites and test routines (general scenarios callable 'anytime' that respect the viz params, usualy UI testing)
 in ``e2e/``
 - find configuration methods and static data in ``fixtures/``
 - find custom command and utility definitions in ``support/``
 
The best approach is to copy and modify existing tests.