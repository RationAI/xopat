// ui/vanjs.mjs
var e;
var t;
var r;
var o;
var l;
var n;
var s = Object.getPrototypeOf;
var f = { isConnected: 1 };
var i = {};
var h = s(f);
var a = s(s);
var d = (e2, t2, r2, o2) => (e2 ?? (setTimeout(r2, o2), /* @__PURE__ */ new Set())).add(t2);
var u = (e2, t2, o2) => {
  let l2 = r;
  r = t2;
  try {
    return e2(o2);
  } catch (e3) {
    return console.error(e3), o2;
  } finally {
    r = l2;
  }
};
var w = (e2) => e2.filter((e3) => e3.t?.isConnected);
var _ = (e2) => l = d(l, e2, () => {
  for (let e3 of l) e3.o = w(e3.o), e3.l = w(e3.l);
  l = n;
}, 1e3);
var c = { get val() {
  return r?.i?.add(this), this.rawVal;
}, get oldVal() {
  return r?.i?.add(this), this.h;
}, set val(o2) {
  r?.u?.add(this), o2 !== this.rawVal && (this.rawVal = o2, this.o.length + this.l.length ? (t?.add(this), e = d(e, this, v)) : this.h = o2);
} };
var S = (e2) => ({ __proto__: c, rawVal: e2, h: e2, o: [], l: [] });
var g = (e2, t2) => {
  let r2 = { i: /* @__PURE__ */ new Set(), u: /* @__PURE__ */ new Set() }, l2 = { f: e2 }, n2 = o;
  o = [];
  let s2 = u(e2, r2, t2);
  s2 = (s2 ?? document).nodeType ? s2 : new Text(s2);
  for (let e3 of r2.i) r2.u.has(e3) || (_(e3), e3.o.push(l2));
  for (let e3 of o) e3.t = s2;
  return o = n2, l2.t = s2;
};
var y = (e2, t2 = S(), r2) => {
  let l2 = { i: /* @__PURE__ */ new Set(), u: /* @__PURE__ */ new Set() }, n2 = { f: e2, s: t2 };
  n2.t = r2 ?? o?.push(n2) ?? f, t2.val = u(e2, l2, t2.rawVal);
  for (let e3 of l2.i) l2.u.has(e3) || (_(e3), e3.l.push(n2));
  return t2;
};
var b = (e2, ...t2) => {
  for (let r2 of t2.flat(1 / 0)) {
    let t3 = s(r2 ?? 0), o2 = t3 === c ? g(() => r2.val) : t3 === a ? g(r2) : r2;
    o2 != n && e2.append(o2);
  }
  return e2;
};
var m = (e2, t2, ...r2) => {
  let [o2, ...l2] = s(r2[0] ?? 0) === h ? r2 : [{}, ...r2], f2 = e2 ? document.createElementNS(e2, t2) : document.createElement(t2);
  for (let [e3, r3] of Object.entries(o2)) {
    let o3 = (t3) => t3 ? Object.getOwnPropertyDescriptor(t3, e3) ?? o3(s(t3)) : n, l3 = t2 + "," + e3, h2 = i[l3] ??= o3(s(f2))?.set ?? 0, d2 = e3.startsWith("on") ? (t3, r4) => {
      let o4 = e3.slice(2);
      f2.removeEventListener(o4, r4), f2.addEventListener(o4, t3);
    } : h2 ? h2.bind(f2) : f2.setAttribute.bind(f2, e3), u2 = s(r3 ?? 0);
    e3.startsWith("on") || u2 === a && (r3 = y(r3), u2 = c), u2 === c ? g(() => (d2(r3.val, r3.h), f2)) : d2(r3);
  }
  return b(f2, l2);
};
var x = (e2) => ({ get: (t2, r2) => m.bind(n, e2, r2) });
var j = (e2, t2) => t2 ? t2 !== e2 && e2.replaceWith(t2) : e2.remove();
var v = () => {
  let r2 = 0, o2 = [...e].filter((e2) => e2.rawVal !== e2.h);
  do {
    t = /* @__PURE__ */ new Set();
    for (let e2 of new Set(o2.flatMap((e3) => e3.l = w(e3.l)))) y(e2.f, e2.s, e2.t), e2.t = n;
  } while (++r2 < 100 && (o2 = [...t]).length);
  let l2 = [...e].filter((e2) => e2.rawVal !== e2.h);
  e = n;
  for (let e2 of new Set(l2.flatMap((e3) => e3.o = w(e3.o)))) j(e2.t, g(e2.f, e2.t)), e2.t = n;
  for (let e2 of l2) e2.h = e2.rawVal;
};
var vanjs_default = { tags: new Proxy((e2) => new Proxy(m, x(e2)), x()), hydrate: (e2, t2) => j(e2, g(t2, e2)), add: b, state: S, derive: y };

// ui/classes/baseComponent.mjs
var { span } = vanjs_default.tags;
var HtmlRenderer = (htmlString) => {
  const container = vanjs_default.tags.div();
  container.innerHTML = htmlString;
  return container;
};
var BaseComponent = class _BaseComponent {
  /**
   *
   * @param {*} options - other options are defined in the constructor of the derived class
   * @param  {...any} children
   * @param {string} [options.id] - The id of the component
   */
  constructor(options, ...children) {
    const extraClasses = options["extraClasses"];
    this.classMap = typeof extraClasses === "object" ? extraClasses : {};
    const extraProperties = options["extraProperties"];
    this.propertiesMap = typeof extraProperties === "object" ? extraProperties : {};
    this.propertiesStateMap = {};
    if (extraProperties) {
      for (let key in this.propertiesMap) {
        this.propertiesStateMap[key] = vanjs_default.state(this.propertiesMap[key]);
      }
    }
    this._children = children;
    this._renderedChildren = null;
    this.classState = vanjs_default.state("");
    if (options) {
      if (options.id) {
        this.id = options.id;
        delete options.id;
      } else {
        this.id = Math.random().toString(36).substring(2, 15);
      }
      this.options = options;
    } else {
      this.options = {};
    }
  }
  /**
   *
   * @param {*} element - The element to attach the component to
   */
  attachTo(element) {
    this.refreshClassState();
    this.refreshPropertiesState();
    if (element instanceof _BaseComponent) {
      const mount = document.getElementById(element.id);
      if (document.getElementById(element.id) === null) {
        element._children.push(this);
      } else {
        mount.append(this.create());
      }
    } else {
      const mount = typeof element === "string" ? document.getElementById(element) : element;
      if (!mount) {
        console.error(`Element ${element} not found`);
        vanjs_default.add(element, this.create());
      } else {
        mount.append(this.create());
      }
    }
  }
  /**
   *
   * @param {*} element - The element to prepend the component to
   */
  prependedTo(element) {
    this.refreshClassState();
    this.refreshPropertiesState();
    if (element instanceof _BaseComponent) {
      const mount = document.getElementById(element.id);
      if (document.getElementById(element.id) === null) {
        element._children.unshift(this);
      } else {
        mount.prepend(this.create());
      }
    } else {
      const mount = typeof element === "string" ? document.getElementById(element) : element;
      if (!mount) {
        console.error(`Element ${element} not found`);
        vanjs_default.add(element, this.create());
      } else {
        mount.prepend(this.create());
      }
    }
  }
  /**
   * @description Refresh the state of the component, e.g. class names
   */
  refreshClassState() {
    this.classState.val = Object.values(this.classMap).join(" ");
  }
  refreshPropertiesState() {
    for (let key in this.propertiesStateMap) {
      this.propertiesStateMap[key].val = this.propertiesMap[key] instanceof Object ? this.propertiesMap[key].join(" ") : this.propertiesMap[key];
    }
  }
  /**
   *
   * @param  {...any} properties - functions to set the state of the component
   */
  set(...properties) {
    for (let property of properties) {
      property.call(this);
    }
  }
  /**
   *
   * @param  {...any} children - children to add to the component
   */
  addChildren(...children) {
    this._children.push(...children);
  }
  /**
   * @description getter for children which will automatically refresh them and create them if they are BaseComponent
   */
  get children() {
    if (this._renderedChildren) return this._renderedChildren;
    this._renderedChildren = (this._children || []).map((child) => {
      if (child instanceof _BaseComponent) {
        child.refreshClassState();
        child.refreshPropertiesState();
        return child.create();
      }
      if (child instanceof Element) {
        return child;
      }
      if (typeof child === "string") {
        return child.trimStart().startsWith("<") ? HtmlRenderer(child) : span(child);
      }
      console.warn(`Invalid child component provided - ${typeof child}:`, child);
      return void 0;
    }).filter(Boolean);
    return this._renderedChildren;
  }
  /**
   * @description getter for commonProperties which are shared against all components
   */
  get commonProperties() {
    this.refreshClassState();
    if (this.id) {
      return {
        id: this.id,
        class: this.classState
      };
    }
    ;
    return {
      class: this.classState
    };
  }
  get extraProperties() {
    this.refreshPropertiesState();
    return this.propertiesStateMap;
  }
  /**
   *
   * @param {string} key - The key of the class
   * @param {string} value - The value of the class
   * @description Set the class of the component
   * @example
   * button.setClass("size", "btn-lg");
   */
  setClass(key, value) {
    this.classMap[key] = value;
    this.classState.val = Object.values(this.classMap).join(" ");
  }
  setExtraProperty(key, value) {
    this.propertiesMap[key] = value;
    let stateMap = this.propertiesStateMap[key];
    if (!stateMap) {
      throw new Error("Extra property setter set without extra definition in the component constructor!");
    }
    stateMap.val = value instanceof Object ? value.join(" ") : value;
  }
  /**
   * @description Create the component
   * it needs to be overridden by the derived class
   */
  create() {
    throw new Error("Component must override create method");
  }
  /**
   * @description Remove the component from the DOM
   */
  remove() {
    this._children.forEach((child) => {
      if (child instanceof _BaseComponent) {
        child.remove();
      }
    });
    document.getElementById(this.id).remove();
  }
  /**
   * If you document a component properties like this:
   * Component.PROPERTY = {
   *     X: function () { ... do something ... },
   *     Y: function () { ... do something ... },
   * };
   * You can use this function that will iterate options object
   * and for each component, calls the initialization where necessary.
   *
   * Usage (in constructor): this._applyOptions(options, "X", "Y");
   *
   * @param options
   * @param {string} names keys to the options object, values of the keys
   * should be functions
   */
  _applyOptions(options, ...names) {
    for (let prop of names) {
      const option3 = options[prop];
      try {
        if (option3) option3.call(this);
      } catch (e2) {
        console.warn("Probably incorrect component usage! Option values should be component-defined functional properties!", e2);
      }
    }
    this.refreshClassState();
    this.refreshPropertiesState();
  }
};

// ui/classes/elements/buttons.mjs
var { button } = vanjs_default.tags;
var Button = class extends BaseComponent {
  /**
   * @param {*} options
   * @param  {...any} args
   * @param {Function} [options.onClick] - The click event handler
   * @param {keyof typeof Button.SIZE} [options.size] - The size of the button
   * @param {keyof typeof Button.OUTLINE} [options.outline] - The outline style of the button
   * @param {keyof typeof Button.TYPE} [options.type] - The button type
   */
  constructor(options, ...args) {
    super(options, ...args);
    this.classMap["base"] = options["base"] || "btn";
    this.classMap["type"] = options["type"] || "btn-primary";
    this.classMap["size"] = "";
    this.classMap["outline"] = "";
    this.classMap["orientation"] = "";
    this.style = "ICONTITLE";
    if (options) {
      if (options.onClick) this.onClick = options.onClick;
      this._applyOptions(options, "size", "outline", "type", "orientation");
    }
  }
  create() {
    return button(
      { ...this.commonProperties, onclick: this.onClick, ...this.extraProperties },
      ...this.children
    );
  }
  /**
   * @description Sets button to show only icon
  **/
  iconOnly() {
    this.style = "ICONONLY";
    const nodes = this.children;
    for (let n2 of nodes) {
      if (n2.nodeName === "SPAN") {
        n2.classList.add("hidden");
      } else if (n2.nodeName === "I") {
        n2.classList.remove("hidden");
      }
    }
  }
  /**
   * @description Sets button to show only title
  **/
  titleOnly() {
    this.style = "TITLEONLY";
    const nodes = this.children;
    for (let n2 of nodes) {
      if (n2.nodeName === "I") {
        n2.classList.add("hidden");
      } else if (n2.nodeName === "SPAN") {
        n2.classList.remove("hidden");
      }
    }
  }
  /**
   * @description Sets button to show title and icon
  **/
  titleIcon() {
    this.style = "TITLEICON";
    const nodes = this.children;
    for (let n2 of nodes) {
      n2.classList.remove("hidden");
    }
  }
  /**
   * @description Rotates icon based on orientation
  **/
  iconRotate() {
    const nodes = this.children;
    for (let n2 of nodes) {
      if (n2.nodeName === "I") {
        if (this.orientation === "b-vertical-right") {
          n2.classList.add("rotate-90");
        } else if (this.orientation === "b-vertical-left") {
          n2.classList.add("-rotate-90");
        }
      }
    }
  }
  static generateCode() {
    return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.Button({
    id: "myButton",
    size: ui.Button.SIZE.NORMAL,
    outline: ui.Button.OUTLINE.DISABLE,
    TYPE: ui.Button.TYPE.PRIMARY,
    onClick: function () {
        console.log("Button clicked");
    }
},"Click me");

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
  }
};
Button.SIZE = {
  LARGE: function() {
    this.setClass("size", "btn-lg");
  },
  NORMAL: function() {
    this.setClass("size", "");
  },
  SMALL: function() {
    this.setClass("size", "btn-sm");
  },
  TINY: function() {
    this.setClass("size", "btn-xs");
  }
};
Button.OUTLINE = {
  ENABLE: function() {
    this.setClass("outline", "btn-outline");
  },
  DISABLE: function() {
    this.setClass("outline", "");
  }
};
Button.TYPE = {
  PRIMARY: function() {
    this.setClass("type", "btn-primary");
  },
  SECONDARY: function() {
    this.setClass("type", "btn-secondary");
  },
  TERNARY: function() {
    this.setClass("type", "btn-accent");
  },
  NONE: function() {
    this.setClass("type", "");
  }
};
Button.ORIENTATION = {
  HORIZONTAL: function() {
    this.setClass("orientation", "");
    this.iconRotate();
  },
  VERTICAL_LEFT: function() {
    this.setClass("orientation", "b-vertical-left");
    this.iconRotate();
  },
  VERTICAL_RIGHT: function() {
    this.setClass("orientation", "b-vertical-right");
    this.iconRotate();
  }
};
Button.STYLE = {
  ICONONLY: function() {
    this.iconOnly();
  },
  TITLEONLY: function() {
    this.titleOnly();
  },
  TITLEICON: function() {
    this.titleIcon();
  }
};

// ui/classes/elements/fa-icon.mjs
var { i: i2 } = vanjs_default.tags;
var FAIcon = class extends BaseComponent {
  /**
   * @param {*} options
   * @param  {...any} args
   * @param {string} [options.name] - The name of the icon
  **/
  constructor(options, ...args) {
    if (typeof options === "string") {
      options = { name: options };
    }
    super(options, ...args);
    this.classMap["base"] = "fa-solid";
    this.classMap["name"] = options && options["name"] || "";
  }
  /**
   * 
   * @param {*} name name of the new icon from FontAwesome
   * @description Changes the icon of the component
   */
  changeIcon(name) {
    this.setClass("name", name);
  }
  create() {
    return i2({ ...this.commonProperties, ...this.extraProperties });
  }
  static generateCode() {
    return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

window["workspaceItem"] = new ui.FAIcon({ name: "fa-gear" });

window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
  }
};

// ui/classes/elements/join.mjs
var { div } = vanjs_default.tags;
var Join = class _Join extends BaseComponent {
  /**
   * @param {*} options
   * @param {keyof typeof Join.STYLE} [options.style=undefined]
   * @param  {...any} args
   */
  constructor(options, ...args) {
    super(options, ...args);
    this.classMap["base"] = "join bg-join";
    this.classMap["rotation"];
    this.classMap["flex"];
    if (!options) options = {};
    options.style = options.style || _Join.STYLE.VERTICAL;
    this._applyOptions(options, "style", "rounded", "rotation");
  }
  create() {
    for (let child of this._children) {
      if (child instanceof BaseComponent) {
        child.setClass("join", "join-item");
      }
    }
    return div({ ...this.commonProperties, ...this.extraProperties }, ...this.children);
  }
};
Join.STYLE = {
  VERTICAL: function() {
    this.setClass("direction", "join-vertical");
  },
  HORIZONTAL: function() {
    this.setClass("direction", "join-horizontal");
  }
};
Join.ROUNDED = {
  ENABLE: function() {
    this.setClass("rounded", "");
  },
  DISABLE: function() {
    this.setClass("rounded", "join-unrounded");
  }
};

// ui/classes/elements/div.mjs
var { div: div2 } = vanjs_default.tags;
var Div = class extends BaseComponent {
  /**
   * @param {*} options
   * @param  {...any} args
   */
  constructor(options, ...args) {
    super(options, ...args);
  }
  create() {
    return div2(
      { ...this.commonProperties, onclick: this.options.onClick, ...this.extraProperties },
      ...this.children
    );
  }
};

// ui/classes/components/menuTab.mjs
var ui = { Button, Div, FAIcon };
var { span: span2 } = vanjs_default.tags;
var MenuTab = class extends BaseComponent {
  /**
   * @param {*} item dictionary with id, icon, title, body which will be created
   * @param {*} parent parent menu component
   */
  constructor(item, parent) {
    super({});
    this.parent = parent;
    this.style = "ICONTITLE";
    this.styleOverride = item["styleOverride"] || false;
    this.focused = false;
    this.hidden = false;
    this.id = item.id;
    const [headerButton, contentDiv] = this._createTab(item);
    this.headerButton = headerButton;
    this.contentDiv = contentDiv;
  }
  /**
   * todo: private?
   * @param {*} item dictionary with id, icon, title, body which will be created
   * @returns {*} Button and Div components from VanJS framework
   */
  _createTab(item) {
    const content = item["body"];
    const inText = item["title"];
    let inIcon = item["icon"] instanceof BaseComponent ? item["icon"] : new ui.FAIcon({ name: item["icon"] });
    this.iconName = inIcon.options.name;
    this.title = inText;
    let action = item["onClick"] ? item["onClick"] : () => {
    };
    const b2 = new ui.Button({
      id: this.parent.id + "-b-" + item.id,
      size: ui.Button.SIZE.SMALL,
      extraProperties: { title: inText },
      onClick: () => {
        action();
        this.focus();
      }
    }, inIcon, span2(inText));
    let c2 = void 0;
    if (content) {
      c2 = new ui.Div({ id: this.parent.id + "-c-" + item.id, extraClasses: { display: "display-none", height: "h-full" } }, ...content);
    }
    ;
    return [b2, c2];
  }
  removeTab() {
    document.getElementById(this.headerButton.id).remove();
    if (this.contentDiv) {
      document.getElementById(this.contentDiv.id).remove();
    }
    ;
  }
  focus() {
    for (let tab of Object.values(this.parent.tabs)) {
      if (tab.headerButton.id != this.headerButton.id) {
        tab._removeFocus();
        APPLICATION_CONTEXT.setOption(`${this.id}-open`, false);
      }
    }
    ;
    if (this.focused) {
      APPLICATION_CONTEXT.setOption(`${this.id}-open`, false);
      this._removeFocus();
    } else {
      APPLICATION_CONTEXT.setOption(`${this.id}-open`, true);
      this._setFocus();
    }
    ;
  }
  unfocus() {
    APPLICATION_CONTEXT.setOption(`${this.id}-open`, false);
    this._removeFocus();
  }
  _setFocus() {
    this.focused = true;
    this.headerButton.setClass("type", "btn-secondary");
    if (this.contentDiv) {
      this.contentDiv.setClass("display", "");
    }
    ;
  }
  _removeFocus() {
    this.focused = false;
    this.headerButton.setClass("type", "btn-primary");
    if (this.contentDiv) {
      this.contentDiv.setClass("display", "hidden");
    }
  }
  close() {
    this.headerButton.setClass("type", "btn-primary");
    if (this.contentDiv) {
      this._removeFocus();
    }
    ;
  }
  /**
   * @description make possible to keep its visual settings -> it keeps only Icon even if the whole menu is set to show Icon and Title
   * @param {boolean} styleOverride - if true, it will keep its visual settings
   */
  setStyleOverride(styleOverride) {
    this.styleOverride = styleOverride;
  }
  // TODO make work even withouth inicialization
  titleOnly() {
    if (this.styleOverride) {
      return;
    }
    this.style = "TITLE";
    const nodes = this.headerButton.children;
    nodes[0].classList.add("hidden");
    nodes[1].classList.remove("hidden");
  }
  titleIcon() {
    if (this.styleOverride) {
      return;
    }
    this.style = "ICONTITLE";
    const nodes = this.headerButton.children;
    nodes[0].classList.remove("hidden");
    nodes[1].classList.remove("hidden");
  }
  iconOnly() {
    if (this.styleOverride) {
      return;
    }
    this.style = "ICON";
    const nodes = this.headerButton.children;
    nodes[0].classList.remove("hidden");
    nodes[1].classList.add("hidden");
  }
  iconRotate() {
    const nodes = this.headerButton.children;
    nodes[0].classList.remove("rotate-90");
    nodes[0].classList.remove("-rotate-90");
    if (!(this.style === "ICON")) {
      return;
    }
    if (this.parent.orientation === "RIGHT") {
      nodes[0].classList.add("rotate-90");
    } else if (this.parent.orientation === "LEFT") {
      nodes[0].classList.add("-rotate-90");
    }
  }
  toggleHiden() {
    if (this.hidden) {
      if (this.headerButton) {
        this.headerButton.setClass("display", "");
      }
      this.contentDiv.setClass("display", "");
      this.hidden = false;
    } else {
      if (this.headerButton) {
        this.headerButton.setClass("display", "hidden");
      }
      this.contentDiv.setClass("display", "hidden");
      this.hidden = true;
    }
  }
};

// ui/classes/elements/dropdown.mjs
var { div: div3, ul, li, a: a2, span: span3 } = vanjs_default.tags;
var Dropdown = class extends BaseComponent {
  // todo:  _children? use instead of items...
  constructor(options, ..._children) {
    super(options);
    this.title = options["title"] || "";
    this.icon = options["icon"] || "";
    this.parentId = options["parentId"] || "";
    this.onClick = options["onClick"] || (() => {
    });
    this.items = {};
    if (Array.isArray(options.items)) {
      for (let item of options.items) {
        this.items[item.id] = item;
      }
    }
    this.sections = (options.sections || []).slice().sort((a4, b2) => (a4.order || 0) - (b2.order || 0));
    if (!this.sections.length) this.sections = [{ id: "default", title: "" }];
    this.selectedId = null;
    this.closeOnItemClick = options.closeOnItemClick ?? true;
    this.widthClass = options.widthClass || "w-52";
    this.headerButton = this.createButton(options);
    this._contentEl = null;
    this._sectionMap = /* @__PURE__ */ new Map();
  }
  /** keep old helper API */
  createButton() {
    const inIcon = this.icon instanceof BaseComponent ? this.icon : new FAIcon({ name: this.icon });
    const b2 = new Button({
      id: this.parentId + "-b-" + this.id,
      size: Button.SIZE.SMALL,
      extraProperties: { title: this.title }
    }, inIcon, span3(this.title));
    return b2;
  }
  iconOnly() {
    this.headerButton.iconOnly();
  }
  titleIcon() {
    this.headerButton.titleIcon();
  }
  titleOnly() {
    this.headerButton.titleOnly();
  }
  iconRotate() {
    this.headerButton.iconRotate();
  }
  close() {
  }
  _removeFocus() {
  }
  /* ---------------- public API (new) ---------------- */
  addSection({ id, title = "", order = 0 }) {
    const i3 = this.sections.findIndex((s2) => s2.id === id);
    if (i3 >= 0) {
      this.sections[i3].title = title;
      this.sections[i3].order = order;
    } else this.sections.push({ id, title, order });
    this.sections.sort((a4, b2) => (a4.order || 0) - (b2.order || 0));
    this._rebuildContent();
  }
  /** Ensure section exists (state + DOM); returns its UL node */
  _ensureSection(sectionId, title = "") {
    if (!this.sections.some((s2) => s2.id === sectionId)) {
      const maxOrder = Math.max(0, ...this.sections.map((s2) => s2.order ?? 0));
      this.sections.push({ id: sectionId, title, order: maxOrder + 1 });
    }
    if (!this._contentEl) return null;
    let listEl = this._contentEl.querySelector(`ul[data-section="${sectionId}"]`);
    if (!listEl) {
      if (title) {
        this._contentEl.appendChild(
          div3({ class: "px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-base-content/60" }, title)
        );
      }
      listEl = ul({ class: "menu bg-transparent p-0", role: "none", "data-section": sectionId });
      this._contentEl.appendChild(listEl);
      this._contentEl.appendChild(div3({ class: "mx-1 my-1 border-t border-base-300/70" }));
    }
    this._sectionMap.set(sectionId, listEl);
    return listEl;
  }
  /** Add item later; section auto-created if missing */
  addItem(item, sectionTitleIfNew = "") {
    const secId = item.section || this.sections[0]?.id || "default";
    const target = this._ensureSection(secId, sectionTitleIfNew) || this._sectionMap.get(this.sections[0].id);
    const node = this._renderItem({ ...item, section: secId });
    if (target) target.appendChild(node);
    this.items[item.id] = { ...item, section: secId };
  }
  getItem(id) {
    return this.items[id];
  }
  /** Insert at specific index inside a section */
  insertItem(sectionId, item, index = void 0, sectionTitleIfNew = "") {
    const target = this._ensureSection(sectionId, sectionTitleIfNew) || this._sectionMap.get(this.sections[0].id);
    const node = this._renderItem({ ...item, section: sectionId });
    if (target) {
      if (Number.isInteger(index) && index >= 0 && index < target.children.length) {
        target.insertBefore(node, target.children[index]);
      } else {
        target.appendChild(node);
      }
    }
    this.items[item.id] = { ...item, section: sectionId };
  }
  setSelected(id) {
    this.selectedId = id;
    if (!this._contentEl) return;
    this._contentEl.querySelectorAll("[data-item-id]").forEach((el) => {
      const on = el.dataset.itemId === id;
      el.classList.toggle("bg-primary/20", on);
      el.classList.toggle("text-primary-content", on);
      el.setAttribute("aria-current", on ? "true" : "false");
    });
  }
  /* ---------------- rendering ---------------- */
  _toNode(v2) {
    if (v2 == null) return document.createTextNode("");
    if (v2 instanceof Node) return v2;
    if (v2 instanceof BaseComponent) return v2.create?.() ?? document.createTextNode("");
    if (typeof v2 === "string") {
      const s2 = v2.trim();
      if (s2.startsWith("<")) {
        const wrap = document.createElement("div");
        wrap.innerHTML = s2;
        const frag = document.createDocumentFragment();
        Array.from(wrap.childNodes).forEach((n2) => frag.appendChild(n2));
        return frag;
      }
      return span3(s2);
    }
    return span3(String(v2));
  }
  _renderIcon(icon) {
    return new FAIcon({ name: icon }).create();
  }
  _renderItem(item) {
    const selected = this.selectedId && this.selectedId === item.id || item.selected;
    const attrs = {
      role: "menuitem",
      "data-item-id": item.id,
      "aria-current": selected ? "true" : "false",
      tabindex: "-1",
      href: item.href || void 0,
      class: [
        "flex items-center gap-3 rounded-md px-3 py-2",
        "hover:bg-base-300 focus:bg-base-300",
        selected ? "bg-primary/20 text-primary-content" : ""
      ].join(" "),
      onclick: (e2) => {
        if (!item.href) e2.preventDefault();
        const keepOpen = item.onClick?.(e2, item) === true;
        if (this.closeOnItemClick && !keepOpen) {
          const el = e2.currentTarget;
          setTimeout(() => el.blur(), 0);
        }
      }
    };
    const labelBlock = div3(
      { class: "flex-1 min-w-0" },
      typeof item.label === "string" ? span3({ class: "truncate" }, item.label) : this._toNode(item.label),
      item.sub ? div3({ class: "text-xs opacity-60 truncate" }, this._toNode(item.sub)) : null
    );
    return li(
      { role: "none" },
      a2(
        attrs,
        this._renderIcon(item.icon),
        labelBlock,
        item.kbd ? span3({ class: "text-xs opacity-60" }, item.kbd) : null
      )
    );
  }
  _buildSectionBlock(section, itemsInSection) {
    const nodes = [];
    if (section.title) {
      nodes.push(
        div3({ class: "px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-base-content/60" }, section.title)
      );
    }
    const listEl = ul(
      { class: "menu bg-transparent p-0", role: "none", "data-section": section.id },
      ...itemsInSection.map((it) => this._renderItem(it))
    );
    nodes.push(listEl);
    return { nodes, listEl };
  }
  _rebuildContent() {
    this.clear();
    const bySection = new Map(this.sections.map((s2) => [s2.id, []]));
    for (const i3 in this.items) {
      const it = this.items[i3];
      const sec = it.section && bySection.has(it.section) ? it.section : this.sections[0].id;
      bySection.get(sec).push(it);
    }
    let firstBlock = true;
    for (const s2 of this.sections) {
      const group = bySection.get(s2.id) || [];
      if (!group.length && !s2.title) continue;
      if (!firstBlock) this._contentEl.appendChild(div3({ class: "mx-1 my-1 border-t border-base-300/70" }));
      const { nodes, listEl } = this._buildSectionBlock(s2, group);
      nodes.forEach((n2) => this._contentEl.appendChild(n2));
      this._sectionMap.set(s2.id, listEl);
      firstBlock = false;
    }
  }
  clear() {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = "";
    this._sectionMap.clear();
  }
  create() {
    const trigger = div3({ tabindex: "0", class: "" }, this.headerButton.create());
    this._contentEl = div3(
      {
        tabindex: "0",
        id: this.parentId + "-ul-" + this.id,
        class: [
          "dropdown-content",
          "bg-base-200 text-base-content rounded-box shadow-xl border border-base-300",
          this.widthClass,
          "max-w-full hover:bg-secondary-focus"
        ].join(" "),
        style: "position: fixed",
        onclick: (event) => {
          event.stopPropagation();
        }
      }
    );
    this._rebuildContent();
    return div3(
      { class: "dropdown join-item", onclick: this.onClick },
      trigger,
      this._contentEl
    );
  }
};

// ui/classes/components/menu.mjs
var ui2 = { Join, Div, Button, MenuTab };
var { div: div4, span: span4, h3 } = vanjs_default.tags();
var Menu = class _Menu extends BaseComponent {
  /**
   * @param {*} options
   * @param {keyof typeof Menu.ORIENTATION} [options.orientation] - The orientation of the menu
   * @param {keyof typeof Menu.BUTTONSIDE} [options.buttonSide] - The side of the buttons
   * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
   */
  constructor(options, ...args) {
    super(options);
    this.tabs = {};
    this.focused = void 0;
    this.orientation = "TOP";
    this.design = "TITLEICON";
    this.header = new ui2.Join({ id: this.id + "-header", style: ui2.Join.STYLE.HORIZONTAL });
    this.body = new ui2.Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full" } });
    for (let i3 of args) {
      if (i3.class === Dropdown) {
        this.addDropdown(i3);
        continue;
      }
      this.addTab(i3);
    }
    this.classMap["base"] = "flex gap-1 h-full";
    this.classMap["orientation"] = _Menu.ORIENTATION.TOP;
    this.classMap["buttonSide"] = _Menu.BUTTONSIDE.LEFT;
    this.classMap["design"] = _Menu.DESIGN.TITLEICON;
    this.classMap["rounded"] = _Menu.ROUNDED.DISABLE;
    this.classMap["flex"] = "flex-col";
    if (options) {
      this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
    }
  }
  create() {
    this.header.attachTo(this);
    this.body.attachTo(this);
    return div4(
      { ...this.commonProperties, ...this.extraProperties },
      ...this.children
    );
  }
  /**
   * Retrieve tab item
   * @param id
   * @return {*}
   */
  getTab(id) {
    return this.tabs[id];
  }
  /**
   *
   * @param {*} id id of the item we want to delete
   */
  deleteTab(id) {
    if (!(id in this.tabs)) {
      throw new Error("Tab with id " + id + " does not exist");
    }
    this.tabs[id].removeTab();
    delete this.tabs[id];
  }
  /**
   * @param {Dropdown|object} item. If object, DropDown contructor params are accepted, which among other include support for:
   *   sections: [
   *     { id: "actions" },
   *     { id: "recent", title: "Open Projects", order: 10 },
   *   ],
   *   items: [
   *     { id: "new",   section: "actions", label: "New Project…", icon: "add" },
   *     { id: "open",  section: "actions", label: "Open…", icon: "folder_open", kbd: "⌘O", href: "#" },
   *     { id: "clone", section: "actions", label: "Clone Repository…", icon: "content_copy" },
   *     { id: "xopat", section: "recent",  label: "xopat", icon: "widgets", selected: true },
   *   ],
   * @description adds a dropdown type item to the menu
   */
  addDropdown(item) {
    if (item.class !== Dropdown || !item.id) {
      throw new Error("Item for addDropdown needs to be of type Dropdown and have id property!");
    }
    const id = item.id;
    item.parentId = this.id;
    item.onClick = item.onClick || (() => {
    });
    const tab = new Dropdown(item);
    this.tabs[id] = tab;
    tab.headerButton.setClass("join", "join-item");
    switch (this.design) {
      case "ICONONLY":
        tab.iconOnly();
        break;
      case "TITLEONLY":
        tab.titleOnly();
        break;
      case "TITLEICON":
        tab.titleIcon();
        break;
      default:
        throw new Error("Unknown design type");
    }
    tab.attachTo(this.header);
    return tab;
  }
  /**
   *
   * @param {*} item dictionary with id, icon, title, body which will be added to the menu
   */
  addTab(item) {
    if (!(item.id && item.icon && item.title)) {
      throw new Error("Item for menu needs every property set.");
    }
    const tab = item.class ? new item.class(item, this) : new MenuTab(item, this);
    this.tabs[item.id] = tab;
    tab.headerButton.setClass("join", "join-item");
    switch (this.design) {
      case "ICONONLY":
        tab.iconOnly();
        break;
      case "TITLEONLY":
        tab.titleOnly();
        break;
      case "TITLEICON":
        tab.titleIcon();
        break;
      default:
        throw new Error("Unknown design type");
    }
    tab.headerButton.attachTo(this.header);
    if (tab.contentDiv) {
      tab.contentDiv.attachTo(this.body);
    }
    return tab;
  }
  /**
   * @param {*} id of the item we want to focus
   */
  focus(id) {
    if (id in this.tabs) {
      this.tabs[id].focus();
      this.focused = id;
      return true;
    }
    return false;
  }
  focusAll() {
    for (let tab of Object.values(this.tabs)) {
      tab.focus();
    }
    this.focused = "all";
  }
  /**
   * @description unfocus all tabs
   */
  unfocusAll() {
    for (let tab of Object.values(this.tabs)) {
      tab.unfocus();
    }
    this.focused = void 0;
  }
  /**
   * @param {*} id of the item we want to close
   */
  closeTab(id) {
    if (id in this.tabs) {
      this.tabs[id].close();
      return true;
    }
    return false;
  }
  /**
   *
   * @returns {HTMLElement} The body of the menu
   */
  getBodyDomNode() {
    return document.getElementById(this.id + "-body");
  }
  /**
   *
   * @returns {HTMLElement} The header of the menu
   */
  getHeaderDomNode() {
    return document.getElementById(this.id + "-header");
  }
  headerSwitchVisible() {
    this.header_visible = !this.header_visible;
    if (this.header_visible) {
      this.header.setClass("hidden", "hidden");
    } else {
      this.header.setClass("hidden", "");
    }
  }
  appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
    const titleHtmlIn = div4();
    titleHtmlIn.innerHTML = titleHtml;
    const htmlIn = div4();
    htmlIn.innerHTML = html;
    const hiddenHtmlIn = div4();
    hiddenHtmlIn.innerHTML = hiddenHtml;
    let content = div4(
      { id: `${id}`, class: `inner-panel ${pluginId}-plugin-root` },
      div4(
        { onclick: this.clickHeader },
        span4(
          {
            class: "material-icons inline-arrow plugins-pin btn-pointer",
            id: `${id}-pin`,
            style: "padding: 0;"
          },
          "navigate_next"
        ),
        h3(
          {
            class: "d-inline-block h3 btn-pointer"
          },
          title
        ),
        titleHtmlIn
      ),
      div4(
        { class: "inner-panel-visible" },
        htmlIn
      ),
      div4(
        { class: "inner-panel-hidden" },
        hiddenHtmlIn
      )
    );
    this.addTab({ id, icon: "fa-gear", title, body: [content] });
    if (APPLICATION_CONTEXT.getOption(`${id}-open`, true)) {
      this.tabs[id]._setFocus();
    } else {
      this.tabs[id]._removeFocus();
    }
    if (APPLICATION_CONTEXT.getOption(`${id}-hidden`, false)) {
      this.tabs[id].toggleHiden();
    }
  }
  clickHeader() {
    const toVisible = this.offsetParent.lastChild;
    if (toVisible.classList.contains("force-visible")) {
      toVisible.classList.remove("force-visible");
      this.childNodes[0].classList.remove("opened");
    } else {
      toVisible.classList.add("force-visible");
      this.childNodes[0].classList.add("opened");
    }
  }
  static generateCode() {
    return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

const settingsIcon = new ui.FAIcon({name: "fa-gear"});

window["workspaceItem"] = new ui.Menu({
    id: "myMenu",
    orientation: ui.Menu.ORIENTATION.TOP,
    buttonSide: ui.Menu.BUTTONSIDE.LEFT,
    design: ui.Menu.DESIGN.TEXTICON
},
{id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
{id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"},
{id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"})


window["workspaceItem"].attachTo(document.getElementById("workspace"));

window["workspaceItem"].addTab({id: "s4", icon: "fa-home", title: "Content3", body: "Settings3"});

window["workspaceItem"].deleteTab("s3");
`;
  }
};
Menu.ORIENTATION = {
  TOP: function() {
    this.setClass("flex", "flex-col");
    this.orientation = "TOP";
    this.header.set(ui2.Join.STYLE.HORIZONTAL);
    for (let t2 of Object.values(this.tabs)) {
      t2.headerButton.set(ui2.Button.ORIENTATION.HORIZONTAL);
      t2.iconRotate();
    }
  },
  BOTTOM: function() {
    this.setClass("flex", "flex-col-reverse");
    this.orientation = "BOTTOM";
    this.header.set(ui2.Join.STYLE.HORIZONTAL);
    for (let t2 of Object.values(this.tabs)) {
      t2.headerButton.set(ui2.Button.ORIENTATION.HORIZONTAL);
      t2.iconRotate();
    }
  },
  LEFT: function() {
    this.setClass("flex", "flex-row");
    this.orientation = "LEFT";
    this.header.set(ui2.Join.STYLE.VERTICAL);
    for (let t2 of Object.values(this.tabs)) {
      t2.headerButton.set(ui2.Button.ORIENTATION.VERTICAL_LEFT);
      t2.iconRotate();
    }
  },
  RIGHT: function() {
    this.setClass("flex", "flex-row-reverse");
    this.orientation = "RIGHT";
    this.header.set(ui2.Join.STYLE.VERTICAL);
    for (let t2 of Object.values(this.tabs)) {
      t2.headerButton.set(ui2.Button.ORIENTATION.VERTICAL_RIGHT);
      t2.iconRotate();
    }
  }
};
Menu.BUTTONSIDE = {
  LEFT: function() {
    this.header.setClass("flex", "");
  },
  RIGHT: function() {
    this.header.setClass("flex", "flex-end");
  }
};
Menu.DESIGN = {
  ICONONLY: function() {
    this.design = "ICONONLY";
    for (let t2 of Object.values(this.tabs)) {
      t2.iconOnly();
      t2.iconRotate();
    }
  },
  TITLEONLY: function() {
    this.design = "TITLEONLY";
    for (let t2 of Object.values(this.tabs)) {
      t2.titleOnly();
      t2.iconRotate();
    }
  },
  TITLEICON: function() {
    this.design = "TITLEICON";
    for (let t2 of Object.values(this.tabs)) {
      t2.titleIcon();
      t2.iconRotate();
    }
  }
};
Menu.ROUNDED = {
  ENABLE: function() {
    ui2.Join.ROUNDED.ENABLE.call(this.header);
  },
  DISABLE: function() {
    ui2.Join.ROUNDED.DISABLE.call(this.header);
  }
};

// ui/classes/components/mainPanel.mjs
var { div: div5, h3: h32, span: span5 } = vanjs_default.tags;
var MainPanel = class extends Menu {
  constructor(options, ...args) {
    super(options, ...args);
  }
  // MainMenu
  append(title, titleHtml, html, id, pluginId) {
    const htmlIn = div5();
    htmlIn.innerHTML = html;
    const titleHtmlIn = div5();
    titleHtmlIn.innerHTML = titleHtml;
    let content = div5(
      { id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" },
      div5(
        h32(
          { class: "d-inline-block h3", style: "padding-left: 15px;" },
          title
        ),
        titleHtmlIn
      ),
      htmlIn
    );
    vanjs_default.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
  }
  replace(title, titleHtml, html, id, pluginId) {
    $(`.${pluginId}-plugin-root`).remove();
    this.append(title, titleHtml, html, id, pluginId);
  }
  replaceExtended(title, titleHtml, html, hiddenHtml, id, pluginId) {
    $(`.${pluginId}-plugin-root`).remove();
    this.appendExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
  }
  appendRaw(html, id, pluginId) {
    const htmlIn = div5();
    htmlIn.innerHTML = html;
    let content = div5({ id, class: "inner-panel " + pluginId + "-plugin-root inner-panel-simple" }, htmlIn);
    vanjs_default.add(document.getElementById(this.tabs["base"].contentDiv.id), content);
  }
  open() {
    if (this.opened) return;
    this.context.css("right", "0");
    this.opened = true;
    USER_INTERFACE.Margins.right = 400;
    this._sync();
  }
  close() {
    if (!this.opened) return;
    this.context.css("right", "-400px");
    this.opened = false;
    USER_INTERFACE.Margins.right = 0;
    this._sync();
  }
  _sync() {
    this.navigator.css("position", this.opened ? "relative" : this.navigator.attr("data-position"));
    let width = this.opened ? "calc(100% - 400px)" : "100%";
    USER_INTERFACE.TopPluginsMenu.selfContext.context.style["max-width"] = width;
    if (pluginsToolsBuilder) pluginsToolsBuilder.context.style.width = width;
    if (tissueMenuBuilder) tissueMenuBuilder.context.style.width = width;
  }
  // AdvancedMenu
  setMenu(ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
  }
  openMenu(atPluginId, toggle) {
  }
  openSubmenu(atPluginId, atSubId, toggle) {
  }
  refreshPageWithSelectedPlugins() {
  }
  addSeparator() {
  }
  _build() {
  }
  _buildMenu(context, builderId, parentMenuId, parentMenuTitle, ownerPluginId, toolsMenuId, title, html, icon, withSubmenu, container) {
  }
};

// ui/classes/components/multiPanelMenuTab.mjs
var { span: span6, div: div6 } = vanjs_default.tags;
var MultiPanelMenuTab = class extends MenuTab {
  /**
   * @param {*} item dictionary with id, icon, title, body which will be created
   * @param {*} parent parent menu component
  **/
  constructor(item, parent) {
    super(item, parent);
    this.closedButton;
    this.openButton;
    this.openDiv;
    this.pin;
    this.id = item.id;
  }
  _createTab(item) {
    const content = item["body"];
    const inText = item["title"];
    let inIcon = item["icon"] instanceof BaseComponent ? item["icon"] : new FAIcon({ name: item["icon"] });
    this.iconName = inIcon.options.name;
    this.title = inText;
    this.closedButton = new Button({
      id: this.parent.id + "-b-closed-" + item.id,
      size: Button.SIZE.TINY,
      extraProperties: { title: inText, style: "margin-top: 5px;" },
      onClick: () => {
        this.focus();
      }
    }, inIcon, span6(inText));
    const pinIcon = new FAIcon({ id: this.parent.id + "-b-icon" + item.id, name: "fa-thumbtack" });
    this.pin = new Button({
      id: this.parent.id + "-b-opened" + item.id,
      type: Button.TYPE.SECONDARY,
      size: Button.SIZE.TINY,
      orientation: Button.ORIENTATION.HORIZONTAL,
      extraProperties: { title: $.t("menu.bar.pinFullscreen"), style: "position: absolute; top: 0px;" },
      onClick: (event) => {
        this.togglePinned();
        if (pinIcon.classMap["name"] === "fa-thumbtack") {
          pinIcon.changeIcon("fa-thumbtack-slash");
        } else {
          pinIcon.changeIcon("fa-thumbtack");
        }
        if (USER_INTERFACE.TopFullscreenButton.fullscreen) {
          this.hide();
        }
        event.stopPropagation();
      }
    }, pinIcon);
    this.openButton = new Button({
      id: this.parent.id + "-b-opened-" + item.id,
      size: Button.SIZE.TINY,
      orientation: Button.ORIENTATION.VERTICAL_RIGHT,
      extraProperties: { title: inText, style: "margin-left: auto; padding-top: 35px; padding-bottom: 35px;" },
      onClick: () => {
        this.focus();
      }
    }, inIcon, span6(inText), this.pin);
    this.openDiv = new Div({
      id: this.parent.id + "-opendiv-" + item.id,
      extraClasses: { display: "display-none", flex: "flex flex-row", background: "bg-base-200", radius: "rouded-tl-md rounded-bl-md" },
      extraProperties: { style: "margin-top: 5px; margin-bottom: 5px;" }
    }, div6({ style: "width: 360px;" }, ...content), this.openButton);
    let c2 = new Div({
      id: this.parent.id + "-c-" + item.id,
      extraClasses: { display: "", flex: "flex flex-col", item: "ui-menu-item" }
    }, this.closedButton, this.openDiv);
    this.fullId = this.parent.id + "-c-" + item.id;
    if (APPLICATION_CONTEXT.getOption(`${this.id}-pinned`, false)) {
      this.parent.pinnedTabs[this.id] = true;
      pinIcon.changeIcon("fa-thumbtack-slash");
    }
    return [void 0, c2];
  }
  removeTab() {
    this.contentDiv.remove();
    this.closedButton.remove();
    this.openButton.remove();
    this.openDiv.remove();
  }
  focus() {
    if (this.focused) {
      APPLICATION_CONTEXT.setOption(`${this.id}-open`, false);
      this._removeFocus();
    } else {
      APPLICATION_CONTEXT.setOption(`${this.id}-open`, true);
      this._setFocus();
    }
    ;
  }
  _setFocus() {
    this.focused = true;
    this.openDiv.setClass("display", "");
    this.closedButton.setClass("display", "hidden");
  }
  _removeFocus() {
    this.focused = false;
    this.openDiv.setClass("display", "hidden");
    this.closedButton.setClass("display", "");
  }
  close() {
    this._removeFocus();
  }
  setStyleOverride(styleOverride) {
    this.styleOverride = styleOverride;
  }
  // TODO make work even withouth inicialization
  titleOnly() {
    if (this.styleOverride) {
      return;
    }
    this.style = "TITLE";
    this.closedButton.titleOnly();
    this.openButton.titleOnly();
  }
  titleIcon() {
    if (this.styleOverride) {
      return;
    }
    this.style = "ICONTITLE";
    this.closedButton.titleIcon();
    this.openButton.titleIcon();
  }
  iconOnly() {
    if (this.styleOverride) {
      return;
    }
    this.style = "ICON";
    this.closedButton.iconOnly();
    this.openButton.iconOnly();
  }
  iconRotate() {
    this.closedButton.iconRotate();
    this.openButton.iconRotate();
  }
  togglePinned() {
    if (this.parent.pinnedTabs[this.id]) {
      APPLICATION_CONTEXT.setOption(`${this.id}-pinned`, false);
      this.parent.pinnedTabs[this.id] = false;
    } else {
      APPLICATION_CONTEXT.setOption(`${this.id}-pinned`, true);
      this.parent.pinnedTabs[this.id] = true;
    }
  }
  hide() {
    document.getElementById(this.fullId).classList.toggle("hidden");
  }
};

// ui/classes/components/multiPanelMenu.mjs
var ui3 = { Join, Div, Button, MenuTab };
var { div: div7 } = vanjs_default.tags;
var MultiPanelMenu = class extends Menu {
  /**
   * @param {*} options
   * @param  {...any} args - items to be added to the menu in format {id: string, icon: string or faIcon, title: string, body: string}
   */
  constructor(options, ...args) {
    super(options);
    this.tabs = {};
    this.pinnedTabs = {};
    this.body = new ui3.Div({
      id: this.id + "-body",
      extraClasses: { height: "h-full", width: "w-full" }
    });
    for (let i3 of args) {
      this.addTab(i3);
    }
    this.classMap["base"] = "flex gap-1 h-full";
    this.classMap["flex"] = "flex-col";
    if (options) {
      this._applyOptions(options);
    }
  }
  create() {
    this.body.attachTo(this);
    return div7(
      { ...this.commonProperties, ...this.extraProperties },
      ...this.children
    );
  }
  /**
   *
   * @param {*} id id of the item we want to delete
   */
  deleteTab(id) {
    if (!(id in this.tabs)) {
      throw new Error("Tab with id " + id + " does not exist");
    }
    this.tabs[id].removeTab();
    delete this.tabs[id];
  }
  /**
   * @param {*} item dictionary with id, icon, title, body which will be added to the menu
   */
  addTab(item) {
    if (!(item.id && item.icon && item.title)) {
      throw new Error("Item for menu needs every property set.");
    }
    const tab = new MultiPanelMenuTab(item, this);
    this.tabs[item.id] = tab;
    switch (this.design) {
      case "ICONONLY":
        tab.iconOnly();
        break;
      case "TITLEONLY":
        tab.titleOnly();
        break;
      case "TITLEICON":
        tab.titleIcon();
        break;
      default:
        throw new Error("Unknown design type");
    }
    tab.contentDiv.attachTo(this.body);
  }
  /**
   * @param {*} id of the item we want to close
   */
  closeTab(id) {
    if (id in this.tabs) {
      this.tabs[id].close();
      return true;
    }
    return false;
  }
  static generateCode() {
    return `
// DISCLAIMER this is static example code, it does not change based on the actual component configuration
// but everything what you rewrite here will be reflected on the component in the workspace
// after using ctrl + s

ui = globalThis.UI;

const settingsIcon = new ui.FAIcon({name: "fa-gear"});

window["workspaceItem"] = new ui.MultiPanelMenu({
    id: "myMenu",
},
{id: "s1", icon: settingsIcon, title: "Content1", body: "Settings1"},
{id: "s2", icon: settingsIcon, title: "Content2", body: "Settings2"},
{id: "s3", icon: settingsIcon, title: "Content3", body: "Settings3"},)


window["workspaceItem"].attachTo(document.getElementById("workspace"));
`;
  }
};

// ui/classes/components/fullscreenMenu.mjs
var { div: div8 } = vanjs_default.tags;
var FullscreenMenu = class extends BaseComponent {
  /**
   * @param {*} options
   * @param  {...any} args - items to be added to the menu, needs to be UI.Div
  **/
  constructor(options, ...args) {
    super(options);
    this.tabs = {};
    this.content = new Div({ id: this.id + "-content", extraClasses: { height: "h-full", width: "w-full", color: "bg-base-100" } });
    this.closeBtn = new Button({
      size: Button.SIZE.TINY,
      type: Button.TYPE.NONE,
      onClick: () => this.unfocusAll(),
      extraClasses: { position: "absolute right-2" }
    }, new FAIcon({ name: "fa-close" }));
    for (let i3 of args) {
      this.addTab(i3);
    }
  }
  /**
   * @param {*} item - item to be added to the menu, needs to be UI.Div
   * @throws Will throw an error if item is not a Div or does not have an id
   */
  addTab(item) {
    if (!(item instanceof Div)) {
      throw new Error("Item is not a Div");
    }
    if (!item.id) {
      throw new Error("Item does not have an id");
    }
    this.tabs[item.id] = item;
    item.setClass("display", "hidden right-0");
    item.attachTo(this.content);
  }
  create() {
    return div8(
      { id: "overlay", class: "hidden" },
      div8({ id: "overlay-darken", onclick: () => {
        this.unfocusAll();
      } }),
      div8({ id: "overlay-content", class: "relative" }, this.closeBtn.create(), this.content.create())
    );
  }
  /**
   * @description Focus on the tab with the given id
   * @param {string} id - The id of the tab to focus on
   * @throws Will throw an error if the tab with the given id does not exist
  **/
  focus(id) {
    const overlay = document.getElementById("overlay");
    if (overlay.classList.contains("hidden")) {
      overlay.classList.remove("hidden");
    }
    if (!(id in this.tabs)) {
      throw new Error("Tab with id " + id + " does not exist");
    }
    for (let tab of Object.values(this.tabs)) {
      if (tab.id == id && tab.classMap.display != "") {
        tab.setClass("display", "");
        continue;
      } else if (tab.id == id && tab.classMap.display == "") {
        document.getElementById("overlay").classList.toggle("hidden");
      }
      tab.setClass("display", "hidden");
    }
  }
  unfocusAll() {
    for (let tab of Object.values(this.tabs)) {
      tab.setClass("display", "hidden");
    }
    document.getElementById("overlay").classList.add("hidden");
  }
  /**
   * @returns {HTMLElement} - The content DOM node of the menu content
   */
  getContentDomNode() {
    return document.getElementById(this.id + "-content");
  }
};

// ui/classes/components/tabsMenu.mjs
var { div: div9, span: span7 } = vanjs_default.tags;
var TabsMenu = class extends BaseComponent {
  constructor(options, ...args) {
    super(options);
    this.tabs = {};
    this.focused = void 0;
    this.design = options.design || "TITLEICON";
    this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" } });
    this.body = new Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full", style: "boxed" } });
    for (let i3 of args) {
      this.addTab(i3);
    }
    this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
    this.classMap["flex"] = "flex-col";
    if (options) {
      this._applyOptions(options, "orientation", "buttonSide", "design", "rounded");
    }
  }
  create() {
    this.header.attachTo(this);
    this.body.attachTo(this);
    return div9(
      { ...this.commonProperties, ...this.extraProperties },
      ...this.children
    );
  }
  addTab(item) {
    if (!(item.id && item.icon && item.title)) {
      throw new Error("Item for menu needs every property set.");
    }
    const tab = this._createTab(item);
    this.tabs[item.id] = tab;
    tab.headerButton.attachTo(this.header);
    if (tab.contentDiv) {
      tab.contentDiv.attachTo(this.body);
    }
  }
  /**
   * @param {*} item dictionary with id, icon, title, body which will be created
   * @returns {*} Button and Div components from VanJS framework
   */
  _createTab(item) {
    const content = item["body"];
    const inText = item["title"];
    let inIcon = item["icon"] instanceof BaseComponent ? item["icon"] : new FAIcon({ name: item["icon"] });
    let action = item["onClick"] ? item["onClick"] : () => {
    };
    const b2 = new Button({
      id: this.id + "-b-" + item.id,
      base: "tab",
      type: Button.TYPE.NONE,
      extraProperties: { title: inText },
      onClick: () => {
        action();
        this.focus(item.id);
      }
    }, inIcon, span7(inText));
    let c2 = void 0;
    if (content) {
      c2 = new Div({ id: this.id + "-c-" + item.id, extraClasses: { display: "display-none", height: "h-full" } }, ...content);
    }
    ;
    return { headerButton: b2, contentDiv: c2 };
  }
  /**
   * @param {*} id of the item we want to focus
   */
  focus(id) {
    if (id in this.tabs) {
      this.unfocusAll();
      this.tabs[id].headerButton.setClass("tab-active", "tab-active");
      if (this.tabs[id].contentDiv) {
        this.tabs[id].contentDiv.setClass("display", "");
      }
      this.focused = id;
      return true;
    }
    return false;
  }
  /**
   * @description unfocus all tabs
   */
  unfocusAll() {
    for (let tab of Object.values(this.tabs)) {
      tab.headerButton.setClass("tab-active", "");
      if (tab.contentDiv) {
        tab.contentDiv.setClass("display", "display-none");
      }
    }
    this.focused = void 0;
  }
};

// ui/classes/elements/checkbox.mjs
var { label, input, span: span8 } = vanjs_default.tags;
var Checkbox = class extends BaseComponent {
  /**
   * @param {*} options 
   * @param  {...any} args 
   * @param {string} [options.label] - The label for the checkbox
   * @param {boolean} [options.checked] - The initial checked state of the checkbox
   * @param {Function} [options.onchange] - The function to call when the checkbox state changes
   */
  constructor(options, ...args) {
    super(options, ...args);
    this.label = options["label"] || "";
    this.checked = options["checked"] || false;
    this.onchangeFunction = options["onchange"] || (() => {
    });
  }
  create() {
    return label(
      { id: this.id, class: "cursor-pointer boxed", style: "display: flex; align-items: center; gap: 8px;", onmousedown: function(e2) {
        e2.stopPropagation();
        e2.preventDefault();
      } },
      input({ type: "checkbox", class: "checkbox checkbox-sm", checked: this.checked ? "checked" : "", onchange: this.onchangeFunction }),
      this.label && span8({ class: "" }, this.label)
    );
  }
};

// ui/classes/components/toolbar.mjs
var { div: div10, span: span9 } = vanjs_default.tags;
var Toolbar = class extends BaseComponent {
  /**
   * 
   * @param {*} options
   * @param {*} args
   */
  constructor(options, ...args) {
    super(options);
    this.classMap["base"] = "flex gap-1 bg-base-200 h-full";
    this.classMap["flex"] = "flex-col";
    this.design = options.design || "TITLEICON";
    this.tabs = {};
    this.focused = void 0;
    this.header = new Div({ id: this.id + "-header", extraClasses: { tabs: "tabs", style: "tabs-boxed" } });
    this.body = new Div({ id: this.id + "-body", extraClasses: { height: "h-full", width: "w-full", style: "boxed" } });
    if (args.length === 0) {
      this.display = "none";
    }
    for (let i3 of args) {
      this.addToToolbar(i3);
    }
  }
  /**
   * @description creates new toolbar item and adds it to the toolbar
   * @param {*} item dictionary with  id, icon, title, body
   */
  addToToolbar(item) {
    if (!(item.id && item.icon && item.title)) {
      throw new Error("Item for menu needs every property set.");
    }
    this.header.setClass("display", "");
    this.body.setClass("display", "");
    const tab = this._createTab(item);
    this.tabs[item.id] = tab;
    tab.headerButton.attachTo(this.header);
    if (tab.contentDiv) {
      tab.contentDiv.attachTo(this.body);
    }
    this.display = "";
    if (Object.keys(this.tabs).length === 1) {
      this.focus(item.id);
      this.header.setClass("display", "hidden");
    } else {
      this.header.setClass("display", "");
    }
  }
  /**
   * @param {*} item dictionary with  id, icon, title, body
   * @returns tuple of header Button and content Div components
   */
  _createTab(item) {
    const content = item["body"];
    const inText = item["title"];
    let inIcon = item["icon"] instanceof BaseComponent ? item["icon"] : new FAIcon({ name: item["icon"] });
    let action = item["onClick"] ? item["onClick"] : () => {
    };
    const b2 = new Button({
      id: this.id + "-b-" + item.id,
      base: "tab",
      type: Button.TYPE.NONE,
      extraProperties: { title: inText },
      onClick: () => {
        action();
        this.focus(item.id);
      }
    }, inIcon, span9(inText));
    let c2 = void 0;
    if (content) {
      c2 = new Div({ id: this.id + "-c-" + item.id, extraClasses: { display: "display-none", height: "h-full" } }, ...content);
    }
    ;
    return { headerButton: b2, contentDiv: c2 };
  }
  create() {
    return div10(
      {
        id: `${this.id}`,
        class: "draggable boxed",
        style: `position: fixed; 
                            left: ${APPLICATION_CONTEXT.getOption(`${this.id}-PositionLeft`, 50)}px; 
                            top: ${APPLICATION_CONTEXT.getOption(`${this.id}-PositionTop`, 50)}px; 
                            display: ${this.display};
                            z-index: 1000;`
      },
      div10({ class: "handle" }, "----"),
      this.body.create()
    );
  }
  /**
   * 
   * @param {*} id id of tab we want to focus
   * @returns if the tab was focused
   */
  focus(id) {
    if (id in this.tabs) {
      this.unfocusAll();
      this.tabs[id].headerButton.setClass("tab-active", "tab-active");
      if (this.tabs[id].contentDiv) {
        this.tabs[id].contentDiv.setClass("display", "");
      }
      this.focused = id;
      return true;
    }
    return false;
  }
  /**
   * @description unfocus all tabs
   */
  unfocusAll() {
    for (let tab of Object.values(this.tabs)) {
      tab.headerButton.setClass("tab-active", "");
      if (tab.contentDiv) {
        tab.contentDiv.setClass("display", "display-none");
      }
    }
    this.focused = void 0;
  }
};

// ui/classes/elements/select.mjs
var { select, option, div: div11 } = vanjs_default.tags;
var Select = class extends BaseComponent {
  constructor(options, ...children) {
    super(options, ...children);
    this.options = children;
    this.title = options["title"] || "";
    this.selected = options["selected"] || null;
    this.onChange = options["onchange"] || (() => {
    });
  }
  create() {
    return div11(
      {},
      this.title,
      select(
        {
          class: "select select-bordered select-xs max-w-xs",
          onchange: this.onChange,
          id: this.id,
          style: "margin: 0.2rem;"
        },
        ...this.options.map((o2) => {
          return option({
            value: o2.value || "",
            selected: o2.value === this.selected ? "selected" : "",
            hidden: o2.hidden || "",
            text: o2.text || ""
          });
        })
      )
    );
  }
};

// ui/classes/elements/rawHtml.mjs
var { div: div12 } = vanjs_default.tags;
var RawHtml = class extends BaseComponent {
  constructor(options, html = "") {
    super(options);
    this._html = html;
  }
  setHtml(html) {
    this._html = html;
    const el = document.getElementById(this.id);
    if (el) el.innerHTML = html;
  }
  create() {
    const el = div12({ ...this.commonProperties, ...this.extraProperties });
    el.innerHTML = this._html;
    return el;
  }
};

// ui/classes/components/shaderLayer.mjs
var { div: div13, span: span10, input: input2, label: label2, br } = vanjs_default.tags;
var ShaderLayer = class extends BaseComponent {
  constructor(options) {
    super(options);
    this.cfg = options.shaderConfig;
    this.layer = options.shaderLayer;
    this.availableShaders = options.availableShaders || [];
    this.cb = options.callbacks || {};
    this.body = new RawHtml({ extraClasses: { nd: "non-draggable" } }, this.layer.htmlControls((html) => `<div class="shader-controls-row">${html}</div>`));
    this.fixed = !!this.cfg.fixed;
    this.visible = this.cfg.visible !== false;
    this.mode = this.cfg.params?.use_mode || "show";
    this.type = this.cfg.type;
    this.title = this.cfg.name;
    this.filters = options.availableFilters || {};
    this.cacheApplied = this.cfg._cacheApplied;
    this.classMap.base = "shader-part bg-gradient-to-r from-primary to-transparent rounded-3 mx-1 mb-2 pl-2 pt-1 pb-2";
    this.classMap.resizable = "resizable";
    this.classMap.dim = this.visible ? "" : "brightness-50";
    this.classMap.clipNudge = this.visible && this.mode === "clip" ? "translate-x-[10px]" : "";
  }
  // ---- small helpers
  _isModeShow() {
    return !this.mode || this.mode === "show";
  }
  _nextMode() {
    return this._isModeShow() ? "blend" : this.mode;
  }
  // legacy kept blend as the alt
  _buildHeaderLeft() {
    this.checkbox = new Checkbox({
      label: "",
      checked: this.visible,
      onchange: (e2) => {
        const checked = e2.target.checked;
        this.visible = checked;
        this.setClass("dim", checked ? "" : "brightness-50");
        this.cb.onToggleVisible?.(checked);
      }
    });
    const left = div13(
      { class: "flex items-center gap-2 non-draggable" },
      this.checkbox.create(),
      span10({ class: "one-liner", title: this.title, style: "width:210px;vertical-align:bottom;" }, this.title)
    );
    return left;
  }
  _buildRenderTypeSelector() {
    const gear = new FAIcon({ name: "fa-sliders" });
    this.renderTypeSelect = new Select({
      id: this.id + "-change-render-type",
      title: "",
      selected: this.type,
      extraClasses: { xs: "select-xs" },
      extraProperties: { "disabled": "", "value": this.type },
      onchange: (e2) => {
        const val = e2.target.value;
        this.type = val;
        this.cb.onChangeType?.(val);
      }
    }, ...this.availableShaders.map((s2) => ({ value: s2.type, text: s2.name })));
    if (this.fixed) {
      this.renderTypeSelect.setExtraProperty("disabled", "disabled");
    }
    this.renderTypeSelect.setClass("display", "hidden");
    const wrap = new Div(
      { extraClasses: { inline: "inline-block non-draggable" }, extraProperties: {
        "style": "float:right"
      } },
      // non-draggable
      this.renderTypeSelect
    );
    return wrap.create();
  }
  _buildModeToggle() {
    const icon = new FAIcon({ name: "fa-layer-group" });
    this.modeBtn = new Button({
      id: this.layer.id + "-mode-toggle",
      // keep legacy id
      size: Button.SIZE.SMALL,
      type: Button.TYPE.NONE,
      extraProperties: { title: "Toggle blending / info", style: `float:right; ${this.cfg.fixed ? "display:none;" : ""}` },
      onClick: () => this.cb.onChangeMode?.(toMode)
    }, icon);
    this.modeBtn.setClass("non-draggable", "non-draggable");
    if (this._isModeShow()) {
      this.modeBtn.setClass("tint", "text-base-300");
    }
    return this.modeBtn.create();
  }
  _buildDragHandle() {
    const drag = new FAIcon({ name: "fa-up-down" });
    const btn = new Button({
      size: Button.SIZE.SMALL,
      type: Button.TYPE.NONE,
      extraProperties: { "style": "float:right" },
      // IMPORTANT: no 'non-draggable' here → this is the handle
      onClick: () => {
      }
    }, drag);
    return btn.create();
  }
  _buildHeader() {
    return div13(
      { class: "h5 py-1 relative flex items-center gap-2 truncate max-w-full" },
      this._buildHeaderLeft(),
      this._buildRenderTypeSelector(),
      this._buildModeToggle(),
      this._buildDragHandle()
    );
  }
  _buildFilters() {
    const rows = [];
    const entries = Object.entries(this.filters);
    for (const [key, f2] of entries) {
      const onChange = (e2) => {
        const v2 = Number.parseFloat(e2.target.value);
        if (!Number.isNaN(v2)) {
          this.filters[key].value = v2;
          this.cb.onSetFilter?.(key, v2);
        }
      };
      rows.push(
        label2({ class: "text-xs mr-2" }, f2.name + ":"),
        input2({
          type: "number",
          value: f2.value,
          class: "input input-xs input-bordered w-24",
          style: "margin-right: 8px;",
          onchange: onChange
        }),
        br()
      );
    }
    return div13({}, ...rows);
  }
  _buildCacheBanner() {
    if (!this.cacheApplied) return void 0;
    const clearBtn = new Button({
      size: Button.SIZE.TINY,
      type: Button.TYPE.SECONDARY,
      onClick: () => this.cb.onClearCache?.()
    }, new FAIcon({ name: "fa-broom" }), span10("Clear cache"));
    return div13(
      { class: "p-2 rounded-2 bg-base-200 mt-2 flex", style: "width:97%;" },
      span10({ class: "text-xs flex-1" }, `Cache: ${this.cacheApplied} `),
      clearBtn.create()
    );
  }
  create() {
    this.setClass("clipNudge", this.visible && this.mode === "clip" ? "translate-x-[10px]" : "");
    this.setClass("dim", this.visible ? "" : "brightness-50");
    return div13(
      {
        ...this.commonProperties,
        id: `${this.layer.id}-shader-part`,
        "data-id": this.layer.id,
        class: `${this.classState.val}`
      },
      this._buildHeader(),
      this.body.create(),
      this._buildFilters(),
      this._buildCacheBanner()
    );
  }
  // Optional: update from external changes (e.g., when renderer modifies config)
  update(shaderConfig) {
    this.cfg = shaderConfig;
    this.visible = shaderConfig?.visible !== false;
    this.mode = shaderConfig?.params?.use_mode || "show";
    this.type = shaderConfig?.type || this.type;
    this.cacheApplied = shaderConfig?._cacheApplied;
    this.setClass("clipNudge", this.visible && this.mode === "clip" ? "translate-x-[10px]" : "");
    this.setClass("dim", this.visible ? "" : "brightness-50");
    if (this.renderTypeSelect) {
      this.renderTypeSelect.setExtraProperty("value", this.type);
    }
  }
};

// ui/classes/components/shaderMenu.mjs
var { div: div14, span: span11, select: select2, option: option2, label: label3, input: input3, br: br2, ul: ul2, li: li2, a: a3 } = vanjs_default.tags;
var ShaderMenu = class extends BaseComponent {
  constructor(opts = {}) {
    super(opts);
    this.shaders = [];
    this.selectedShader = "";
    this.opacity = typeof opts.opacity === "number" ? opts.opacity : 1;
    this.cb = {
      onShaderChange: opts.onShaderChange,
      onOpacityChange: opts.onOpacityChange,
      onPinChange: opts.onPinChange,
      onCacheSnapshotByName: opts.onCacheSnapshotByName,
      onCacheSnapshotByOrder: opts.onCacheSnapshotByOrder
    };
    this._outsideHandler = (e2) => {
      if (!this._cacheDropdownWrap) return;
      if (!this._cacheDropdownWrap.contains(e2.target)) this._setCacheOpen(false);
    };
  }
  // Public: where ShaderLayer items are rendered/managed
  getLayerContainerEl() {
    return document.getElementById("data-layer-options");
  }
  _setCacheOpen(open) {
    if (!this._cacheDropdownWrap) return;
    this._cacheDropdownWrap.classList.toggle("dropdown-open", !!open);
    if (open) {
      document.addEventListener("click", this._outsideHandler, { capture: true });
    } else {
      document.removeEventListener("click", this._outsideHandler, { capture: true });
    }
  }
  _buildHeaderRow() {
    const shaderGoalList = this.shaders.map((s2) => option2({ value: s2.value }, s2.label));
    if (shaderGoalList.length === 0) {
      shaderGoalList.push(option2({ value: "" }, $.t("main.shaders.notAvailable")));
    }
    const shaderSelect = select2(
      {
        id: "shaders",
        name: "shaders",
        class: "select select-bordered select-sm align-middle w-4/5 max-w-xs cursor-pointer text-xl text-lg",
        "aria-label": "Visualization",
        value: this.selectedShader,
        onchange: (e2) => {
          this.selectedShader = e2.target.value;
          this.cb.onShaderChange?.(this.selectedShader);
        },
        title: $.t("main.shaders.select") ?? "Select shader"
      },
      ...shaderGoalList
    );
    this._cacheDropdownWrap = div14(
      { class: "dropdown dropdown-end float-right relative" },
      // trigger
      span11(
        {
          id: "cache-snapshot",
          tabindex: "0",
          role: "button",
          class: "material-icons btn btn-ghost btn-circle btn-sm align-middle",
          style: "vertical-align:sub;",
          title: $.t("main.shaders.saveCookies"),
          onclick: (e2) => {
            e2.stopPropagation();
            const open = !this._cacheDropdownWrap.classList.contains("dropdown-open");
            this._setCacheOpen(open);
          }
        },
        "bookmark"
      ),
      // menu
      ul2(
        {
          tabindex: "0",
          class: "dropdown-content menu shadow bg-base-100 rounded-box w-48 z-[1]"
        },
        li2(
          a3(
            {
              title: $.t("main.shaders.cacheByName"),
              onclick: () => {
                this.cb.onCacheSnapshotByName?.();
                this._setCacheOpen(false);
              }
            },
            // icon: sort_by_alpha
            span11({ class: "material-icons mr-2" }, "sort_by_alpha"),
            $.t("main.shaders.cacheByName")
          )
        ),
        li2(
          a3(
            {
              title: $.t("main.shaders.cacheByOrder"),
              onclick: () => {
                this.cb.onCacheSnapshotByOrder?.();
                this._setCacheOpen(false);
              }
            },
            // icon: format_list_numbered
            span11({ class: "material-icons mr-2" }, "format_list_numbered"),
            $.t("main.shaders.cacheByOrder")
          )
        )
      )
    );
    return div14({}, shaderSelect, this._cacheDropdownWrap, br2());
  }
  create() {
    const panelImages = div14({ id: "panel-images", class: "mt-2" });
    const header = this._buildHeaderRow();
    const optionsContainer = div14(
      { id: "data-layer-options", class: "clear-both mt-2" }
    );
    const blendingEq = div14({ id: "blending-equation" });
    const content = div14(
      { class: "select-none" },
      header,
      optionsContainer,
      blendingEq
    );
    return div14(
      { id: "panel-shaders", class: "p-2" },
      content,
      panelImages
    );
  }
  // ----- external API -----
  updateShaders(shaders, selectedValue) {
    this.shaders = shaders || [];
    this.selectedShader = selectedValue ?? (this.shaders[0]?.value ?? "");
    const sel = document.getElementById("shaders");
    if (sel) {
      sel.innerHTML = "";
      this.shaders.forEach((s2) => {
        const opt = document.createElement("option");
        opt.value = s2.value;
        opt.textContent = s2.label;
        sel.appendChild(opt);
      });
      sel.value = this.selectedShader;
    }
  }
  disconnected() {
    document.removeEventListener("click", this._outsideHandler, { capture: true });
  }
};

// ui/classes/elements/alert.mjs
var { div: div15, span: span12, path, svg } = vanjs_default.tags;
var MODES = (
  /** @type {const} */
  ["neutral", "info", "success", "warning", "error"]
);
var isMode = (v2) => MODES.includes(v2);
var MODE_CLASS_FILLED = {
  neutral: "",
  // just .alert
  info: "alert-info",
  success: "alert-success",
  warning: "alert-warning",
  error: "alert-error"
};
var MODE_CLASS_SOFT = {
  neutral: "border border-base-300 bg-base-200 text-base-content/80",
  info: "border border-info bg-info/10 text-info",
  success: "border border-success bg-success/10 text-success",
  warning: "border border-warning bg-warning/10 text-warning",
  error: "border border-error bg-error/10 text-error"
};
var ICON_COLOR_FILLED = {
  neutral: "text-base-content",
  info: "text-info-content",
  success: "text-success-content",
  warning: "text-warning-content",
  error: "text-error-content"
};
var ICON_COLOR_SOFT = {
  neutral: "text-base-content/80",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error"
};
var Alert = class extends BaseComponent {
  /**
   * @param {{
   *  id?: string,
   *  mode?: "neutral"|"info"|"success"|"warning"|"error",
   *  title?: string|Node,
   *  description?: string|Node,
   *  closable?: boolean,
   *  compact?: boolean,
   *  soft?: boolean,
   *  onClose?: () => void,
   * }} opts
   */
  constructor(opts = {}) {
    super(opts);
    this.mode = isMode(opts.mode) ? opts.mode : "neutral";
    this.title = opts.title ?? "";
    this.description = opts.description ?? "";
    this.closable = !!opts.closable;
    this.compact = !!opts.compact;
    this.soft = !!opts.soft;
    this.onClose = opts.onClose;
    this._computeBaseClass();
  }
  _computeBaseClass() {
    const filled = MODE_CLASS_FILLED[this.mode] ?? "";
    const soft = MODE_CLASS_SOFT[this.mode] ?? "";
    const look = this.soft ? soft : filled;
    this.classMap.base = [
      "alert",
      // DaisyUI alert
      look,
      this.compact ? "py-1 px-2 text-sm" : "py-2 px-3"
    ].filter(Boolean).join(" ");
  }
  create() {
    const titleNode = this.title ? div15({ class: "font-semibold" }, this.title) : null;
    const closeBtn = this.closable ? div15(
      {
        role: "button",
        class: "ml-auto btn btn-ghost btn-xs min-h-0 h-6 px-2",
        onclick: () => {
          this.hide();
          this.onClose?.();
        },
        title: "Close"
      },
      span12({ class: "material-icons text-base" }, "close")
    ) : null;
    const alertNode = div15(
      {
        ...this.commonProperties,
        id: this.id,
        class: this.classMap.base,
        role: "alert",
        tabindex: "0",
        onclick: (e2) => {
          if (e2.target.closest?.("[data-tooltip-exempt]")) return;
          USER_INTERFACE.Tooltip.toggle(alertNode, {
            content: this.description,
            // HTML or text
            placement: "bottom",
            trigger: "both",
            // hover+click support
            interactive: true,
            offset: 8
          });
        },
        onmouseenter: () => USER_INTERFACE.Tooltip.show(alertNode, {
          content: this.description,
          placement: "bottom",
          trigger: "both",
          interactive: true,
          offset: 8
        }),
        onmouseleave: () => {
          USER_INTERFACE.Tooltip.hide();
        }
      },
      iconSvg(this.mode, { soft: this.soft }),
      div15(titleNode),
      closeBtn
    );
    return alertNode;
  }
  /* ------- minimal API for runtime updates ------- */
  setMode(mode, { soft = this.soft } = {}) {
    if (!["neutral", "info", "success", "warning", "error"].includes(mode)) return;
    this.mode = mode;
    this.soft = !!soft;
    this._computeBaseClass();
    const el = document.getElementById(this.id);
    if (!el) return;
    el.className = this.classMap.base;
    el.firstChild?.replaceWith(iconSvg(this.mode, { soft: this.soft }));
  }
  setTitle(v2) {
    this.title = v2 ?? "";
    this._rerender();
  }
  setDescription(v2) {
    this.description = v2 ?? "";
    this._rerender();
  }
  show() {
    const el = document.getElementById(this.id);
    if (el) el.classList.remove("hidden");
  }
  hide() {
    const el = document.getElementById(this.id);
    if (el) el.classList.add("hidden");
  }
  _rerender() {
    const el = document.getElementById(this.id);
    if (!el) return;
    const textWrap = el.children[1];
    if (!textWrap) return;
    textWrap.innerHTML = "";
    const titleNode = this.title ? div15({ class: "font-semibold" }, this.title) : null;
    USER_INTERFACE.Tooltip.update(document.getElementById(this.id), { content: this.description });
    textWrap.appendChild(titleNode);
  }
};
function iconSvg(mode, { soft = false, hidden = false } = {}) {
  const { svg: svg2, path: path2 } = vanjs_default.tags;
  const size = "w-5 h-5 shrink-0";
  const color = soft ? ICON_COLOR_SOFT[mode] || "text-base-content" : ICON_COLOR_FILLED[mode] || "text-base-content";
  const svgCls = `${size} ${color} stroke-current ${hidden ? "invisible" : ""}`;
  const pathAttrs = {
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };
  switch (mode) {
    case "success":
      pathAttrs.d = "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0";
      break;
    case "warning":
      pathAttrs.d = "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0";
      break;
    case "error":
      pathAttrs.d = "M12 8v4m0 4h.01M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07";
      break;
    case "info":
    default:
      pathAttrs.d = "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20";
      break;
  }
  return svg2({
    // width: "16px",
    viewBox: "0 0 24 24",
    "class": svgCls,
    fill: "none",
    "aria-hidden": hidden ? "true" : "false",
    xmlns: "http://www.w3.org/2000/svg"
  }, path2(pathAttrs));
}

// ui/classes/elements/stretch-grid.mjs
var { div: div16 } = vanjs_default.tags;
var StretchGrid = class extends BaseComponent {
  constructor(options = {}, ...children) {
    super(options, ...children);
    this.cols = options.cols || 3;
    this.gap = options.gap || "12px";
    this.aspect = options.aspect || "4/3";
    this.items = [];
    this.setItems = this.setItems.bind(this);
    this.push = this.push.bind(this);
    this.removeAt = this.removeAt.bind(this);
    this.setCols = this.setCols.bind(this);
    this.setAspect = this.setAspect.bind(this);
  }
  setItems(itemsOrCount) {
    this.items = [];
    const n2 = Array.isArray(itemsOrCount) ? itemsOrCount.length : +itemsOrCount | 0;
    for (let i3 = 0; i3 < n2; i3++) {
      const node = Array.isArray(itemsOrCount) ? itemsOrCount[i3] : this._defaultItem(i3);
      node.classList.add("stretch-grid__item");
      this.items.push(node);
    }
    this._layout();
    this._children = this.items;
    this._renderedChildren = null;
  }
  push(node) {
    const el = node || this._defaultItem(this.items.length);
    el.classList.add("stretch-grid__item");
    this.items.push(el);
    this._layout();
    this._children = this.items;
    this._renderedChildren = null;
  }
  removeAt(idx) {
    if (!this.items[idx]) return;
    this.items.splice(idx, 1);
    this._layout();
    this._children = this.items;
    this._renderedChildren = null;
  }
  setCols(n2) {
    this.cols = n2;
    this._layout();
  }
  setAspect(r2) {
    this.aspect = r2;
    this._layout();
  }
  _defaultItem(i3) {
    const d2 = document.createElement("div");
    d2.textContent = i3 + 1;
    return d2;
  }
  _makeCell(id) {
    const d2 = document.createElement("div");
    d2.classList.add("stretch-grid__item");
    d2.id = id;
    return d2;
  }
  createCell(id) {
    const el = this._makeCell(id);
    this.push(el);
    return el;
  }
  attachCell(id) {
    const self = document.getElementById(this.id);
    if (!self) return;
    self.appendChild(this.createCell(id));
  }
  _layout() {
    const cols = Math.max(1, this.cols | 0);
    const n2 = this.items.length;
    const rem = n2 % cols;
    let m2 = 1;
    if (rem) {
      for (let k = 1; k <= 6; k++) {
        if (cols * k % rem === 0) {
          m2 = k;
          break;
        }
      }
    }
    const renderedCols = cols * m2;
    this._gridStyle = `position:fixed; inset:0; display:grid;grid-template-columns: repeat(${renderedCols}, 1fr);gap:${this.gap}; --aspect:${this.aspect};`;
    this.items.forEach((el) => el.style.gridColumn = "");
    if (rem) {
      const span15 = Math.floor(renderedCols / rem);
      const lastRow = this.items.slice(-rem);
      lastRow.forEach((el, i3) => {
        const start = i3 * span15 + 1;
        el.style.gridColumn = `${start} / span ${span15}`;
      });
    }
  }
  create() {
    this._layout();
    return div16(
      {
        id: this.id,
        class: "stretch-grid " + (this.classState.val || ""),
        style: this._gridStyle,
        ...this.extraProperties
      },
      this.children
    );
  }
};

// ui/classes/components/floatingWindow.mjs
var { div: div17, span: span13 } = vanjs_default.tags;
var FloatingWindow = class extends BaseComponent {
  constructor(options = {}, ...bodyChildren) {
    super(options, ...bodyChildren);
    this.classMap.base = "card bg-base-200 shadow-xl border border-base-300";
    this.classMap.positioning = "fixed";
    this.classMap.rounded = "rounded-box";
    this.classMap.flex = "flex flex-col";
    this.classMap.z = "z-50";
    this.title = options.title ?? "Window";
    this.resizable = options.resizable !== false;
    this.closable = options.closable ?? true;
    this._cacheKey = (k) => `${this.id}:${k}`;
    this._w = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("w"), options.width ?? 360);
    this._h = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("h"), options.height ?? 240);
    this._l = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("l"), options.startLeft ?? 64);
    this._t = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("t"), options.startTop ?? 64);
    this._external = false;
    this._childWindow = null;
    this._rootEl = null;
    this._bodyEl = null;
    this._dragging = false;
    this._dragOffX = 0;
    this._dragOffY = 0;
    const btnClose = this.closable || options.onClose ? [
      (this._btnClose = new Button({
        size: Button.SIZE.TINY,
        type: Button.TYPE.NONE,
        extraClasses: { btn: "btn btn-ghost btn-xs btn-square" },
        onClick: () => this.close()
      }, new FAIcon({ name: "fa-close" }))).create()
    ] : [];
    this._header = new Div(
      {
        extraClasses: {
          layout: "navbar min-h-0 h-9 bg-base-300/70 rounded-t-box px-2 cursor-move select-none"
        }
      },
      div17(
        { class: "flex items-center gap-2" },
        new FAIcon({ name: "fa-up-down-left-right" }).create(),
        span13({ class: "font-semibold truncate" }, this.title)
      ),
      div17(
        { class: "ml-auto flex items-center gap-1" },
        ...btnClose
      )
    );
    this._content = new Div({
      extraClasses: {
        wrap: "card-body p-2 gap-2 overflow-auto flex-1 min-h-0"
      },
      extraProperties: { style: "width:100%; height:100%;" }
    }, ...this._children);
    this._resizeHandle = this.resizable ? div17({
      class: "absolute right-1 bottom-1 w-3 h-3 cursor-se-resize opacity-50 border-r-2 border-b-2 border-base-content/50"
    }) : null;
  }
  // ---------- public API ----------
  focus() {
    if (!this._rootEl) return;
    this._rootEl.style.zIndex = String(Date.now());
    this._rootEl.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-base-100");
    setTimeout(() => this._rootEl?.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-base-100"), 200);
  }
  opened() {
    if (this._external) {
      return this._childWindow?.closed;
    }
    return !!document.getElementById(this.id);
  }
  close() {
    if (!this.closable) {
      this.options.onClose?.();
      return;
    }
    if (this._external && !this._childWindow?.closed) {
      this._childWindow.close();
    }
    this._external = false;
    this._childWindow = null;
    this.options.onClose?.();
    this.remove();
  }
  // ---------- internal ----------
  _applyBounds() {
    if (!this._rootEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minW = 220;
    const minH = 140;
    let w2 = Math.max(minW, Math.min(this._w, vw - 16));
    let h2 = Math.max(minH, Math.min(this._h, vh - 16));
    let l2 = Math.min(Math.max(0, this._l), Math.max(0, vw - w2));
    let t2 = Math.min(Math.max(0, this._t), Math.max(0, vh - h2));
    this._w = w2;
    this._h = h2;
    this._l = l2;
    this._t = t2;
    this._rootEl.style.width = `${w2}px`;
    this._rootEl.style.height = `${h2}px`;
    this._rootEl.style.left = `${l2}px`;
    this._rootEl.style.top = `${t2}px`;
  }
  _persist() {
    APPLICATION_CONTEXT.AppCache.set(this._cacheKey("w"), this._w);
    APPLICATION_CONTEXT.AppCache.set(this._cacheKey("h"), this._h);
    APPLICATION_CONTEXT.AppCache.set(this._cacheKey("l"), this._l);
    APPLICATION_CONTEXT.AppCache.set(this._cacheKey("t"), this._t);
  }
  _onDragStart = (e2) => {
    if (this._external) return;
    this._dragging = true;
    const rect = this._rootEl.getBoundingClientRect();
    const startX = e2.touches ? e2.touches[0].clientX : e2.clientX;
    const startY = e2.touches ? e2.touches[0].clientY : e2.clientY;
    this._dragOffX = startX - rect.left;
    this._dragOffY = startY - rect.top;
    document.addEventListener("mousemove", this._onDragMove);
    document.addEventListener("mouseup", this._onDragEnd);
    document.addEventListener("touchmove", this._onDragMove, { passive: false });
    document.addEventListener("touchend", this._onDragEnd);
    this.focus();
  };
  _onDragMove = (e2) => {
    if (!this._dragging) return;
    const x2 = e2.touches ? e2.touches[0].clientX : e2.clientX;
    const y2 = e2.touches ? e2.touches[0].clientY : e2.clientY;
    this._l = x2 - this._dragOffX;
    this._t = y2 - this._dragOffY;
    this._applyBounds();
    this._persist();
    if (e2.cancelable) e2.preventDefault();
  };
  _onDragEnd = () => {
    this._dragging = false;
    document.removeEventListener("mousemove", this._onDragMove);
    document.removeEventListener("mouseup", this._onDragEnd);
    document.removeEventListener("touchmove", this._onDragMove);
    document.removeEventListener("touchend", this._onDragEnd);
  };
  _onResizeDragStart = (e2) => {
    if (this._external) return;
    e2.stopPropagation();
    const startX = e2.touches ? e2.touches[0].clientX : e2.clientX;
    const startY = e2.touches ? e2.touches[0].clientY : e2.clientY;
    const startW = this._w;
    const startH = this._h;
    const move = (ev) => {
      ev.stopPropagation();
      const x2 = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const y2 = ev.touches ? ev.touches[0].clientY : ev.clientY;
      this._w = startW + (x2 - startX);
      this._h = startH + (y2 - startY);
      this._applyBounds();
      this._persist();
      if (ev.cancelable) ev.preventDefault();
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  };
  _toggleExternal() {
    if (this._external) {
      this._childWindow?.focus();
      return;
    }
    const features = `popup=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes,width=${this._w},height=${this._h},left=${this._l},top=${this._t}`;
    const child = window.open("", `${this.id}-popup`, features);
    if (!child) return;
    this._external = true;
    this._childWindow = child;
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    child.document.write(`
  <!doctype html>
  <html data-theme="${currentTheme}">
    <head>
      <meta charset="utf-8"/>
      <title>${this.title}</title>
      <style>
        html,body{height:100%;margin:0}
        body{background:var(--b2);color:var(--bc);font-family:ui-sans-serif,system-ui;}
        .fw-host{position:absolute;inset:0;display:flex;flex-direction:column}
      </style>
        <!--TODO dirty hardcoded path-->
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/assets/style.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/libs/tailwind.min.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
        <script src="https://code.jquery.com/jquery-3.5.1.min.js"
            integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
            crossorigin="anonymous"><\/script>
        <script type="text/javascript">
            //route to the parent context
            window.confirm = function(message) {
                window.opener.focus();
                window.opener.confirm(message);
            };
            $.t = window.opener.$.t;
            $.i18n = window.opener.$.i18n;
            $.prototype.localize = () => {console.error("localize() not supported in child window!")};
        <\/script>
    </head>
    <body>
      <div id="fw-host" class="fw-host"></div>
    </body>
  </html>
`);
    child.document.close();
    this._installBridge(child);
    const host = child.document.getElementById("fw-host");
    const placeholder = child.document.createElement("div");
    host.appendChild(placeholder);
    child.postMessage({ __fw: true, type: "request-render", id: this.id }, "*");
    const syncSize = () => {
      try {
        const w2 = child.innerWidth, h2 = child.innerHeight;
        this._w = w2;
        this._h = h2;
        this._persist();
      } catch {
      }
    };
    child.addEventListener("resize", syncSize);
    child.addEventListener("beforeunload", () => {
      this._external = false;
      this._childWindow = null;
    });
  }
  _installBridge(child) {
    const parentHandler = (ev) => {
      const msg = ev.data;
      if (!msg || !msg.__fw) return;
      if (msg.type === "request-render" && msg.id === this.id) {
        const html = this._bodyEl?.innerHTML ?? "";
        child.postMessage({ __fw: true, type: "render-html", id: this.id, html }, "*");
      }
      if (msg.type === "event") {
      }
    };
    window.addEventListener("message", parentHandler);
    child.addEventListener("load", () => {
      const childHandler = (ev) => {
        const msg = ev.data;
        if (!msg || !msg.__fw) return;
        if (msg.type === "render-html" && msg.id === this.id) {
          const host = child.document.getElementById("fw-host");
          host.innerHTML = msg.html || "";
          host.addEventListener("click", (e2) => {
            const data = { path: e2.composedPath().map((n2) => n2.id || n2.className || n2.nodeName) };
            child.opener?.postMessage({ __fw: true, type: "event", id: this.id, payload: { kind: "click", data } }, "*");
          }, { capture: true });
        }
      };
      child.addEventListener("message", childHandler);
    });
  }
  create() {
    const root = div17(
      {
        ...this.commonProperties,
        style: `
        position: fixed;
        width:${this._w}px; height:${this._h}px;
        left:${this._l}px; top:${this._t}px;
      `,
        onmousedown: () => this.focus()
      },
      // header (drag handle)
      this._header.create(),
      // body
      this._bodyEl = this._content.create(),
      // resize corner
      this._resizeHandle
    );
    queueMicrotask(() => {
      this._rootEl = document.getElementById(this.id);
      const headerEl = document.getElementById(this._header.id) || this._rootEl.firstChild;
      headerEl.addEventListener("mousedown", this._onDragStart);
      headerEl.addEventListener("touchstart", this._onDragStart, { passive: false });
      if (this._resizeHandle) {
        const el = this._rootEl.querySelector(".cursor-se-resize");
        el?.addEventListener("mousedown", this._onResizeDragStart);
        el?.addEventListener("touchstart", this._onResizeDragStart, { passive: false });
      }
      const onViewport = () => {
        if (this._external) return;
        this._applyBounds();
        this._persist();
      };
      window.addEventListener("resize", onViewport);
      this._rootEl.__fw_cleanup = () => {
        headerEl.removeEventListener("mousedown", this._onDragStart);
        headerEl.removeEventListener("touchstart", this._onDragStart);
        window.removeEventListener("resize", onViewport);
      };
      this._applyBounds();
    });
    return root;
  }
  remove() {
    try {
      this._rootEl?.__fw_cleanup?.();
    } catch {
    }
    super.remove();
  }
};

// ui/classes/components/slideSwitcherMenu.mjs
var { div: div18, input: input4, label: label4, img, span: span14, button: button2 } = vanjs_default.tags;
var SlideSwitcherMenu = class extends BaseComponent {
  constructor(options = {}) {
    super(options);
    this._needsRefresh = true;
    this._suspendUpdates = false;
  }
  // ---------- public ----------
  open() {
    if (!this._fw) {
      this.windowId = this.options.id ?? "slide-switcher";
      this.title = this.options.title ?? "Slide Switcher";
      this.w = this.options.width ?? 520;
      this.h = this.options.height ?? 460;
      this.l = this.options.startLeft ?? 80;
      this.t = this.options.startTop ?? 80;
      this.stacked = !!APPLICATION_CONTEXT.getOption("stackedBackground");
      const pre = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", void 0, false);
      const selection = (Array.isArray(pre) ? pre : pre ? [pre] : [0]).map(Number.parseInt);
      this.selected = new Set(selection);
      this._listEl = null;
      this._toolbarEl = null;
      this._fw = new FloatingWindow({
        id: this.windowId,
        title: this.title,
        width: this.w,
        height: this.h,
        startLeft: this.l,
        startTop: this.t,
        resizable: true,
        onClose: () => this.options.onClose?.(),
        onPopout: (w2) => this.options.onPopout?.(w2)
      }, new Div(
        {
          extraClasses: { body: "card-body p-1 gap-1 flex-1 min-h-0 overflow-hidden" }
        },
        this._toolbarEl = this._renderToolbar(),
        this._listEl = this._renderList([])
      ));
    }
    if (!this._fw.opened()) {
      this._fw.attachTo(document.body);
    } else {
      this._fw.focus();
    }
    if (this._needsRefresh) this.refresh();
  }
  close() {
    this._fw.close();
  }
  opened() {
    return this._fw && this._fw.opened();
  }
  refresh() {
    if (!this.opened()) {
      this._needsRefresh = true;
      return;
    }
    this.data = this.options.data ?? APPLICATION_CONTEXT.config.data ?? [];
    this.background = this.options.background ?? APPLICATION_CONTEXT.config.background ?? [];
    const parent = this._listEl.parentNode;
    const newList = this._renderList(this.background);
    parent.replaceChild(newList, this._listEl);
    this._listEl = newList;
    this._needsRefresh = false;
  }
  // ---------- internals ----------
  _isViewable(bg) {
    return bg && typeof bg.dataReference === "number" && this.data?.[bg.dataReference] != null;
  }
  _displayName(bg) {
    const path2 = this.data?.[bg.dataReference] ?? "";
    if (bg?.name) return bg.name;
    try {
      return globalThis.UTILITIES.fileNameFromPath(path2) ?? (path2.split(/[\\/]/).pop() || "(unnamed)");
    } catch {
      return path2.split(/[\\/]/).pop() || "(unnamed)";
    }
  }
  _openWith(bgIndices) {
    APPLICATION_CONTEXT.openViewerWith(
      this.data,
      this.background,
      APPLICATION_CONTEXT.config.visualizations,
      bgIndices,
      void 0,
      { deriveOverlayFromBackgroundGoals: true }
    );
    APPLICATION_CONTEXT.setOption?.("activeBackgroundIndex", Array.isArray(bgIndices) ? bgIndices : [bgIndices]);
  }
  _openCurrentSelection() {
    const chosen = Array.from(this.selected).sort((a4, b2) => a4 - b2);
    this._openWith(chosen);
  }
  _onCardClick(idx) {
    this._suspendUpdates = true;
    this.selected.clear();
    const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
    checks.forEach((ch) => {
      ch.checked = false;
    });
    this.selected.add(idx);
    const box = document.getElementById(`${this.windowId}-chk-${idx}`);
    if (box) box.checked = true;
    this._toggleCardRing(idx, true);
    checks.forEach((ch) => {
      const i3 = Number(ch.getAttribute("data-idx"));
      if (i3 !== idx) this._toggleCardRing(i3, false);
    });
    this._suspendUpdates = false;
    this._openCurrentSelection();
  }
  _onCheck(idx, checked) {
    if (checked) this.selected.add(idx);
    else this.selected.delete(idx);
    this._toggleCardRing(idx, checked);
    if (!this._suspendUpdates) this._openCurrentSelection();
  }
  _toggleCardRing(idx, on) {
    const card = document.getElementById(`${this.windowId}-card-${idx}`);
    if (!card) return;
    card.classList.toggle("ring", !!on);
    card.classList.toggle("ring-primary", !!on);
    card.classList.toggle("ring-offset-1", !!on);
  }
  _clearAll = () => {
    if (!this.selected.size) return;
    this._suspendUpdates = true;
    this.selected.clear();
    const checks = document.querySelectorAll(`#${this.windowId}-list input[type="checkbox"]`);
    checks.forEach((ch) => {
      ch.checked = false;
    });
    const cards = document.querySelectorAll(`#${this.windowId}-list .slide-card`);
    cards.forEach((c2) => c2.classList.remove("ring", "ring-primary", "ring-offset-1"));
    this._suspendUpdates = false;
    this._openCurrentSelection();
  };
  _renderToolbar() {
    const toggleId = `${this.windowId}-stacked`;
    return div18(
      { class: "flex items-center justify-between gap-2 px-2 py-1 border border-base-300 bg-base-100" },
      // left: tiny title
      div18(
        { class: "flex items-center gap-2 text-sm" },
        new FAIcon({ name: "fa-images" }).create(),
        span14({ class: "font-semibold" }, this.title)
      ),
      // right: stacked toggle + clear
      div18(
        { class: "flex items-center gap-2" },
        div18(
          { class: "form-control" },
          label4(
            { for: toggleId, class: "label cursor-pointer gap-2 py-0" },
            span14({ class: "label-text text-xs" }, "Stacked"),
            input4({
              id: toggleId,
              type: "checkbox",
              class: "toggle toggle-xs",
              checked: this.stacked,
              onchange: (e2) => {
                this.stacked = !!e2.target.checked;
                APPLICATION_CONTEXT.setOption?.("stackedBackground", this.stacked);
                this._openCurrentSelection();
              }
            })
          )
        ),
        button2({
          class: "btn btn-ghost btn-xs",
          title: "Clear all selections",
          onclick: this._clearAll
        }, "Clear")
      )
    );
  }
  _renderSlideCard(idx, bg) {
    const viewable = this._isViewable(bg);
    if (!viewable) return null;
    const name = this._displayName(bg);
    const checkboxId = `${this.windowId}-chk-${idx}`;
    const checked = this.selected.has(idx);
    const imageEl = img({
      id: `${this.windowId}-thumb-${idx}`,
      // absolute so the translate is deterministic; rotate into a horizontal row
      class: "block h-auto w-full rotate-90 select-none shrink-0 w-full",
      alt: name,
      draggable: "false",
      onerror: (e2) => {
        e2.target.classList.add("opacity-30");
        e2.target.removeAttribute("src");
      }
    });
    const thumbWrap = div18(
      { class: "relative h-20 overflow-hidden" },
      div18({ class: "absolute left-1 top-1 z-10  px-2 py-1 text-xs font-medium truncate" }, name),
      imageEl
    );
    const imagePath = this.data[bg.dataReference];
    const eventArgs = {
      server: APPLICATION_CONTEXT.env.client.image_group_server,
      usesCustomProtocol: !!bg.protocolPreview,
      image: imagePath,
      imagePreview: null
    };
    VIEWER.tools.raiseAwaitEvent(VIEWER, "get-preview-url", eventArgs).then(() => {
      let blobUrl;
      if (!eventArgs.imagePreview) {
        const previewUrlmaker = new Function("path,data", "return " + (bg.protocolPreview || APPLICATION_CONTEXT.env.client.image_group_preview));
        eventArgs.imagePreview = previewUrlmaker(eventArgs.server, imagePath);
      } else if (typeof eventArgs.imagePreview !== "string") {
        blobUrl = eventArgs.imagePreview = URL.createObjectURL(eventArgs.imagePreview);
      }
      imageEl.src = eventArgs.imagePreview;
    });
    return div18(
      {
        id: `${this.windowId}-card-${idx}`,
        class: "slide-card bg-base-200 border border-base-300 transition " + (checked ? "ring ring-primary ring-offset-1 " : "") + "cursor-pointer flex flex-row",
        onclick: () => this._onCardClick(idx)
      },
      div18({
        class: "relative bg-base-300 w-10",
        style: "width: 80px"
      }, input4({
        id: checkboxId,
        "data-idx": idx,
        type: "checkbox",
        class: "absolute left-1 top-1 z-10 checkbox checkbox-xs",
        checked,
        onclick: (e2) => e2.stopPropagation(),
        onchange: (e2) => this._onCheck(idx, e2.target.checked),
        title: "Add/remove from view"
      })),
      thumbWrap
    );
  }
  _renderList(backgroundList) {
    const items = [];
    for (let i3 = 0; i3 < backgroundList.length; i3++) {
      const card = this._renderSlideCard(i3, backgroundList[i3]);
      if (card) items.push(card);
    }
    return div18({
      id: `${this.windowId}-list`,
      class: "p-1 grid gap-1 overflow-auto flex-1 min-h-0",
      style: "grid-template-columns: repeat(auto-fill, minmax(240px, 90px));"
    }, ...items);
  }
  // BaseComponent contract
  create() {
    return this._fw.create();
  }
};

// ui/services/globalTooltip.mjs
var { div: div19 } = vanjs_default.tags;
var isHtml = (v2) => typeof v2 === "string" && v2.trim().startsWith("<");
var setContent = (host, v2) => {
  host.innerHTML = "";
  if (v2 == null) return;
  if (isHtml(v2)) host.innerHTML = v2;
  else host.append(v2 instanceof Node ? v2 : document.createTextNode(String(v2)));
};
function computePosition(anchorRect, tipRect, placement, gap = 8) {
  let top = 0, left = 0, side = placement;
  const place = (s2) => {
    side = s2;
    if (s2 === "bottom") {
      top = anchorRect.bottom + gap;
      left = anchorRect.left + (anchorRect.width - tipRect.width) / 2;
    } else if (s2 === "top") {
      top = anchorRect.top - tipRect.height - gap;
      left = anchorRect.left + (anchorRect.width - tipRect.width) / 2;
    } else if (s2 === "left") {
      top = anchorRect.top + (anchorRect.height - tipRect.height) / 2;
      left = anchorRect.left - tipRect.width - gap;
    } else {
      top = anchorRect.top + (anchorRect.height - tipRect.height) / 2;
      left = anchorRect.right + gap;
    }
  };
  place(placement);
  const vw = innerWidth, vh = innerHeight, pad = 6;
  const offL = left < pad, offR = left + tipRect.width > vw - pad;
  const offT = top < pad, offB = top + tipRect.height > vh - pad;
  if (side === "bottom" && offB) place("top");
  if (side === "top" && offT) place("bottom");
  if (side === "left" && offL) place("right");
  if (side === "right" && offR) place("left");
  left = Math.min(Math.max(left, pad), vw - tipRect.width - pad);
  top = Math.min(Math.max(top, pad), vh - tipRect.height - pad);
  return { top, left, side };
}
var GlobalTooltip = class {
  constructor() {
    this.surface = null;
    this.arrow = null;
    this.host = null;
    this.current = null;
    this.bound = /* @__PURE__ */ new WeakMap();
    this._open = false;
    this._outside = (e2) => {
      if (!this._open) return;
      const el = this.surface;
      const a4 = this.current?.el;
      if (el?.contains(e2.target) || a4?.contains(e2.target)) return;
      this.hide();
    };
    this._onEsc = (e2) => {
      if (e2.key === "Escape") this.hide();
    };
    this._reflow = () => this._open && this.reposition();
  }
  _ensureSurface() {
    if (this.surface) return;
    this.surface = div19(
      {
        id: "global-tooltip",
        class: "fixed z-[9999] max-w-xs rounded-box bg-base-200 text-base-content shadow p-2 text-sm opacity-0 scale-95 transition transform origin-center pointer-events-auto",
        style: "top:0;left:0;display:none;"
      },
      // arrow
      this.arrow = div19({ class: "absolute w-2 h-2 bg-base-200 rotate-45" }),
      // content host
      this.host = div19({ id: "global-tooltip-content" })
    );
    document.body.appendChild(this.surface);
    document.addEventListener("click", this._outside, { capture: true });
    document.addEventListener("keydown", this._onEsc, { capture: true });
    addEventListener("scroll", this._reflow, true);
    addEventListener("resize", this._reflow);
  }
  _bind(el, opts) {
    if (this.bound.has(el)) return;
    const trigger = opts.trigger || "both";
    const onEnter = () => {
      if (trigger !== "click") this.show(el, opts);
    };
    const onLeave = () => {
      if (trigger === "hover" && !opts.interactive) this.hide();
    };
    const onClick = (e2) => {
      if (trigger === "click" || trigger === "both") {
        if (e2.target.closest?.("[data-tooltip-exempt]")) return;
        this.current?.el === el && this._open ? this.hide() : this.show(el, opts);
        e2.stopPropagation();
      }
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("click", onClick);
    this.bound.set(el, { onEnter, onLeave, onClick });
  }
  _unbind(el) {
    const h2 = this.bound.get(el);
    if (!h2) return;
    el.removeEventListener("mouseenter", h2.onEnter);
    el.removeEventListener("mouseleave", h2.onLeave);
    el.removeEventListener("click", h2.onClick);
    this.bound.delete(el);
  }
  show(el, options = {}) {
    this._ensureSurface();
    const { content, placement = "bottom", offset = 8, interactive = true } = options;
    this.current = { el, options: { placement, offset, interactive } };
    setContent(this.host, content);
    this.surface.style.display = "block";
    this.surface.classList.remove("opacity-0", "scale-95");
    this.surface.classList.add("opacity-100", "scale-100");
    this.reposition();
    this._open = true;
    if (interactive) {
      this.surface.addEventListener("mouseenter", () => {
        this._inside = true;
      });
      this.surface.addEventListener("mouseleave", () => {
        this._inside = false;
        if (!this._hoverAnchor) this.hide();
      });
    }
  }
  hide() {
    if (!this._open) return;
    this.surface.classList.add("opacity-0", "scale-95");
    this.surface.classList.remove("opacity-100", "scale-100");
    setTimeout(() => {
      if (this.surface) this.surface.style.display = "none";
    }, 120);
    this._open = false;
    this._inside = false;
  }
  toggle(el, options) {
    if (this._open && this.current?.el === el) this.hide();
    else this.show(el, options);
  }
  reposition() {
    if (!this.current?.el || !this.surface) return;
    const rect = this.current.el.getBoundingClientRect();
    const tipRect = this.surface.getBoundingClientRect();
    const { placement, offset } = this.current.options;
    const { top, left, side } = computePosition(rect, tipRect, placement, offset);
    Object.assign(this.surface.style, { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });
    this.arrow.style.boxShadow = "0 0 0 1px var(--fallback-bc,oklch(var(--bc)/.2))";
    this.arrow.removeAttribute("style");
    this.arrow.style.position = "absolute";
    this.arrow.style.width = "0.5rem";
    this.arrow.style.height = "0.5rem";
    this.arrow.style.transform = "rotate(45deg)";
    this.arrow.style.background = "var(--b2, var(--fallback-b2, #fff))";
    const tr = this.surface.getBoundingClientRect();
    if (side === "bottom") {
      this.arrow.style.top = "-4px";
      this.arrow.style.left = `${Math.round(tr.width / 2)}px`;
    } else if (side === "top") {
      this.arrow.style.bottom = "-4px";
      this.arrow.style.left = `${Math.round(tr.width / 2)}px`;
    } else if (side === "left") {
      this.arrow.style.right = "-4px";
      this.arrow.style.top = `${Math.round(tr.height / 2)}px`;
    } else {
      this.arrow.style.left = "-4px";
      this.arrow.style.top = `${Math.round(tr.height / 2)}px`;
    }
  }
  bind(el, opts) {
    this._bind(el, opts);
  }
  unbind(el) {
    this._unbind(el);
    if (this.current?.el === el) this.hide();
  }
  update(el, { content } = {}) {
    if (this.current?.el === el && content !== void 0) {
      setContent(this.host, content);
      this.reposition();
    }
  }
};
var globalTooltip_default = GlobalTooltip;

// ui/index.mjs
globalThis.UI = {};
globalThis.VANCOMPONENTS = {};
var UI = {
  BaseComponent,
  Button,
  FAIcon,
  Join,
  Menu,
  Div,
  MainPanel,
  MultiPanelMenuTab,
  MultiPanelMenu,
  FullscreenMenu,
  TabsMenu,
  Dropdown,
  Checkbox,
  Toolbar,
  Select,
  ShaderLayer,
  RawHtml,
  ShaderMenu,
  Alert,
  GlobalTooltip: globalTooltip_default,
  StretchGrid,
  FloatingWindow,
  SlideSwitcherMenu
};
globalThis.UI = UI;
globalThis.vanRegister = function(id, component) {
  globalThis.VANCOMPONENTS[id] = component;
};
globalThis.van = vanjs_default;
//# sourceMappingURL=index.js.map
