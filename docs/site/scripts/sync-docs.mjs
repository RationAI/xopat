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

// The JSDoc API reference is copied into static/api/ by CI before the build.
// Locally (and for the broken-link checker) provide a placeholder so the
// navbar /api link always resolves. Never overwrites a real copy.
const apiIndex = path.join(SITE_ROOT, 'static', 'api', 'index.html');
if (!fs.existsSync(apiIndex)) {
  fs.mkdirSync(path.dirname(apiIndex), {recursive: true});
  fs.writeFileSync(
    apiIndex,
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>xOpat API Reference</title></head>' +
    '<body><p>The API reference is generated from JSDoc during the CI build. ' +
    'Run <code>npm run build-docs-api</code> in the repository root and copy <code>docs/build/</code> here, ' +
    'or browse it at <a href="https://xopat.org/api/">xopat.org/api</a>.</p></body></html>'
  );
  console.log('[sync-docs] wrote placeholder static/api/index.html (JSDoc is built in CI)');
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
