# BaseComponent Development Guide

This guide explains how to build UI components in this project by extending the BaseComponent class. It consolidates the patterns used across ui/classes and clarifies the lifecycle, options, children handling, class/property state management, and recommended best practices.

## When to extend BaseComponent
- You are building a reusable UI element that needs consistent construction, styling, and mounting helpers.
- You want to compose components from other components, Nodes, or HTML strings.
- You need reactive class or attribute updates without a full re-render.

## Concepts at a glance
- create(): You must implement this in every subclass. It must return a DOM Node (from van.tags or a real Node).
- Options and Children: The BaseComponent constructor supports both (options, ...children) and a custom signature with super(). See examples below.
- Class management: setClass(key, value) updates a keyed classMap and a reactive classState. Use commonProperties in create().
- Extra properties (attributes): Define extraProperties in options to make reactive attributes available via extraProperties and setExtraProperty(key, value).
- Functional property setters: Define enumerations of functions (e.g., SIZE.SMALL) and apply them with set(...functions) or _applyOptions(options, ...keys).
- Mounting: Use attachTo(target) or prependedTo(target) to insert into the DOM or another component.

## Constructor patterns
1) Generic signature (recommended)

````js
class MyThing extends BaseComponent {
  constructor(options = undefined, ...children) {
    options = super(options, ...children).options;
    // now: this.options is guaranteed object, this._children are normalized

    // initialize classes / extra props / apply options
    this.classMap.base = "mything"; // optional default
  }

  create() {
    // Must use the getters at the 'main component' (see later)! 
    return div({ ...this.commonProperties, ...this.extraProperties }, ...this.children);
  }
}
````

- If the first argument passed to new MyThing(...) is a string, Node, or BaseComponent, it is treated as a child and options become undefined. BaseComponent normalizes this so that in your constructor you can read options from this.options and the raw children from this._children.

2) Custom signature (advanced)

````js
class MyThing extends BaseComponent {
  constructor(x, y) {
    super(); // Important: do not pass args to super in custom signature
    // handle your own args x, y and set this.options/children as needed
  }
}
````

Use a custom signature only when you need a specialized API. Otherwise prefer the generic one.

## Options schema supported by BaseComponent
- id?: string — If omitted, BaseComponent generates a unique id.
- extraClasses?: object | string —
  - string: space-separated classes become values in classMap (keys are created implicitly).
  - object: key-value where value is a class string; keys are used for setClass updates later.
- extraProperties?: object — defines attribute names and initial string values for the component. BaseComponent creates reactive states for these so they can be changed later via setExtraProperty.

Example:

````js
new Input({
  id: "email",
  extraClasses: { size: "input-sm", style: "input-primary" },
  extraProperties: { title: "Email address" },
});
````

## State, classes, and attributes
- setClass(key, value): updates classMap[key] and recomputes classState. Use keys that are meaningful to your component (e.g., "size", "style", "display").
- commonProperties: returns an object with { id, class: classState }. Use this on the element that represents your component root in create().
- extraProperties: returns a map of reactive states for keys defined by extraProperties in options. Spread it where attributes belong, or on child nodes when appropriate.
- setExtraProperty(key, value): changes previously-declared extra property and updates its reactive state. Throws if key was not declared in options.

## Lifecycle helpers
- create(): Must return a Node. This is your render function; do not call it manually to mount.
- attachTo(target): Appends this.create() to a DOM element (by id or Node) or to another BaseComponent. Before mounting, BaseComponent refreshes class and property states.
- prependedTo(target): Like attachTo, but prepends.
- addChildren(...children): Push children to this._children for composition. The getter children will convert them to nodes on first access.
- children: A getter that maps this._children through toNode(...) with caching. It accepts BaseComponent instances, Nodes, and strings (including raw HTML strings starting with <...>).
- remove(): Recursively removes child components (if they are BaseComponent) and then removes this component’s root node from DOM by id.

## Converting inputs to DOM nodes
- toNode(item, reinit = true): Instance method that turns UIElement inputs into a Node. For BaseComponent children, it refreshes state and calls create(). For strings starting with <, it treats them as HTML; otherwise as text.
- BaseComponent.toNode(...) and BaseComponent.parseDomLikeItem(...) static helpers provide similar logic for static contexts.

## Applying options via functional properties
Define component-specific functional properties that mutate class or attributes, then apply them using set(...) or _applyOptions(options, ...keys).

Example (pattern used across components like Input):

````js
class Input extends BaseComponent {
  constructor(options = undefined, ...args) {
    options = super(options, ...args).options;
    if (!options.style) options.style = Input.STYLE.NEUTRAL;
    if (!options.size) options.size = Input.SIZE.MEDIUM;
    this.classMap.base = "input";
    this._applyOptions(options, "size", "style");
  }

  create() {
    return input({ ...this.commonProperties, ...this.extraProperties });
  }
}

// Of course, our functional styling can do more than just set a single class..
Input.SIZE = {
  SMALL: function () { this.setClass("size", "input-xs"); },
  MEDIUM: function () { this.setClass("size", "input-sm"); },
  BIG: function () { this.setClass("size", "input-md"); },
  LARGE: function () { this.setClass("size", "input-lg"); },
};

Input.STYLE = {
  PRIMARY: function () { this.setClass("style", "input-primary"); },
  // ... other styles ...
};
````

Usage:

const inp = new Input({ size: Input.SIZE.LARGE, style: Input.STYLE.PRIMARY });
// Later change dynamically
inp.set(Input.SIZE.SMALL, Input.STYLE.SECONDARY);

Notes:
- _applyOptions(options, ...names) expects the option values to be functions bound to the component context. It catches incorrect usage and warns.
- set(...funcs) invokes each function with this bound to the component. Meant to be used with the functional styling described above.

## Building the DOM in create()
- Always return a single root Node that represents the component. Assign commonProperties to this root element (or to the first meaningful wrapper element if the root is a simple label or fieldset wrapper as in Input).
- Spread extraProperties where appropriate (commonly on the interactive element such as input, button, etc.).
- Compose children using this.children which normalizes BaseComponent, Node, and string inputs.

Example minimal skeleton:

````js
import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
const { div } = van.tags;

class Panel extends BaseComponent {
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this.classMap.base = "panel rounded p-2";
    }
    create() {
        return div({ ...this.commonProperties }, ...this.children);
    }
}

new Panel({ id: "p1" }, "Hello").attachTo("workspace");
````

## Composition and passing children
- new ParentComp(opts, child1, child2, ...) will capture children in this._children.
- In create(), prefer ...this.children over ...this._children to ensure proper conversion and caching.
- You can also add children later via addChildren(...).

## IDs and mounting
- BaseComponent ensures an id exists (passed or auto-generated). Use this.id (or the id in commonProperties) when you need to query or reference the root element.
- attachTo accepts: a DOM Node, an element id string, or another BaseComponent instance (in which case this component is added into the other’s children or directly mounted if the parent is already in the DOM).

## Best practices
- Keep create() side-effect free: just build nodes. Avoid DOM queries and mutations in create().
- Use setClass with semantic keys (e.g., size, style, display) so external code and functional properties can interoperate.
- Define all attributes you intend to change later under extraProperties so setExtraProperty works without throwing.
- Prefer the generic constructor pattern unless you absolutely need a custom API.
- When rendering raw HTML strings, ensure the content is trusted. Plain text strings are wrapped into a span automatically.

## Common pitfalls
- Forgetting to override create() will throw an error at runtime.
- Calling setExtraProperty for a key that was not declared in options.extraProperties will throw.
- Passing wrong option value types into _applyOptions (should be functions) will produce a warning and have no effect.

## Development flow
- Use npm run dev-ui or the UI playground (see ui/README.md and src/DEVELOPMENT.md) to iterate on components in isolation.
- Compose and mount components in the playground: new MyComp(opts, ...children).attachTo("workspace");

This document reflects the current BaseComponent API as implemented in ui/classes/baseComponent.mjs and demonstrates patterns used in elements like Input and components like Toolbar. Keep your components consistent with these conventions for predictable behavior and easier maintenance.