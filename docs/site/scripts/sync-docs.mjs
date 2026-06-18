/**
 * Copies repository markdown (README/specs/guides) into the Docusaurus docs
 * tree (docs/site/docs/generated/) with frontmatter injection and link
 * rewriting. Content is migrated AS-IS — no rewrites.
 *
 * Run standalone: node scripts/sync-docs.mjs
 * Runs automatically via npm prestart/prebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_ROOT,
  GITHUB_BLOB,
  MANIFEST,
  REPO_ROOT,
  buildLinkMap,
} from './lib/manifest.mjs';
import {createRewriter, rewriteLinks, withFrontmatter} from './lib/markdown-utils.mjs';
import {SITE_ROOT} from './lib/manifest.mjs';

const linkMap = buildLinkMap();

// TEMPORARY: the JSDoc API reference is incomplete, so it is not published.
// The CI JSDoc build/copy step is disabled (see .github/workflows/docs.yml) and
// the navbar "API" link lands here on a "coming soon" page instead. To restore
// the real reference: re-enable the CI step and remove this notice. The
// `!exists` guard still lets a local `grunt jsdoc` copy override this page.
const apiIndex = path.join(SITE_ROOT, 'static', 'api', 'index.html');
if (!fs.existsSync(apiIndex)) {
  fs.mkdirSync(path.dirname(apiIndex), {recursive: true});
  fs.writeFileSync(
    apiIndex,
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>xOpat API Reference — Coming Soon</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:linear-gradient(135deg,#15191c,#1b2226);color:#e6edf1;text-align:center;padding:2rem}
  .card{max-width:34rem}
  h1{font-size:1.6rem;margin:0 0 .75rem}
  p{line-height:1.6;color:#aeb9c0;margin:.4rem 0}
  .badge{display:inline-block;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;
    color:#90a4ae;border:1px solid #37474f;border-radius:999px;padding:.25rem .75rem;margin-bottom:1rem}
  a{color:#ff8a65;text-decoration:none}a:hover{text-decoration:underline}
</style></head>
<body><div class="card">
  <div class="badge">Coming soon</div>
  <h1>API Reference is being rebuilt</h1>
  <p>The generated JSDoc API reference is temporarily unavailable while it is
     brought up to date for xOpat v3.</p>
  <p>In the meantime, see the <a href="../">documentation</a> or the
     <a href="https://github.com/RationAI/xopat">source on GitHub</a>.</p>
</div></body></html>`
  );
  console.log('[sync-docs] wrote "coming soon" placeholder static/api/index.html (API reference temporarily hidden)');
}

// Fresh output: generate-catalogue.mjs runs after this and appends to the tree.
fs.rmSync(GENERATED_ROOT, {recursive: true, force: true});
fs.mkdirSync(GENERATED_ROOT, {recursive: true});

let synced = 0;
for (const entry of MANIFEST) {
  const absSrc = path.join(REPO_ROOT, ...entry.src.split('/'));
  if (!fs.existsSync(absSrc)) {
    console.warn(`[sync-docs] MISSING source, skipped: ${entry.src}`);
    continue;
  }

  let content = fs.readFileSync(absSrc, 'utf8');
  if (content.startsWith('---\n')) {
    console.warn(`[sync-docs] ${entry.src} already has frontmatter — kept as-is`);
  }

  const rewrite = createRewriter({
    srcRepoDir: path.posix.dirname(entry.src),
    destDocPath: entry.dest,
    linkMap,
  });
  content = rewriteLinks(content, rewrite);
  content = withFrontmatter(content, {
    title: entry.title,
    sidebar_label: entry.label || entry.title,
    custom_edit_url: GITHUB_BLOB + entry.src,
  });

  const absDest = path.join(GENERATED_ROOT, '..', ...entry.dest.split('/'));
  fs.mkdirSync(path.dirname(absDest), {recursive: true});
  fs.writeFileSync(absDest, content);
  synced++;
}

console.log(`[sync-docs] synced ${synced}/${MANIFEST.length} documents -> ${GENERATED_ROOT}`);
