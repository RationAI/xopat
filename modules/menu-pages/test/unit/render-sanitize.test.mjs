/**
 * `renderUIFromJson` output is a trust boundary of its own.
 *
 * A page config is data. It arrives from `include.json`, from ENV, or — via the
 * `custom-pages` plugin — from a session bundle, POST_DATA or URL params, which
 * is to say from whoever handed the user a link. Three different consumers then
 * `innerHTML` whatever this renderer returns: `_pageBody` (per-viewer menu tabs),
 * `USER_INTERFACE.addHtml`, and slide-info's technical block, which renders a
 * remote server's `getDisplayMetadata()` and passes no sanitizer at all.
 *
 * So "safe" cannot be a caller's decision to skip, and it cannot be applied to
 * the assembled string either — that string is half author data and half
 * component markup, and sanitizing the whole of it is what stripped the `id`s
 * that slide-info fills after render. It is applied where untrusted content
 * ENTERS, in three places, and these pin all three:
 *
 *   {type:"html"}        sanitized against SANITIZE_DEFAULTS, degrading CLOSED
 *   classes -> class=""  ESCAPED — sanitize-html leaves `"` intact in text, so
 *                        a sanitized string still breaks out of an attribute
 *   {type:"<Anything>"}  resolved against JSON_ELEMENTS — `UI.RawHtml` and
 *                        `UI.StatusBar` innerHTML their own input, which was
 *                        script execution with no {type:"html"} node involved
 *
 * No DOM, no browser: the default branch only needs `createElement` deep enough
 * to round-trip a component to markup.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim, Pages;

/** Calls recorded by the stubs, reset per test. */
let sanitizerCalls, moduleLoads;

/** A component whose markup we can recognise, standing in for the UI system. */
class FakeComponent {
    constructor(options, ...children) {
        this.options = options || {};
        this.children = children;
    }
    get __html() {
        const id = this.options.id ? ` id="${this.options.id}"` : "";
        return `<div${id}>${this.children.join("")}</div>`;
    }
}

/** Enough `document` for the default branch's serialize/re-parse round trip. */
function fakeDocument() {
    return {
        createElement: () => ({
            innerHTML: "",
            childNodes: [],
            appendChild(node) { this.innerHTML = node.__html ?? ""; },
        }),
    };
}

/**
 * Install `SanitizeHtml`. `passthrough` models the real library's treatment of
 * an attribute-shaped payload: it escapes `<`/`>` in text but NOT `"`, which is
 * exactly why escaping is a separate concern from sanitizing.
 */
function installSanitizer(impl) {
    globalThis.SanitizeHtml = (markup, options) => {
        sanitizerCalls.push({ markup, options });
        return impl ? impl(markup, options) : String(markup).replace(/[<>]/g, "");
    };
}

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            XOpatModule: class { registerViewerMenu() {} },
            addModule: () => {},
            APPLICATION_CONTEXT: { secureMode: false },
            UTILITIES: { loadModules: (cb, id) => { moduleLoads.push(id); } },
            USER_INTERFACE: { addHtml: () => {}, AppBar: { Plugins: { setMenu: () => {} } } },
            UI: {
                BaseComponent: {
                    toNode: (instance) => instance,
                    parseDomNodes: (markup) => [markup],
                },
                Div: FakeComponent,
                Title: FakeComponent,
                Collapse: FakeComponent,
                // Present in the namespace, and that is the point: both innerHTML
                // their own input, so neither may be reachable from a page config.
                RawHtml: FakeComponent,
                StatusBar: FakeComponent,
                // Equally present, equally not a page element.
                Modal: FakeComponent,
                LoginModal: FakeComponent,
            },
            document: fakeDocument(),
        },
    });
    Pages = await loadBrowserScript(fromRoot("modules", "menu-pages", "menu.js"), "AdvancedMenuPages");
});

test.afterAll(() => shim?.restore());

test.beforeEach(() => {
    sanitizerCalls = [];
    moduleLoads = [];
    delete globalThis.SanitizeHtml;
});

const builder = () => new Pages("test-owner");

// ── raw {type:"html"} goes through the allowlist ────────────────────────────

test("raw html is sanitized against the module allowlist", { tag: ["@unit"] }, () => {
    installSanitizer();
    builder().renderUIFromJson({ type: "html", html: "<b>hi</b>" });

    expect(sanitizerCalls).toHaveLength(1);
    const { markup, options } = sanitizerCalls[0];
    expect(markup).toBe("<b>hi</b>");
    for (const tag of ["script", "style", "iframe", "object", "embed", "form", "input", "svg"]) {
        expect(options.allowedTags).not.toContain(tag);
    }
    // The two the module widens over `HTML_ALLOWLIST`, and the placeholder hook.
    expect(options.allowedTags).toContain("details");
    expect(options.allowedTags).toContain("summary");
    expect(options.allowedAttributes["*"]).toContain("id");
    // No event handler is allowlisted anywhere, on any tag.
    for (const attrs of Object.values(options.allowedAttributes)) {
        expect(attrs.some(a => /^on/i.test(a))).toBe(false);
    }
    expect(options.allowedSchemes).not.toContain("javascript");
});

test("a caller config is merged OVER the defaults, not used alone", { tag: ["@unit"] }, () => {
    const options = builder()._sanitizeOptions({ allowedTags: ["b"] });
    expect(options.allowedTags).toEqual(["b"]);
    // sanitize-html merges shallowly, so the untouched keys must still be ours.
    expect(options.allowedAttributes["*"]).toContain("id");
    expect(options.allowedSchemes).toContain("https");
});

test("`false` means the module default, never raw pass-through", { tag: ["@unit"] }, () => {
    expect(builder()._sanitizeOptions(false)).toBe(Pages.SANITIZE_DEFAULTS);
    expect(builder()._sanitizeOptions(true)).toBe(Pages.SANITIZE_DEFAULTS);
    expect(builder()._sanitizeOptions(undefined)).toBe(Pages.SANITIZE_DEFAULTS);
});

// ── degrade closed ──────────────────────────────────────────────────────────

test("no sanitizer degrades to escaped text, and asks for the module once", { tag: ["@unit"] }, () => {
    const b = builder();
    const payload = { type: "html", html: '<img src=x onerror="alert(1)">' };

    const first = b.renderUIFromJson(payload);
    expect(first).not.toContain("<img");
    expect(first).toContain("&lt;img");

    b.renderUIFromJson(payload);
    expect(moduleLoads.filter(id => id === "sanitize-html")).toHaveLength(1);
});

test("a throwing sanitizer degrades closed rather than passing markup through", { tag: ["@unit"] }, () => {
    installSanitizer(() => { throw new Error("boom"); });
    const out = builder().renderUIFromJson({ type: "html", html: "<img src=x onerror=1>" });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
});

test("no sanitizer ARGUMENT is still safe - the slide-info call shape", { tag: ["@unit"] }, () => {
    installSanitizer();
    // slide-info renders remote getDisplayMetadata() with exactly one argument.
    builder().renderUIFromJson({ type: "html", html: "<b>remote</b>" });
    expect(sanitizerCalls).toHaveLength(1);
});

// ── attribute breakout ──────────────────────────────────────────────────────

/** The real library escapes text with `escapeHtml(text, false)` — quotes survive. */
const quotePreserving = (markup) => String(markup).replace(/</g, "&lt;");

/**
 * An event handler is only an attribute if a REAL quote opens its value. The
 * escaped text `onmouseover=&quot;` is inert payload sitting inside `class`,
 * which is the whole point — so the assertion looks for the quote, not the name.
 */
const NO_LIVE_HANDLER = /\son\w+\s*=\s*["']/;

test("vega classes cannot break out of the attribute, sanitizer ON", { tag: ["@unit"] }, () => {
    installSanitizer(quotePreserving);
    const out = builder().renderUIFromJson({ type: "vega", classes: '" onmouseover="alert(1)' });

    expect(out).not.toMatch(NO_LIVE_HANDLER);
    expect(out).toContain("&quot;");
    // One attribute, still closed by the quote the renderer opened.
    expect(out.match(/class="/g)).toHaveLength(1);
    expect(out).toMatch(/^<div class="[^"]*" id="vega-[^"]*"><\/div>$/);
});

test("columns classes cannot break out, container and column alike", { tag: ["@unit"] }, () => {
    installSanitizer(quotePreserving);
    const out = builder().renderUIFromJson({
        type: "columns",
        classes: '" onmouseover="alert(1)',
        children: [{ type: "vega", classes: '" onload="alert(2)' }],
    });
    expect(out).not.toMatch(NO_LIVE_HANDLER);
    expect(out).toContain("&quot;");
});

// ── the element allowlist ───────────────────────────────────────────────────

test("components that innerHTML their own input are unreachable from JSON", { tag: ["@unit"] }, () => {
    const b = builder();
    expect(b.renderUIFromJson({ type: "RawHtml", children: ['<img src=x onerror=1>'] })).toBe("");
    expect(b.renderUIFromJson({ type: "StatusBar", initialMessage: '<img src=x onerror=1>' })).toBe("");
    expect(b.resolveUIClass("RawHtml")).toBe(null);
    expect(b.resolveUIClass("StatusBar")).toBe(null);
});

test("application shells are not page elements either", { tag: ["@unit"] }, () => {
    const b = builder();
    expect(b.resolveUIClass("Modal")).toBe(null);
    expect(b.resolveUIClass("LoginModal")).toBe(null);
});

test("presentational elements still resolve, in every name shape", { tag: ["@unit"] }, () => {
    const b = builder();
    expect(b.resolveUIClass("Div")).toBe(FakeComponent);
    expect(b.resolveUIClass("div")).toBe(FakeComponent);
    expect(b.resolveUIClass("header")).toBe(FakeComponent);   // ALIAS -> Title
    expect(b.resolveUIClass("collapse")).toBe(FakeComponent);
});

// ── component markup is never touched ───────────────────────────────────────

test("component markup keeps its id and never reaches the sanitizer", { tag: ["@unit"] }, () => {
    installSanitizer();
    const out = builder().renderUIFromJson({
        type: "div",
        id: "slide-info-label-1",
        children: ["x"],
    });
    // The proxy for the slide-info regression: `id` survives to the DOM.
    expect(out).toContain('id="slide-info-label-1"');
    expect(sanitizerCalls).toHaveLength(0);
});

test("string children are not escaped on their way to the component", { tag: ["@unit"] }, () => {
    installSanitizer();
    const out = builder().renderUIFromJson({ type: "div", children: ["Tumor & stroma"] });
    expect(out).toContain("Tumor & stroma");
    expect(out).not.toContain("&amp;");
});

// ── when the sanitizer is actually needed ───────────────────────────────────

test("needsSanitizer is true only for raw html, at any nesting", { tag: ["@unit"] }, () => {
    expect(Pages.needsSanitizer({ page: [{ type: "columns", children: [{ type: "html" }] }] })).toBe(true);
    expect(Pages.needsSanitizer([{ page: [{ type: "html", html: "" }] }])).toBe(true);
    // The slide-info page shape: placeholders only, so its build stays synchronous.
    expect(Pages.needsSanitizer({
        title: "Slide", page: [{ type: "div", id: "slide-info-label-1" }, { type: "div", id: "tech" }],
    })).toBe(false);
});

// ── the body handed to the menu ─────────────────────────────────────────────

test("an empty page stays falsy so the tab stays transient", { tag: ["@unit"] }, () => {
    expect(builder()._pageBody([])).toBe("");
    expect(builder()._pageBody([""])).toBe("");
});

test("a non-empty page is wrapped once and parsed", { tag: ["@unit"] }, () => {
    expect(builder()._pageBody(["<div>x</div>"]))
        .toEqual(['<div class="w-full"><div>x</div></div>']);
});
