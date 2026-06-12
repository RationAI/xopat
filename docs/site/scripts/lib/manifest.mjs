/**
 * Source-of-truth map between repository markdown files and the generated
 * Docusaurus docs tree (docs/site/docs/generated/...).
 *
 * Keep `dest` values in sync with docs/site/sidebars.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
/** Absolute path of the Docusaurus app (docs/site). */
export const SITE_ROOT = path.resolve(HERE, '..', '..');
/** Absolute path of the generated docs tree. */
export const GENERATED_ROOT = path.join(SITE_ROOT, 'docs', 'generated');

export const GITHUB_BLOB = 'https://github.com/RationAI/xopat/blob/master/';
export const GITHUB_TREE = 'https://github.com/RationAI/xopat/tree/master/';

/**
 * Migrated documents. `src` is repo-relative (POSIX), `dest` is relative to
 * docs/site/docs/ (POSIX, must start with `generated/`).
 */
export const MANIFEST = [
  {src: 'README.md', dest: 'generated/intro/about.md', title: 'About xOpat', label: 'About'},
  {src: 'CHANGELOG.md', dest: 'generated/intro/changelog.md', title: 'Changelog'},

  {src: 'docs/web/quick_start.md', dest: 'generated/getting-started/quick-start.md', title: 'Quick Start'},
  {src: 'docs/web/glossary.md', dest: 'generated/getting-started/glossary.md', title: 'Glossary'},

  {src: 'docs/web/showcases.md', dest: 'generated/showcases/overview.md', title: 'Showcases', label: 'Overview'},

  {src: 'docs/web/deployment.md', dest: 'generated/deployment/overview.md', title: 'Deployment Overview', label: 'Overview'},
  {src: 'docs/web/image_server_deployment.md', dest: 'generated/deployment/image-server.md', title: 'Image Server Deployment'},
  {src: 'docs/web/xopat_deployment.md', dest: 'generated/deployment/xopat-deployment.md', title: 'xOpat Deployment'},
  {src: 'docs/web/jupyter_deployment.md', dest: 'generated/deployment/jupyter.md', title: 'Jupyter Integration'},
  {src: 'docs/web/collab_notebook_deployment.md', dest: 'generated/deployment/collab-notebook.md', title: 'Collaboratory Notebook Integration', label: 'Collaboratory Notebook'},
  {src: 'docs/web/generic_deployment.md', dest: 'generated/deployment/generic.md', title: 'Generic Deployment'},
  {src: 'INTEGRATION.md', dest: 'generated/deployment/integration.md', title: 'Administration & Integration', label: 'Administration & Integration'},

  {src: 'docs/web/xopat_configuration.md', dest: 'generated/configuration/viewer-configuration.md', title: 'Viewer Configuration'},
  // Live Sessions (src/SESSION.md) — live-collaboration is not yet developed/shipped; hidden until ready.
  // {src: 'src/SESSION.md', dest: 'generated/configuration/session.md', title: 'Live Sessions'},

  {src: 'DEVELOPMENT.md', dest: 'generated/developer-guides/development-setup.md', title: 'Development Setup'},
  {src: 'docs/web/development.md', dest: 'generated/developer-guides/development-tasks.md', title: 'Development Tasks'},
  {src: 'src/README.md', dest: 'generated/developer-guides/core-architecture.md', title: 'Core Architecture'},
  {src: 'src/EVENTS.md', dest: 'generated/developer-guides/events.md', title: 'Events'},
  {src: 'src/HISTORY.md', dest: 'generated/developer-guides/history.md', title: 'History (Undo/Redo)'},
  {src: 'src/IO_PIPELINE.md', dest: 'generated/developer-guides/io-pipeline.md', title: 'IO Pipeline'},
  {src: 'src/STORAGE.md', dest: 'generated/developer-guides/storage.md', title: 'Storage'},
  {src: 'src/HTTP_CLIENT.md', dest: 'generated/developer-guides/http-client.md', title: 'HTTP Client'},
  {src: 'src/MULTI_VIEWPORTS.md', dest: 'generated/developer-guides/multi-viewports.md', title: 'Multi-Viewports'},
  {src: 'src/SCRIPTING.md', dest: 'generated/developer-guides/scripting.md', title: 'Scripting'},
  {src: 'src/TUTORIALS.md', dest: 'generated/developer-guides/tutorials.md', title: 'Tutorials API'},
  {src: 'src/USER_ROLES.md', dest: 'generated/developer-guides/user-roles.md', title: 'Users, Roles & Capabilities'},
  {src: 'src/AUTHORIZATION_AND_PROXY_AND_USERS.md', dest: 'generated/developer-guides/auth-proxy-users.md', title: 'Authorization, Proxy & Users'},
  {src: 'src/NPM_MODULES_PLUGINS.md', dest: 'generated/developer-guides/npm-modules-plugins.md', title: 'NPM Modules & Plugins'},

  {src: 'ui/README.md', dest: 'generated/ui/overview.md', title: 'UI System Overview'},
  {src: 'ui/classes/README.md', dest: 'generated/ui/classes.md', title: 'UI Classes (BaseComponent)'},
  {src: 'ui/services/README.md', dest: 'generated/ui/services.md', title: 'UI Services'},

  {src: 'plugins/README.md', dest: 'generated/plugins/writing-plugins.md', title: 'Writing Plugins'},
  {src: 'modules/README.md', dest: 'generated/modules/writing-modules.md', title: 'Writing Modules'},
];

/**
 * Lists first-level component directories of plugins/ or modules/ that
 * contain an include.json (mirrors server/node/server-runtime.js#scan()).
 * @param {'plugins'|'modules'} kind
 * @returns {string[]} directory names
 */
export function listComponentDirs(kind) {
  const root = path.join(REPO_ROOT, kind);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, {withFileTypes: true})
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'include.json')))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Map of repo-relative POSIX source path -> docs-relative POSIX target path,
 * covering both the migration manifest and the generated catalogue pages
 * (component READMEs resolve to their catalogue page).
 * @returns {Map<string, string>}
 */
export function buildLinkMap() {
  const map = new Map();
  for (const entry of MANIFEST) map.set(entry.src, entry.dest);
  for (const kind of ['plugins', 'modules']) {
    for (const dir of listComponentDirs(kind)) {
      const page = `generated/${kind}/catalogue/${dir}.md`;
      map.set(`${kind}/${dir}/README.md`, page);
      map.set(`${kind}/${dir}/include.json`, page);
    }
  }
  return map;
}
