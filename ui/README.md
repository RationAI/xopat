# UI Component System

You can build and re-use components using ``Van.js``.

### Development
Develop & test components independently of the viewer:

- use npm tasks or grunt directly to develop UI (see [development guidelines](../DEVELOPMENT.md))
  - you can develop directly in the running viewer, or
  - using grunt watch task, a separate UI playground page should be accessible on [this page](http://localhost:9000/ui/test_ui.html)
- each file is documented in its module
  - see README files in each directory
- dark mode theme is set by data-theme to the body
  - DO NOT use the tailwind dark selector, rely on the DaisyUI theme
example:
~~~ js
// we define new collapse
var c1 = new ui.Collapse({
    summary: "hello there",
}, div("general kenobi")); // we can put different components into another ones

// we append it to the div we want:
c1.attachTo(document.getElementById("workspace"));
~~~

For development