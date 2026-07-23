"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SAFE_ROOTS = [
    path.join(REPO_ROOT, "src"),
    path.join(REPO_ROOT, "modules"),
    path.join(REPO_ROOT, "plugins"),
    path.join(REPO_ROOT, "server"),
    path.join(REPO_ROOT, "ui"),
    path.join(REPO_ROOT, "docs"),
];
// Repo-root files (no directory part) are allowed for docs/config only.
const SAFE_ROOT_FILE_EXTENSIONS = new Set([".md", ".json"]);
const SAFE_EXTENSIONS = new Set([".md", ".txt", ".json", ".js", ".mjs", ".ts", ".css", ".html"]);
const SKIPPED_DIR_NAMES = new Set(["node_modules", ".git", ".server-dist", ".cache", "dist", "build"]);
const DEFAULT_READMES = [
    "AGENTS.md",
    "src/README.md",
    "src/MULTI_VIEWPORTS.md",
    "src/EVENTS.md",
    "src/classes/scripting/README.md",
    "modules/README.md",
    "plugins/README.md",
    "modules/chat-based-tester/README.md",
];
const DEFAULT_SOURCE_FILES = [
    "modules/vercel-ai-chat-sdk/chatService.ts",
    "modules/chat-based-tester/chat-dev.ts",
];
const DEFAULT_MAX_FILE_CHARS = 3_000;
const DEFAULT_MAX_TOTAL_CHARS = 24_000;

const policy = {
    getDevSessionBootstrap: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    readWorkspaceFiles: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    listWorkspaceDir: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
};

function requireDevMode(ctx) {
    if (ctx?.core?.CORE?.server?.devMode === true) return;
    const error = new Error("chat-based-tester server RPC is available only in dev mode");
    error.code = "CHAT_DEV_MODE_REQUIRED";
    throw error;
}

function isInsideSafeRoots(absPath) {
    return SAFE_ROOTS.some((root) => {
        const resolvedRoot = path.resolve(root);
        return absPath === resolvedRoot || absPath.startsWith(`${resolvedRoot}${path.sep}`);
    });
}

function isAllowedRootFile(absPath) {
    if (path.dirname(absPath) !== REPO_ROOT) return false;
    return SAFE_ROOT_FILE_EXTENSIONS.has(path.extname(absPath).toLowerCase());
}

function ensureAllowedFile(relPath) {
    const normalized = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized) throw new Error("Workspace path is required.");

    const absPath = path.resolve(REPO_ROOT, normalized);
    const ext = path.extname(absPath).toLowerCase();
    if (!SAFE_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported workspace file type for '${normalized}'.`);
    }

    if (!isInsideSafeRoots(absPath) && !isAllowedRootFile(absPath)) {
        throw new Error(`Workspace path '${normalized}' is outside the allowed development roots (src, modules, plugins, server, ui, docs, or *.md/*.json at the repo root).`);
    }
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        throw new Error(`Workspace file '${normalized}' was not found.`);
    }
    return absPath;
}

function trimContent(content, maxChars) {
    if (content.length <= maxChars) return { content, truncated: false };
    const suffix = `\n\n[truncated to ${maxChars} characters by chat-based-tester]`;
    return {
        content: `${content.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`,
        truncated: true,
    };
}

function classifyFile(relPath) {
    const normalized = String(relPath || "").toLowerCase();
    if (normalized.endsWith("llm_coding_guidelines.md")) return "guidelines";
    if (normalized.endsWith(".md")) return "readme";
    if (normalized.endsWith(".json")) return "config";
    if (/\.(js|mjs|ts|html|css)$/.test(normalized)) return "source";
    return "text";
}

function readWorkspaceFile(relPath, maxChars) {
    const absPath = ensureAllowedFile(relPath);
    const raw = fs.readFileSync(absPath, "utf8");
    const trimmed = trimContent(raw, maxChars);
    return {
        path: String(relPath).replace(/\\/g, "/"),
        kind: classifyFile(relPath),
        content: trimmed.content,
        truncated: trimmed.truncated,
        sizeChars: raw.length,
    };
}

function clampFileCharLimit(inputValue) {
    return Math.max(800, Math.min(8_000, Number(inputValue) || DEFAULT_MAX_FILE_CHARS));
}

function clampTotalCharLimit(inputValue) {
    return Math.max(4_000, Math.min(40_000, Number(inputValue) || DEFAULT_MAX_TOTAL_CHARS));
}

function readWorkspaceFilesWithinBudget(paths, maxFileChars, maxTotalChars) {
    const files = [];
    const omittedPaths = [];
    const errors = [];
    let remaining = maxTotalChars;

    for (const item of uniquePaths(paths)) {
        if (remaining <= 0) {
            omittedPaths.push(item);
            continue;
        }

        // One bad path must never poison the whole read — the caller (an LLM
        // exploring the workspace) needs the successful reads plus a precise
        // per-path failure reason it can correct on the next step.
        try {
            const nextLimit = Math.max(800, Math.min(maxFileChars, remaining));
            const file = readWorkspaceFile(item, nextLimit);
            files.push(file);
            remaining -= String(file.content || "").length;
        } catch (error) {
            errors.push({
                path: item,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        files,
        omittedPaths,
        errors,
        totalChars: files.reduce((sum, file) => sum + String(file.content || "").length, 0),
        maxTotalChars,
    };
}

function uniquePaths(paths) {
    const seen = new Set();
    const result = [];
    for (const value of paths || []) {
        const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function buildViewerSnapshot(ctx) {
    const core = ctx?.core || {};
    return {
        locale: core?.CORE?.setup?.locale || "en",
        production: core?.CORE?.client?.production === true,
        serverName: core?.CORE?.server?.name || "node",
        serverDevMode: core?.CORE?.server?.devMode === true,
        pluginCount: Object.keys(core?.PLUGINS || {}).length,
        moduleCount: Object.keys(core?.MODULES || {}).length,
        viewerId: ctx?.viewerId || null,
        contextId: ctx?.contextId || null,
    };
}

async function readWorkspaceFiles(ctx, input = {}) {
    requireDevMode(ctx);
    const maxFileChars = clampFileCharLimit(input.maxFileChars);
    const maxTotalChars = clampTotalCharLimit(input.maxTotalChars);
    const paths = uniquePaths(input.paths || []);
    const result = readWorkspaceFilesWithinBudget(paths, maxFileChars, maxTotalChars);
    return {
        devMode: true,
        files: result.files,
        omittedPaths: result.omittedPaths,
        errors: result.errors,
        totalChars: result.totalChars,
        maxTotalChars: result.maxTotalChars,
    };
}

async function listWorkspaceDir(ctx, input = {}) {
    requireDevMode(ctx);
    const normalized = String(input.path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    const maxEntries = Math.max(1, Math.min(500, Number(input.maxEntries) || 200));

    const absPath = path.resolve(REPO_ROOT, normalized || ".");
    const isRepoRoot = absPath === REPO_ROOT;
    if (!isRepoRoot && !isInsideSafeRoots(absPath)) {
        throw new Error(`Workspace directory '${normalized}' is outside the allowed development roots (src, modules, plugins, server, ui, docs).`);
    }
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        throw new Error(`Workspace directory '${normalized || "."}' was not found.`);
    }

    const entries = [];
    let truncated = false;
    for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
        if (entries.length >= maxEntries) {
            truncated = true;
            break;
        }
        const entryRel = normalized ? `${normalized}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (SKIPPED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
            // Repo-root listing only exposes the readable roots.
            if (isRepoRoot && !isInsideSafeRoots(path.join(absPath, entry.name))) continue;
            entries.push({ path: entryRel, kind: "dir" });
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!SAFE_EXTENSIONS.has(ext)) continue;
            if (isRepoRoot && !SAFE_ROOT_FILE_EXTENSIONS.has(ext)) continue;
            let sizeChars = null;
            try {
                sizeChars = fs.statSync(path.join(absPath, entry.name)).size;
            } catch (_) { /* keep null */ }
            entries.push({ path: entryRel, kind: "file", sizeBytes: sizeChars });
        }
    }

    entries.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : (a.kind === "dir" ? -1 : 1)));
    return {
        devMode: true,
        path: normalized || ".",
        entries,
        truncated,
    };
}

async function getDevSessionBootstrap(ctx, input = {}) {
    requireDevMode(ctx);
    const maxFileChars = clampFileCharLimit(input.maxFileChars);
    const maxTotalChars = clampTotalCharLimit(input.maxTotalChars);
    const paths = [
        ...(input.includeReadmes === false ? [] : DEFAULT_READMES),
        ...(input.includeSources === false ? [] : DEFAULT_SOURCE_FILES),
        ...uniquePaths(input.additionalPaths || []),
    ];
    const result = readWorkspaceFilesWithinBudget(paths, maxFileChars, maxTotalChars);

    return {
        devMode: true,
        viewer: buildViewerSnapshot(ctx),
        instructions: [
            "This is a development-only testing session for xOpat.",
            "Use the bundled developer guide and repository docs first, then pull more workspace files when needed.",
            "Bootstrap content is intentionally trimmed. Read additional source files on demand instead of assuming they were preloaded.",
            "Discover files with listWorkspaceDir(path) before reading — do not guess file paths. Readable roots: src, modules, plugins, server, ui, docs, plus *.md/*.json at the repo root.",
            "readWorkspaceFiles(paths) tolerates bad paths: failed paths are reported in the 'errors' array while valid paths still return content.",
            "If the selected harness mode is host testing, prefer xopat-host-script for direct host-app JavaScript.",
            "If the selected harness mode is scripting testing, prefer xopat-script and the allowed scripting API.",
            "Always return the final value from xopat-script and xopat-host-script blocks.",
        ],
        files: result.files,
        omittedPaths: result.omittedPaths,
        errors: result.errors,
        totalChars: result.totalChars,
        maxTotalChars: result.maxTotalChars,
    };
}

module.exports = {
    policy,
    getDevSessionBootstrap,
    readWorkspaceFiles,
    listWorkspaceDir,
};
