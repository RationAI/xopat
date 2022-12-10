# HTML Sanitization

This module adds sanitization abilities to the xOpat. Configuration (of plugins) could contain HTML inputs,
this module lets you sanitize the configuration contents.

Usage (see https://github.com/apostrophecms/sanitize-html): 

````js
const clean = SanitizeHtml(dirty, {
  allowedTags: [ 'b', 'i', 'em', 'strong', 'a' ],
  allowedAttributes: {
    'a': [ 'href' ]
  },
  allowedIframeHostnames: ['www.youtube.com']
});
````

The source is built with ``browserify`` and `minify` from simple
> window.SanitizeHtml = require('sanitize-html');


