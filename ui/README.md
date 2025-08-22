# UI Component System

You can build and re-use components using ``Van.js``.

### Development
Develop & test components independently of the viewer:

- use grunt dev-ui to start UI development
- use grunt connect watch to run watch task for css
- it should be accessible on [this page](http://localhost:9000/ui/test_ui.html)
- each file is documented in its module
- dark mode theme is set by data-theme to the body
example:
~~~ js
// we define new collapse
var c1 = new ui.Collapse({
    summary: "hello there",
}, div("general kenobi")); // we can put different components into another ones

// we append it to the div we want:
c1.attachTo(document.getElementById("workspace"));
~~~
