/**
 * Generates the demo-data catalogue from the test fixtures.
 *
 * Two tracked files are the source, and this script only renders them:
 *   test/fixtures/data/manifest.json      the slides: provenance, licence, size
 *   test/fixtures/sessions/index.json     the sessions: deployment, requirements
 *
 * Output (gitignored, rebuilt on every docs build):
 *   docs/generated/showcases/demo-data.md
 *
 * It exists because the previous arrangement was a hand-written table next to a
 * `download.sh` that had rotted into three commented-out lines and a `#TODO`.
 * A page derived from the same records the fetcher reads cannot drift from what
 * is actually downloadable.
 *
 * Run standalone: node scripts/generate-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'comment-json';
import {GENERATED_ROOT, GITHUB_BLOB, REPO_ROOT} from './lib/manifest.mjs';
import {tableCell, withFrontmatter} from './lib/markdown-utils.mjs';

const MANIFEST_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'data', 'manifest.json');
const SESSION_INDEX_PATH = path.join(REPO_ROOT, 'test', 'fixtures', 'sessions', 'index.json');
const DEST = path.join(GENERATED_ROOT, 'showcases', 'demo-data.md');

const readJsonc = (file) => parse(fs.readFileSync(file, 'utf8'), null, true);

const mib = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(0)} MiB` : '—');

/** `sessions/<id>.json` on GitHub — the file a reader will actually want. */
const sessionLink = (id) => `[\`${id}\`](${GITHUB_BLOB}test/fixtures/sessions/${id}.json)`;

const REQUIREMENT_LABEL = {
  fixtures: '`fixtures:fetch`',
  derived: '`fixtures:derive`',
};

const requirementCell = (requires) => {
  if (!requires || !requires.length) return 'nothing';
  return requires.map((r) => REQUIREMENT_LABEL[r] || `env \`${r}\``).join(', ');
};

function slideTable(items) {
  const rows = Object.entries(items).map(([name, item]) => {
    // `usedBy` names both session ids and `derive:<artifact>` pseudo-consumers;
    // only the former have a file to link to.
    const used = (item.usedBy || [])
      .map((u) => (u.startsWith('derive:') ? `\`${u}\`` : sessionLink(u)))
      .join(', ');
    return `| \`${name}\` | ${tableCell(item.title || '')} | ${mib(item.bytes)} | ${tableCell(item.license || '_not stated_')} | ${tableCell(item.provenance || '')} | ${used || '—'} |`;
  });
  return [
    '| File | What it is | Size | Licence | Provenance | Used by |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function sessionTables(sessions) {
  const byGroup = new Map();
  for (const [id, meta] of Object.entries(sessions)) {
    if (!byGroup.has(meta.group)) byGroup.set(meta.group, []);
    byGroup.get(meta.group).push([id, meta]);
  }

  const out = [];
  for (const [group, entries] of byGroup) {
    out.push(`### ${group}\n`);
    out.push('| Session | Demonstrates | Deployment | Needs first |');
    out.push('| --- | --- | --- | --- |');
    for (const [id, meta] of entries) {
      out.push(`| ${sessionLink(id)} | ${tableCell(meta.demonstrates || meta.title || '')} | \`npm run up:dev -- ${meta.deployment}\` | ${requirementCell(meta.requires)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

function build() {
  const manifest = readJsonc(MANIFEST_PATH);
  const sessions = readJsonc(SESSION_INDEX_PATH).sessions;

  const unpublished = Object.entries(manifest.items).filter(([, i]) => !i.sha256);

  const body = `# Demo data

Every slide and session the showcases use is described here, and this page is
generated from the two files that actually drive them —
[\`test/fixtures/data/manifest.json\`](${GITHUB_BLOB}test/fixtures/data/manifest.json)
and [\`test/fixtures/sessions/index.json\`](${GITHUB_BLOB}test/fixtures/sessions/index.json).
Nothing here is maintained by hand, so it cannot describe a file that is not
fetchable.

## Getting it

\`\`\`bash
npm run fixtures:fetch            # download + verify every slide below
npm run fixtures:fetch -- --list  # what is present, what is missing
npm run fixtures:derive           # build the derived overlays
npm run fixtures:serve            # serve it on :9100, with byte ranges
\`\`\`

Each slide carries a SHA-256. A mismatch deletes the download and fails rather
than warning: a truncated TIFF opens far enough to render a plausible-looking
wrong demo. Set \`XOPAT_FIXTURE_BASE\` to fetch from a mirror.

There is also a slide that needs **no** download at all — \`npm run fixtures:synthetic\`
generates a DeepZoom pyramid from tracked code, which is what makes
\`npm run up:dev -- synthetic\` the one deployment with zero external dependencies.
${unpublished.length ? `
:::caution Not published yet

${unpublished.map(([n]) => `\`${n}\``).join(', ')} — the fetcher refuses these by
name rather than downloading bytes it cannot verify.
:::
` : ''}
## Slides

${slideTable(manifest.items)}

## Sessions

Each session is a plain JSON file that opens in the viewer's URL hash. Print an
openable link for one with \`npm run fixtures:urls\`, or paste the JSON into
\`/dev_setup\`.

${sessionTables(sessions)}`;

  fs.mkdirSync(path.dirname(DEST), {recursive: true});
  fs.writeFileSync(DEST, withFrontmatter(body, {
    title: 'Demo Data',
    sidebar_label: 'Demo Data',
    description: 'The slides and sessions behind the showcases, and how to fetch them.',
  }), 'utf8');
  console.log(`[fixtures] wrote ${path.relative(REPO_ROOT, DEST)}`);
}

build();
