/**
 * Generates the plugin/module catalogue from include.json metadata.
 * Mirrors server/node/server-runtime.js#scan() semantics (first-level
 * directories containing include.json) without importing server code.
 *
 * Output (gitignored, rebuilt on every docs build):
 *   docs/generated/plugins/catalogue.md          index table
 *   docs/generated/plugins/catalogue/<dir>.md    one page per plugin
 *   docs/generated/modules/...                   same for modules
 *
 * Run standalone: node scripts/generate-catalogue.mjs (after sync-docs.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'comment-json';
import {
  GENERATED_ROOT,
  GITHUB_BLOB,
  GITHUB_TREE,
  REPO_ROOT,
  buildLinkMap,
  listComponentDirs,
} from './lib/manifest.mjs';
import {
  createRewriter,
  demoteHeadings,
  rewriteLinks,
  tableCell,
  withFrontmatter,
} from './lib/markdown-utils.mjs';

const linkMap = buildLinkMap();

// Known include.json keys; everything else is component-specific configuration.
const KNOWN_KEYS = new Set([
  'id', 'name', 'description', 'author', 'version', 'icon', 'includes',
  'modules', 'requires', 'permaLoad', 'enabled', 'hidden', 'requiredConfig',
  'capabilities', 'io', 'sessionCompatible',
]);

/** @returns {{dir:string, meta:any, readme:string|null}[]} */
function scan(kind) {
  const components = [];
  for (const dir of listComponentDirs(kind)) {
    const includePath = path.join(REPO_ROOT, kind, dir, 'include.json');
    let meta;
    try {
      meta = parse(fs.readFileSync(includePath, 'utf8'));
    } catch (e) {
      console.warn(`[catalogue] cannot parse ${kind}/${dir}/include.json: ${e.message} — skipped`);
      continue;
    }
    if (!meta) {
      console.warn(`[catalogue] ${kind}/${dir}/include.json is empty — skipped`);
      continue;
    }
    // Same fallback chain as server/templates/javascript/plugins.js: missing
    // metadata is taken from package.json, the id ultimately from the dir name.
    const packagePath = path.join(REPO_ROOT, kind, dir, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        meta.id = meta.id || pkg.name;
        meta.name = meta.name || pkg.name;
        meta.author = meta.author || pkg.author;
        meta.version = meta.version || pkg.version;
        meta.description = meta.description || pkg.description;
      } catch {
        /* unreadable package.json — keep include.json data */
      }
    }
    meta.id = meta.id || dir;
    meta.name = meta.name || dir;
    const readmePath = path.join(REPO_ROOT, kind, dir, 'README.md');
    components.push({
      dir,
      meta,
      readme: fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : null,
    });
  }
  return components;
}

const plugins = scan('plugins');
const modules = scan('modules');

// Module id -> {dir, name} for dependency links and reverse dependencies.
const moduleById = new Map(modules.map((m) => [m.meta.id, m]));
const reverseDeps = new Map(); // module id -> [{kind, name, dir}]
function recordDeps(kind, components, field) {
  for (const c of components) {
    for (const dep of c.meta[field] || []) {
      if (!reverseDeps.has(dep)) reverseDeps.set(dep, []);
      reverseDeps.get(dep).push({kind, name: c.meta.name || c.meta.id, dir: c.dir});
    }
  }
}
recordDeps('plugins', plugins, 'modules');
recordDeps('modules', modules, 'requires');

function badges(c) {
  const out = [];
  const b = (cls, text) => out.push(`<span class="badge badge--${cls}">${text}</span>`);
  if (c.meta.permaLoad) b('primary', 'always loaded');
  if (c.meta.hidden) b('secondary', 'hidden');
  if (c.meta.enabled === false) b('warning', 'disabled by default');
  if (/experimental/i.test(c.dir) || /experimental/i.test(c.meta.id)) b('danger', 'experimental');
  return out.join(' ');
}

/** Renders a dependency id as a link to its module page when it exists locally. */
function depLink(id, fromDocPath) {
  const target = moduleById.get(id);
  if (!target) return `\`${id}\``;
  const rel = path.posix.relative(
    path.posix.dirname(fromDocPath),
    `generated/modules/catalogue/${target.dir}.md`
  );
  return `[${target.meta.name || id}](${rel.startsWith('.') ? rel : './' + rel})`;
}

function componentPage(kind, c, position) {
  const docPath = `generated/${kind}/catalogue/${c.dir}.md`;
  const lines = [];

  const badgeRow = badges(c);
  if (badgeRow) lines.push(badgeRow, '');
  if (c.meta.description) lines.push(String(c.meta.description), '');

  lines.push('| | |', '|---|---|');
  lines.push(`| ID | \`${c.meta.id}\` |`);
  if (c.meta.version) lines.push(`| Version | ${tableCell(c.meta.version)} |`);
  if (c.meta.author) lines.push(`| Author | ${tableCell(c.meta.author)} |`);
  lines.push(`| Source | [\`${kind}/${c.dir}\`](${GITHUB_TREE}${kind}/${c.dir}) |`);
  lines.push('');

  const deps = kind === 'plugins' ? c.meta.modules : c.meta.requires;
  if (deps?.length) {
    lines.push('## Dependencies', '');
    for (const dep of deps) lines.push(`- ${depLink(dep, docPath)}`);
    lines.push('');
  }

  const usedBy = reverseDeps.get(c.meta.id);
  if (kind === 'modules' && usedBy?.length) {
    lines.push('## Used by', '');
    for (const u of usedBy) {
      const rel = path.posix.relative(
        path.posix.dirname(docPath),
        `generated/${u.kind}/catalogue/${u.dir}.md`
      );
      lines.push(`- [${u.name}](${rel.startsWith('.') ? rel : './' + rel})`);
    }
    lines.push('');
  }

  if (c.meta.requiredConfig?.length) {
    lines.push('## Required configuration', '');
    for (const k of c.meta.requiredConfig) lines.push(`- \`${typeof k === 'string' ? k : JSON.stringify(k)}\``);
    lines.push('');
  }

  if (c.meta.capabilities?.length) {
    lines.push('## Capabilities', '');
    for (const cap of c.meta.capabilities) {
      if (typeof cap === 'string') lines.push(`- \`${cap}\``);
      else lines.push(`- \`${cap.id || JSON.stringify(cap)}\`${cap.label ? ` — ${cap.label}` : ''}`);
    }
    lines.push('');
  }

  if (c.meta.io?.capabilities?.length) {
    lines.push('## IO capabilities', '');
    for (const cap of c.meta.io.capabilities) {
      lines.push(`- \`${cap.id}\` (${cap.kind || 'unknown'})${cap.label ? ` — ${cap.label}` : ''}`);
    }
    lines.push('');
  }

  const customKeys = Object.keys(c.meta).filter((k) => !KNOWN_KEYS.has(k));
  if (customKeys.length) {
    lines.push(
      '## Additional configuration keys',
      '',
      customKeys.map((k) => `\`${k}\``).join(', '),
      '',
      `See [include.json](${GITHUB_BLOB}${kind}/${c.dir}/include.json) for details and defaults.`,
      ''
    );
  }

  if (c.readme) {
    const rewrite = createRewriter({srcRepoDir: `${kind}/${c.dir}`, destDocPath: docPath, linkMap});
    lines.push('## Documentation', '', demoteHeadings(rewriteLinks(c.readme, rewrite)), '');
  }

  const readmeUrl = c.readme
    ? `${GITHUB_BLOB}${kind}/${c.dir}/README.md`
    : `${GITHUB_BLOB}${kind}/${c.dir}/include.json`;

  return {
    docPath,
    content: withFrontmatter(lines.join('\n'), {
      title: c.meta.name || c.meta.id,
      sidebar_label: c.meta.name || c.meta.id,
      sidebar_position: position,
      custom_edit_url: readmeUrl,
    }),
  };
}

function indexPage(kind, components) {
  const label = kind === 'plugins' ? 'Plugin' : 'Module';
  const lines = [
    `xOpat ships with the following ${kind}. Pages are generated from each component's \`include.json\`; availability in a concrete deployment depends on the server configuration.`,
    '',
    `| ${label} | ID | Version | Description | |`,
    '|---|---|---|---|---|',
  ];
  for (const c of components) {
    lines.push(
      `| [${tableCell(c.meta.name || c.meta.id)}](catalogue/${c.dir}.md) ` +
      `| \`${c.meta.id}\` ` +
      `| ${tableCell(c.meta.version || '—')} ` +
      `| ${tableCell(c.meta.description || '—')} ` +
      `| ${badges(c)} |`
    );
  }
  return withFrontmatter(lines.join('\n') + '\n', {
    title: `${label} Catalogue`,
    sidebar_label: 'Catalogue',
    custom_edit_url: GITHUB_TREE + kind,
    pagination_next: null,
    pagination_prev: null,
  });
}

function writeDoc(docPath, content) {
  const abs = path.join(GENERATED_ROOT, '..', ...docPath.split('/'));
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, content);
}

for (const [kind, components] of [['plugins', plugins], ['modules', modules]]) {
  writeDoc(`generated/${kind}/catalogue.md`, indexPage(kind, components));
  components.forEach((c, i) => {
    const {docPath, content} = componentPage(kind, c, i + 2);
    writeDoc(docPath, content);
  });
  console.log(`[catalogue] ${kind}: ${components.length} pages`);
}
