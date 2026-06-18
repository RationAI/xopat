# xOpat Documentation — LLM Guidelines

Scope: everything under `docs/`. Inherits the repo-root [`AGENTS.md`](../AGENTS.md);
this file adds the rules specific to the documentation site and its deployment.

**The live docs site is Docusaurus in [`docs/site/`](site/).** ReadTheDocs/MkDocs
(`docs/readthedocs/`) is **deprecated** — superseded by the Docusaurus site, kept only
until the custom domain is verified live. Do **not** add new content there, wire new
docs into `mkdocs.yml`, or "fix" it. New documentation work targets `docs/site/`.

If you only read one thing: the docs build is designed to **self-heal** — missing
sources, broken links, malformed metadata, and absent config all degrade gracefully
instead of failing. Preserve that property. Every change you make must keep a clean
checkout building green from scratch with **no manual steps**.

---

## 0. Must-not-skip rules

1. **Never hand-edit generated output.** Everything under `docs/site/docs/generated/`
   and `docs/site/static/api/` is regenerated on every build and is **gitignored**.
   Edits there vanish on the next `npm run sync`. Edit the *source of truth* instead
   (see §2). "Edit this page" links on the site already point at the right file.
2. **Don't edit `docs/site/node_modules/`, `docs/site/build/`, lockfiles by hand, or
   any minified/vendored asset.** `docs/site` is self-contained with its own
   `package-lock.json` and is intentionally **outside** the root npm workspaces.
3. **Repo markdown stays CommonMark.** Source docs are MDX-hostile (raw `<`, `{}`,
   unescaped angle brackets). The site runs `markdown.format: 'detect'` so migrated
   `.md` is parsed as CommonMark. Only hand-authored site pages (`docs/index.md`,
   `*.mdx`) may use MDX/JSX. Never introduce MDX syntax into repo-root or component
   markdown. **Admonitions use Docusaurus fences** — `:::note` / `:::tip` /
   `:::info` / `:::warning` / `:::danger`, closed with `:::` (and `<details>` for
   collapsibles). Do **not** use MkDocs `!!!` / `???` syntax; it renders as literal
   text on the site.
4. **No committed domain strings.** Origins come from GitHub repository *variables*
   (`DOCS_URL`, `BASE_URL`, `DEMO_URL`) read at build time. Never hardcode a domain,
   base path, or demo URL into config or content.
5. **Keep the build self-healing (§1).** When you touch the generator scripts, a
   missing/broken/malformed input must degrade gracefully — warn and skip, or fall
   back to a GitHub link — never throw and never emit a broken link.

---

## 1. Self-healing mechanisms — preserve these

The build is engineered so a clean checkout produces a deployable site even when
inputs are missing or wrong. These behaviors are load-bearing; understand them before
changing the scripts in `docs/site/scripts/`.

| Failure mode | Self-healing behavior | Where |
|---|---|---|
| Source markdown in the manifest is missing | `[sync-docs] MISSING source, skipped` warning; build continues | `scripts/sync-docs.mjs` |
| A relative link climbs out of the repo (`../../…`, authored against wrong nesting) | Heuristic repair: drop leading segments until the remainder exists on disk | `lib/markdown-utils.mjs` `createRewriter` |
| A linked repo file/dir genuinely doesn't exist | Rewritten to a GitHub `blob`/`tree` URL — **never a dangling relative link** | `lib/markdown-utils.mjs` |
| `include.json` is unparseable or empty | `[catalogue]` warning; that component is skipped, others still render | `scripts/generate-catalogue.mjs` `scan()` |
| `include.json` missing `id`/`name`/`version`/etc. | Fallback chain: `include.json` → `package.json` → directory name (mirrors the server loader) | `scripts/generate-catalogue.mjs` |
| JSDoc API reference not built locally | Placeholder `static/api/index.html` is written so the `/api` navbar link always resolves | `scripts/sync-docs.mjs` |
| `DOCS_URL` unset | No `CNAME` emitted; deploys to the GitHub Pages default origin | `.github/workflows/docs.yml` |
| `DEMO_URL` unset | Live Demo page shows a friendly notice instead of an empty iframe | `DemoFrame` component |

**Counterbalance — the one thing that is *strict*:** the production build runs with
`onBrokenLinks: 'throw'`. Internal links must resolve. This is why every link rewrite
falls back to an absolute GitHub URL rather than a relative path that might 404. Don't
relax this gate to paper over a real broken reference — fix the link or its rewrite.

---

## 2. Where to edit what

| Site section | Source of truth |
|---|---|
| Introduction, guides, deployment docs | Repo markdown (`README.md`, `docs/web/*.md`, `src/*.md`, `ui/**/README.md`, `plugins/README.md`, `modules/README.md`) — mapped in `scripts/lib/manifest.mjs` |
| Plugin / Module catalogue | Each component's `include.json` (+ optional `README.md`) |
| API reference (`/api/`) | JSDoc, built by `grunt jsdoc` in CI |
| Landing page, Live Demo page | `docs/index.md`, `docs/live-demo.mdx` (committed in `docs/site/docs/`) |
| Summer-school live demos | `docs/site/src/data/summerSchoolDemos.js` — exported config objects rendered by the `DemoFrame` component on `docs/summer-school-demo.mdx`. Plain JSON-serializable objects; `display(...)` Python literals ported to JS (`True`→`true`), data IDs re-homed to the demo server path. |
| Theme / glassmorphism styling | `docs/site/src/css/custom.css` (the only custom CSS; served directly, no rebuild needed) |

**Adding a new repo markdown document requires two registrations** — miss either and
it silently won't appear:

1. Add an entry to `scripts/lib/manifest.mjs` (maps `src` → `dest`, title, label).
2. Add it to `sidebars.js` so it shows in the sidebar.

**Notebook / pip-package deployment docs (`docs/web/jupyter_deployment.md`,
`docs/web/collab_notebook_deployment.md`) describe the `xopat` pip package, whose
source of truth is the *sibling* `xopat-deploy` repo (checked out next to this one)
at `pypi/xopat/` — `run_server`, `display(server, slide, …)` (slide = str path
**or** full session dict), `setup_jupyterhub(host)`, `display_link`, the `Server`
diagnostics. Example notebooks live in `xopat-deploy/notebooks/`. Read that package
for the real API instead of guessing; `setup_colab()` is auto-invoked inside
`run_server()` (no explicit Colab setup), JupyterHub requires an explicit
`setup_jupyterhub` call.**

---

## 3. Build & verify

```bash
cd docs/site
npm install          # first time only
npm start            # dev server; runs sync + catalogue generators first
npm run build        # production build — the broken-link gate runs here
npm run serve        # serve the production build (search only works here)
```

From the repo root: `npm run docs:dev` / `npm run docs:build`.

- `npm run sync` (auto via `prestart`/`prebuild`) = `sync-docs.mjs` then
  `generate-catalogue.mjs`. The dev server does **not** re-sync on source edits —
  re-run `npm run sync` (or restart) after editing source markdown.
- **Search and the API reference only work in a production build** + `serve`; the
  local-search plugin indexes at build time.
- Before claiming a docs change works, run `npm run build` — it's the only step that
  exercises the broken-link gate that CI uses.

---

## 4. Deployment & CI

`.github/workflows/docs.yml` builds the Docusaurus site **and** the JSDoc API
reference (served under `/api/`) and deploys both as the single GitHub Pages site.

> **TEMPORARY (API hidden):** the JSDoc API reference is incomplete, so the CI
> JSDoc build/copy step is commented out and `sync-docs.mjs` writes a "coming
> soon" placeholder at `static/api/index.html`. The navbar "API" link still points
> at `/api/` (now the placeholder). To restore: un-comment the CI step in
> `docs.yml` and drop the coming-soon block in `sync-docs.mjs`.

- Deploys on push to `master` and on manual `workflow_dispatch`. Pull requests run
  **build-only** (validate, no deploy).
- JSDoc is built with `npx grunt jsdoc --force` — jsdoc exits non-zero on pre-existing
  doc-comment type errors but still emits output, so `--force` is required. CI copies
  `docs/build/` into `docs/site/static/api/` before the Docusaurus build.
- Domain config is repository **variables** (Settings → Secrets and variables →
  Actions → Variables), never committed:
  - `DOCS_URL` — docs origin; also drives the generated `CNAME`. Unset = no custom domain.
  - `BASE_URL` — `/` for a custom domain, `/xopat/` when serving from `rationai.github.io/xopat`.
  - `DEMO_URL` — Live Demo iframe origin. Unset = the page shows a notice.

Full DNS/runbook: [`docs/site/README.md`](site/README.md).

### Docusaurus gotchas that break the build

- **Links to the static `/api/` reference must use the `pathname://` protocol**
  (e.g. `pathname:///api/`). A normal link trips the broken-link checker because
  `/api` isn't a Docusaurus route.
- **`_`-prefixed docs directories are treated as partials and excluded.** That's why
  generated content lives in `generated/`, not `_generated/`.
- The catalogue **index** lives at `generated/<kind>/catalogue.md` — deliberately
  *outside* the autogenerated `generated/<kind>/catalogue/` directory — to avoid a
  duplicate sidebar entry.
- **`backdrop-filter` on `.navbar` breaks the mobile menu.** The mobile drawer
  (`.navbar-sidebar`) is `position: fixed` but a *child* of `.navbar`; any
  `backdrop-filter`/`filter`/`transform` on `.navbar` makes it the containing block
  for that fixed child, trapping the drawer inside the 60px bar so it can't cover
  the viewport (and a translucent fill lets the page bleed through). `custom.css`
  therefore drops the blur while the drawer is open (`.navbar.navbar-sidebar--show`)
  and keeps `.navbar-sidebar` opaque. Same rule applies to any glass surface that
  hosts a `position: fixed` descendant.

### Previewing visually (mobile widths, embedded demos)

To verify layout/CSS without eyeballing, serve the build (`npm run serve`, or
`npx docusaurus start` to skip the slow sync) and screenshot via the cached
Playwright Chromium (`~/AppData/Local/ms-playwright/chromium-*/`) driven over CDP
with a mobile device-metrics override. Use a throwaway script and delete it after;
do not commit screenshot tooling.

### `.gitignore` interactions

The generated trees are gitignored. The repo's root `.*` catch-all needs explicit
re-includes (`!/.github/`, `!/docs/site/static/.nojekyll`) for CI files to survive.
If you add new build inputs, confirm they aren't swallowed by a broad ignore rule —
test with a fresh `git clone` mindset (`git status --ignored`).
