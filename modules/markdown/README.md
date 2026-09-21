# Markdown module

Renders markdown safely, and turns `#xopat-<kind>?<query>` links into actions any
subsystem can register. One module owns both, because both used to be copy-pasted:
chat and the recorder each carried their own "find a parser, sanitize, degrade
closed, lazily load the sanitizer", and the region-link convention was private to a
single chat UI class — so the same assistant-authored text rendered as a working
link in chat and as dead text in a questionnaire.

`marked` is a bundled dependency of this module (`package.json`), not a separately
published npm-module global: consumers declare **one** dependency and never reach
for a parser themselves.

```json
// include.json of a consumer
"requires": ["markdown"]     // modules
"modules":  ["markdown"]     // plugins
```

## Rendering

```js
const markdown = singletonModule("markdown");

markdown.renderInto(hostElement, text);                      // block markdown
markdown.renderInto(hostElement, text, { inline: true });    // labels, titles
markdown.renderToHtml(text);                                 // string, or null
```

Give the host the `xo-md` class plus `xo-md-body` (block) or `xo-md-inline`
(inline) to pick up the shared typography. Options:

| option | meaning |
|---|---|
| `inline` | `marked.parseInline` — no block tags, for a label or a table cell |
| `sanitize` | `sanitize-html` config, merged over the module default |
| `transformText` | presentation transform applied to **text nodes only** |
| `links` | recognise `#xopat-…` links (default `true`) |

`transformText` never sees an attribute. That is deliberate: chat restores friendly
slide names from anonymization handles, and the handle inside a link target must
survive. Transforming the markdown *source* is what forces the caller to hand-roll
an extraction pass first (chat used to); transforming the parsed text nodes cannot
reach a href at all.

There is also a component, for call sites that compose UI rather than manage nodes:

```js
new MarkdownView(page.description).attachTo(container);   // setText() re-renders in place
```

### Degrading closed

Model output is untrusted, so the sanitizer is not optional. When `SanitizeHtml`
is not loaded, every entry point returns `null` / renders `textContent` — never raw
HTML (AGENTS.md §0 rule 2, §7) — requests a one-shot load of the `sanitize-html`
module, and upgrades hosts it degraded once the module arrives.

### Performance

Callers re-render a lot (the questionnaire rebuilds its whole preview on every
answer change), so the pipeline is built to be re-entered cheaply:

- **A pre-test runs before anything else.** Text with no markdown characters takes
  a plain `textContent` path — no parse, no sanitize, no cache entry, and no lazy
  module load. Most prose is this case.
- **Results are cached by content** (bounded LRU, ~300 entries, keyed by the text
  and the sanitize-config identity). A re-render of an unchanged description costs
  one `innerHTML` assignment.
- **One delegated click listener per host**, not one closure per anchor, so cached
  HTML re-mounts without a DOM walk.

## Links

```js
markdown.links.register("region", {
    parse(params) { … },      // URLSearchParams -> payload, or null when malformed
    activate(payload) { … },  // return false when the action could not be carried out
    titleKey: "links.goToRegion",
});
markdown.openLink("#xopat-region?x=100&y=200&w=50&h=50");
```

A malformed or unregistered link is **not** an error: it renders as the ordinary
link `marked` produced. A dead action is worse than a plain link.

The scheme is a bare fragment on purpose — it carries no URL scheme, so the
sanitizer passes it through (it only vets `allowedSchemes` on hrefs that have one),
and a browser that follows it navigates nowhere.

### The built-in `region` kind

```
[label](#xopat-region?viewer=<uniqueId|handle>&x=<x>&y=<y>&w=<w>&h=<h>&z=<planeIndex>)
```

Coordinates are level-0 image pixels, parent-global for virtual-region splits — the
same space as annotation coordinates, pathology `bounds` and
`viewer.frameImageRegion(...)`, whose fit/pad semantics it mirrors. `x,y` is the
top-left corner; `w=0&h=0` pans to a point without changing zoom; `z` pins a
0-based focal plane on z-stack slides (ignored elsewhere).

`viewer` is resolved as: real `uniqueId` → registered resolvers → active viewer →
the sole open viewer. Register a resolver when your subsystem hands the model
aliases instead of real ids:

```js
markdown.registerViewerResolver((reference) => myHandleMap.get(reference) || null);
```

The chat module does exactly that for its per-session anonymization handles
(`viewer-1`), which is why a link the model wrote in a chat reply also works when
the same text is stored in a questionnaire description.

## Consumers

| who | what it renders |
|---|---|
| `plugins/questionaire-new` | form/page/element descriptions, `content` blocks, labels and titles (inline) |
| `modules/vercel-ai-chat-sdk` | assistant message text (passes its own allowlist, which additionally permits `data:` images) |
| `plugins/recorder` | overlay narration (passes its own, narrower allowlist) |

Plain text stays plain text on purpose in a few places: `<option>` labels cannot
hold markup at all, and tab labels, tooltips and validation messages are text nodes
by contract.
