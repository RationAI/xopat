/**
 * Markdown transformation helpers shared by sync-docs.mjs and
 * generate-catalogue.mjs. Pure line-based processing — robust against the
 * MDX-hostile content in repo markdown (everything stays CommonMark).
 */
import fs from 'node:fs';
import path from 'node:path';
import {GENERATED_ROOT, GITHUB_BLOB, GITHUB_TREE, REPO_ROOT} from './manifest.mjs';

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i; // http:, https:, mailto:, data:, protocol-relative
// [text](target) and ![alt](target), optional "title"; target without spaces/parens
const INLINE_LINK = /(!?\[[^\]]*\])\(([^()\s]+)((?:\s+"[^"]*")?)\)/g;
// [ref]: target reference definitions
const REF_DEF = /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/;

/**
 * Applies `fn(line)` to every line that is outside fenced code blocks.
 */
function mapOutsideFences(content, fn) {
  let fence = null;
  return content
    .split('\n')
    .map((line) => {
      const open = line.match(/^\s*(```+|~~~+)/);
      if (open) {
        const marker = open[1][0].repeat(3);
        if (!fence) fence = marker;
        else if (open[1].startsWith(fence)) fence = null;
        return line;
      }
      return fence ? line : fn(line);
    })
    .join('\n');
}

/**
 * Rewrites all markdown link/image targets outside code fences.
 * @param {string} content
 * @param {(target: string, isImage: boolean) => string} rewrite
 */
export function rewriteLinks(content, rewrite) {
  return mapOutsideFences(content, (line) => {
    line = line.replace(INLINE_LINK, (m, label, target, title) => {
      const isImage = label.startsWith('!');
      return `${label}(${rewrite(target, isImage)}${title})`;
    });
    const ref = line.match(REF_DEF);
    if (ref) line = `${ref[1]}${rewrite(ref[2], false)}${ref[3]}`;
    return line;
  });
}

/**
 * Demotes ATX headings by one level (outside code fences), capped at h6.
 * Used when inlining component READMEs so the page keeps a single h1.
 */
export function demoteHeadings(content) {
  return mapOutsideFences(content, (line) =>
    /^#{1,6}\s/.test(line) ? (line.startsWith('######') ? line : '#' + line) : line
  );
}

/**
 * Prepends YAML frontmatter. Sources are expected to have none; if one is
 * present already it is kept untouched (warned by the caller).
 */
export function withFrontmatter(content, fields) {
  if (content.startsWith('---\n')) return content;
  const yaml = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  return `---\n${yaml}\n---\n\n${content}`;
}

/**
 * Creates a link-target rewriter for a document migrated/generated from
 * `srcRepoDir` (repo-relative POSIX dir of the source file) into the docs
 * tree at `destDocPath` (docs-relative POSIX path, e.g.
 * `generated/developer-guides/io-pipeline.md`).
 *
 * - known repo .md files -> relative link to their migrated/generated page
 * - images -> copied under generated/assets/ and linked relatively
 * - anything else relative -> GitHub blob/tree URL (never a broken link)
 *
 * @param {{srcRepoDir: string, destDocPath: string, linkMap: Map<string,string>}} opts
 */
export function createRewriter({srcRepoDir, destDocPath, linkMap}) {
  const destDir = path.posix.dirname(destDocPath);

  return (target, isImage) => {
    if (!target || EXTERNAL.test(target) || target.startsWith('#')) return target;

    const [rawPath, ...anchorParts] = target.split('#');
    const anchor = anchorParts.length ? '#' + anchorParts.join('#') : '';
    if (!rawPath) return target;

    // Resolve to a repo-relative POSIX path.
    let repoPath = rawPath.startsWith('/')
      ? path.posix.normalize(rawPath.slice(1))
      : path.posix.normalize(path.posix.join(srcRepoDir, rawPath));
    if (repoPath.startsWith('..')) {
      // The SOURCE link is broken (climbs out of the repository — happens in a
      // few specs authored with a wrong nesting assumption). Repair
      // heuristically: drop leading segments until the remainder exists.
      let segments = repoPath.split('/').filter((s) => s !== '..');
      while (segments.length && !fs.existsSync(path.join(REPO_ROOT, ...segments))) {
        segments = segments.slice(1);
      }
      if (!segments.length) return GITHUB_BLOB + repoPath.replace(/\.\.\//g, '') + anchor;
      repoPath = segments.join('/');
    }

    const absPath = path.join(REPO_ROOT, ...repoPath.split('/'));

    if (isImage || IMAGE_EXT.test(repoPath)) {
      if (!fs.existsSync(absPath)) return GITHUB_BLOB + repoPath + anchor;
      const assetDocPath = `generated/assets/${repoPath}`;
      const assetAbs = path.join(GENERATED_ROOT, '..', ...assetDocPath.split('/'));
      fs.mkdirSync(path.dirname(assetAbs), {recursive: true});
      fs.copyFileSync(absPath, assetAbs);
      return path.posix.relative(destDir, assetDocPath);
    }

    if (/\.mdx?$/i.test(repoPath)) {
      const mapped = linkMap.get(repoPath);
      if (mapped) {
        const rel = path.posix.relative(destDir, mapped);
        return (rel.startsWith('.') ? rel : './' + rel) + anchor;
      }
      return GITHUB_BLOB + repoPath + anchor;
    }

    // Non-markdown repo files / directories — link to GitHub.
    let isDir = false;
    try {
      isDir = fs.statSync(absPath).isDirectory();
    } catch {
      /* missing path: default to blob URL */
    }
    return (isDir ? GITHUB_TREE : GITHUB_BLOB) + repoPath + anchor;
  };
}

/** Escapes a value for use inside a markdown table cell. */
export function tableCell(value) {
  return String(value ?? '—')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '—';
}
