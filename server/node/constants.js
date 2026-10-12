const {parseArgs} = require('node:util');
const args = process.argv;
const options = {
    language: {
        type: 'string',
        short: 'l'
    },
    port: {
        type: 'string',
        short: 'p'
    },
    host: {
        type: 'string',
        short: 'h'
    },
    root: {
        type: 'string',
        short: 'r'
    },
    dev: {
        type: 'boolean'
    }
};
/**
 * Server flags, tolerant of an argv that is not the server's.
 *
 * `parseArgs` is strict by default and THROWS on an option it does not know, so
 * this module could only be loaded by `index.js` itself: requiring it from the
 * Gruntfile, a test runner or any tool with its own flags died with
 * `Unknown option '--project'` pointing at this line. That is too fragile for a
 * module that holds the application root and the packaged-build predicate —
 * every subsystem needs those answers. Unknown flags are therefore ignored here
 * and judged by whoever owns them.
 */
function parseServerArgs() {
    try {
        return parseArgs({ args, options, allowPositionals: true });
    } catch {
        try {
            return parseArgs({ args, options, allowPositionals: true, strict: false });
        } catch {
            return { values: {}, positionals: [] };
        }
    }
}
const {
    values,
    positionals
} = parseServerArgs();

const path = require('node:path');
const os = require('node:os');

// Declared, not implicit globals: an implicit assignment is a ReferenceError
// under strict mode, so this module could not be required from a strict context
// (the test harness is one). The only consumer that read the bare global was
// server/node/index.js, which now reads constants.ABSPATH like everything else.
const _ABSPATH = values.root || path.dirname(path.dirname(__dirname));
const ABSPATH = _ABSPATH + path.sep;
const PROJECT_ROOT = process.env.PROJECT_ROOT || "";

function readBooleanEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

const DEV_MODE = values.dev === true || readBooleanEnv('XOPAT_DEV_MODE', false);

/**
 * Is this process a packaged single-file build (pkg / SEA) rather than a run
 * from a source tree?
 *
 * A packaged build differs in two ways no other flag captures: its own files
 * live in a READ-ONLY virtual filesystem, and it carries no build toolchain
 * (esbuild is a devDependency shipping a platform-native executable, neither of
 * which can be snapshotted). Everything that compiles on demand or writes next
 * to its sources has to take a different path, so the predicate must be
 * answerable before anything else is wired up — which is why it lives here and
 * not on `XOPAT_SERVER`, installed later by the runtime.
 *
 * `XOPAT_PACKAGED=1` is part of the detection on purpose: it is the only way to
 * exercise the no-compile / no-write path from a plain `node index.js`, so the
 * packaged behaviour is testable without producing a binary first.
 */
function detectPackaged() {
    if (typeof process.pkg !== "undefined") return "pkg";
    if (process.versions && process.versions.pkg) return "pkg";
    try {
        if (require("node:sea").isSea?.() === true) return "sea";
    } catch { /* Node < 20.12, or no SEA support */ }
    if (readBooleanEnv('XOPAT_PACKAGED', false)) return "env";
    return null;
}
const PACKAGED_KIND = detectPackaged();

/**
 * Where working files go when the deployment did not say (`XOPAT_CACHE_DIR`).
 *
 * The source-tree default sits inside the application root, which in a packaged
 * build is the read-only snapshot — `mkdirSync` on it throws during server
 * construction, so a bare `./xopat_binary` with no environment never booted.
 * Stable rather than pid-suffixed, so repeated runs reuse one directory instead
 * of leaking one per restart. Four call sites used to spell this fallback four
 * different ways; they all read it from here now.
 */
const DEFAULT_CACHE_DIR = PACKAGED_KIND
    ? path.join(os.tmpdir(), 'xopat-cache')
    : ABSPATH + 'server' + path.sep + '.cache';

module.exports = Object.freeze({
    _ABSPATH_NO_SLASH: _ABSPATH,
    ABSPATH: ABSPATH,
    //Absolute Root Path for the node server
    VIEWER_SOURCES_ABS_ROOT: ABSPATH + 'src' + path.sep,
    ABS_MODULES: ABSPATH + 'modules' + path.sep,
    ABS_PLUGINS: ABSPATH + 'plugins' + path.sep,

    //Relative Paths For the Viewer
    PROJECT_ROOT: PROJECT_ROOT,
    PROJECT_SOURCES: PROJECT_ROOT + 'src/',
    LIBS_ROOT: PROJECT_ROOT + 'src/libs/',
    ASSETS_ROOT: PROJECT_ROOT + 'src/assets/',
    LOCALES_ROOT: PROJECT_ROOT + 'src/locales/',
    SERVER_ROOT: PROJECT_ROOT + 'server/',
    MODULES_FOLDER: PROJECT_ROOT + 'modules/',
    PLUGINS_FOLDER: PROJECT_ROOT + 'plugins/',

    //Packaging
    /** Truthy when running from a pkg/SEA snapshot: read-only files, no toolchain. */
    PACKAGED: PACKAGED_KIND !== null,
    /** "pkg" | "sea" | "env" | null — which signal identified the packaged build. */
    PACKAGED_KIND: PACKAGED_KIND,
    /** Cache/working root used when XOPAT_CACHE_DIR is unset. */
    DEFAULT_CACHE_DIR: DEFAULT_CACHE_DIR,

    //Utils
    TEMPLATE_PATTERN: /<template\s+id="template-([a-zA-Z0-9-_]+)">\s*<\/template>/g,

    //Server
    SERVER: {
        HOST: values.host || process.env.XOPAT_NODE_HOST || '0.0.0.0',
        PORT: values.port || process.env.XOPAT_NODE_PORT || 9000,
        LANGUAGE: values.language || 'en',
        // Log buffer size and levels are NOT env vars any more — they live in
        // `core.server.logging` (see server/LOGGING.md).
        DEV_MODE: DEV_MODE,
    }
});
