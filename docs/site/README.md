# xOpat Documentation Site

Docusaurus app serving the xOpat documentation, the plugin/module catalogue,
and the JSDoc API reference (under `/api/`). Deployed to GitHub Pages by
`.github/workflows/docs.yml` on every push to `master`.

This package is **self-contained** — it is intentionally *not* part of the
root npm workspaces and has its own lockfile.

## Local development

```bash
cd docs/site
npm install
npm start          # dev server; runs the sync + catalogue generators first
npm run build      # production build (broken-link gate: onBrokenLinks=throw)
npm run serve      # serve the production build (search only works here)
```

Or from the repository root: `npm run docs:dev` / `npm run docs:build`.

Notes:

- **Search only works in a production build** (`npm run build` + `npm run serve`);
  the local-search plugin indexes at build time.
- The dev server picks up regenerated content on restart; re-run
  `npm run sync` manually after editing source markdown.
- To preview the API reference locally, run `npm run build-docs-api` in the
  repository root and copy `docs/build/` into `docs/site/static/api/`.
  Otherwise a placeholder page is generated automatically.

## Content model — where to edit what

Everything under `docs/generated/` and `static/api/` is **generated and
gitignored — never edit it**. "Edit this page" links on the site already point
at the right source files.

| Site section | Source of truth |
|---|---|
| Introduction, guides, deployment docs | Repo markdown (`README.md`, `docs/web/*.md`, `src/*.md`, `ui/**/README.md`, `plugins/README.md`, `modules/README.md`) — mapped in `scripts/lib/manifest.mjs` |
| Plugin / Module catalogue | Each component's `include.json` (+ optional `README.md`), rendered by `scripts/generate-catalogue.mjs` |
| API reference (`/api/`) | JSDoc, built by `grunt jsdoc` in CI |
| Landing page, Live Demo page | `docs/index.md`, `docs/live-demo.mdx` (committed here) |

When you add a new repo markdown document, register it in
`scripts/lib/manifest.mjs` **and** in `sidebars.js`.

## Domain & deployment configuration (runbook)

No domain string is committed anywhere. Configure **GitHub repository
variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Value | Notes |
|---|---|---|
| `DOCS_URL` | `https://your-domain.tld` | The docs site origin. Also drives the generated `CNAME` file. Leave unset to deploy without a custom domain. |
| `BASE_URL` | `/` | Set to `/xopat/` only when serving from `rationai.github.io/xopat` (no custom domain). |
| `DEMO_URL` | `https://demo.your-domain.tld` | Live viewer origin embedded on the Live Demo page. Leave unset until the demo deployment exists — the page shows a friendly notice. |

### GitHub Pages settings (once)

1. Repo **Settings → Pages**: Source = **GitHub Actions**.
2. After the first successful deploy, enter the custom domain
   (same as `DOCS_URL`, without scheme) and enable **Enforce HTTPS**
   once the certificate is issued.
3. For an organization apex domain, consider
   [verifying the domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
   to prevent takeovers.

### DNS records (at your domain registrar)

Apex domain (e.g. `your-domain.tld`):

```
A     @    185.199.108.153
A     @    185.199.109.153
A     @    185.199.110.153
A     @    185.199.111.153
AAAA  @    2606:50c0:8000::153
AAAA  @    2606:50c0:8001::153
AAAA  @    2606:50c0:8002::153
AAAA  @    2606:50c0:8003::153
CNAME www  rationai.github.io
```

(Or a single `ALIAS`/`ANAME @ → rationai.github.io` if your DNS provider
supports it.) GitHub redirects `www` ↔ apex automatically. After the domain
is active, `https://rationai.github.io/xopat/*` redirects to it.

`demo.your-domain.tld` DNS is independent — point it at the future demo
server; nothing in this repo needs to change besides setting `DEMO_URL`.

### Activating the live demo later

1. Deploy the xOpat viewer + image server somewhere reachable.
2. Set the `DEMO_URL` repository variable.
3. Re-run the **Build and deploy documentation site** workflow.

## Legacy documentation

- ReadTheDocs (MkDocs, `docs/readthedocs/`) is superseded by this site and
  kept only until the new domain is verified live; see the deprecation note
  in `docs/readthedocs/mkdocs.yml`.
- The old standalone API-docs workflow (`api_docs.yml`) was replaced by
  `docs.yml`, which serves JSDoc output under `/api/` of this site.
