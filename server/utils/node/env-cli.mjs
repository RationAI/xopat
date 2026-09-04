#!/usr/bin/env node
/**
 * `npm run up` — compose a deployment ENV from layers and spin the server up.
 *
 * A deployment is an ordered selector list: preset names, fragment ids from
 * `env/parts/**`, and/or whole ENV files. The composition is written to
 * `env/.compose/<label>.json` (inspectable, gitignored, **placeholders left
 * literal**) and handed to the server through `XOPAT_ENV`, which is the only
 * selector the server itself understands.
 *
 * Secrets are not composed — they are supplied to the child process, where the
 * server's own `<% VAR %>` substitution resolves them. See `./dotenv.js` for
 * why that split is deliberate.
 *
 *   npm run up                              interactive picker
 *   npm run up -- dicom-idc                 a preset
 *   npm run up -- data/dicomweb-idc auth/saml chat/anthropic-server-key
 *   npm run up -- env/env.mine.json logging/chat-transcript
 *   npm run up:check -- --all               lint the whole library
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import {
    repoRoot, fromRoot, composeEnv, loadPresets, listFragments,
    collectPlaceholders, scanForLiteralSecrets, scanForPrivateHosts, formatConflicts, formatProvenance,
} from "./env-compose.mjs";

const require = createRequire(import.meta.url);
const { readDotEnv, layerEnv } = require("./dotenv.js");

const EXIT = { OK: 0, USAGE: 1, CONFLICT: 2, MISSING_VAR: 3, SECRET: 4, PRIVATE_HOST: 5 };
const COMPOSE_DIR = "env/.compose";
const DEFAULT_ENV_FILE = "env/.env";

/* ------------------------------------------------------------------ colour */

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
    red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
    yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
    green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
    cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
};

/* -------------------------------------------------------------------- args */

const HELP = `
${c.bold("npm run up")} — compose a deployment ENV from layers and run it

  npm run up                          pick a configuration interactively
  npm run up -- <selector...>         compose and run
  npm run up:dev -- <selector...>     same, with the asset watcher (npm run dev)
  npm run up:check -- <selector...>   lint only: conflicts, missing vars, secrets
  npm run up:compose -- <selector...> write the composed ENV, do not run

${c.bold("selectors")} resolve in order: preset name → env/parts/<id>.json → any file path

${c.bold("flags")}
  --list                 show every preset and fragment, then exit
  --all                  (with --check) lint every preset in the catalogue
  --print                write the composition and echo it; do not run
  --out <file>           write the composition here instead of ${COMPOSE_DIR}/
  --emit json|compact|compose
                         output shape for --print/--out; "compose" is one line
                         with $ escaped, for pasting into docker-compose.yml
  --check                lint only (implies --print-less); exit 2/3/4 on findings
  --force                downgrade conflicts to warnings (last layer wins)
  --set <path>=<value>   ad-hoc override, e.g. --set core.client.localhost.production=true
  --port <n>             XOPAT_NODE_PORT for the spawned server
  --label <name>         basename under ${COMPOSE_DIR}/ (default: from selectors)
  --env-file <path>      secrets file (repeatable; default ${DEFAULT_ENV_FILE})
  --no-env-file          do not read any secrets file
  --provenance           print which layer won every leaf
  --json                 machine-readable report on stdout
  -h, --help             this text

${c.bold("exit codes")}  0 ok · 2 conflicts · 3 missing required variable · 4 literal secret
`;

function parseArgs(argv) {
    const opts = {
        selectors: [], set: {}, envFiles: [], noEnvFile: false, emit: "json",
        run: true, dev: false, print: false, check: false, force: false,
        list: false, all: false, json: false, provenance: false, out: null,
        port: null, label: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v === undefined) fail(`${a} needs a value`, EXIT.USAGE);
            return v;
        };
        switch (true) {
            case a === "-h" || a === "--help": console.log(HELP); process.exit(EXIT.OK); break;
            case a === "--list": opts.list = true; break;
            case a === "--all": opts.all = true; break;
            case a === "--dev": opts.dev = true; break;
            case a === "--print": opts.print = true; opts.run = false; break;
            case a === "--check": opts.check = true; opts.run = false; break;
            case a === "--force": opts.force = true; break;
            case a === "--json": opts.json = true; break;
            case a === "--provenance": opts.provenance = true; break;
            case a === "--no-env-file": opts.noEnvFile = true; break;
            case a === "--out": opts.out = next(); opts.run = false; break;
            case a === "--emit": opts.emit = next(); break;
            case a === "--port": opts.port = next(); break;
            case a === "--label": opts.label = next(); break;
            case a === "--env-file": opts.envFiles.push(next()); break;
            case a.startsWith("--emit="): opts.emit = a.slice(7); break;
            case a === "--set": applySet(opts, next()); break;
            case a.startsWith("--set="): applySet(opts, a.slice(6)); break;
            case a.startsWith("-"): fail(`unknown flag ${a}\n${HELP}`, EXIT.USAGE); break;
            default: opts.selectors.push(a);
        }
    }
    if (!["json", "compact", "compose"].includes(opts.emit)) fail(`--emit must be json|compact|compose`, EXIT.USAGE);
    return opts;
}

function applySet(opts, assignment) {
    const eq = assignment.indexOf("=");
    if (eq < 1) fail(`--set expects <path>=<value>, got "${assignment}"`, EXIT.USAGE);
    const key = assignment.slice(0, eq).trim();
    const raw = assignment.slice(eq + 1);
    // JSON first so `true`, `42`, `null`, `[…]` land as themselves; a bare word
    // is not valid JSON and stays a string.
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    opts.set[key] = value;
}

function fail(message, code) {
    console.error(c.red(`error: ${message}`));
    process.exit(code ?? EXIT.USAGE);
}

/* ------------------------------------------------------------------ output */

function serialize(env, emit) {
    if (emit === "compact") return JSON.stringify(env);
    // docker-compose interpolates `$…` in its YAML before the container ever
    // sees the value, and slide-protocol templates are full of `${data}`.
    if (emit === "compose") return JSON.stringify(env).replace(/\$/g, "$$$$");
    return JSON.stringify(env, null, 2);
}

function labelFor(selectors, explicit) {
    if (explicit) return explicit.replace(/[^A-Za-z0-9._-]+/g, "-");
    if (!selectors.length) return "current";
    return selectors.map((s) => path.basename(s, ".json")).join("+").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}

function printList() {
    const presets = loadPresets();
    const names = Object.keys(presets);
    if (names.length) {
        console.log(c.bold("\npresets") + c.dim("  (env/presets.json)"));
        const w = Math.max(...names.map((n) => n.length));
        for (const name of names) {
            console.log(`  ${c.cyan(name.padEnd(w))}  ${presets[name].description ?? ""}`);
        }
    }
    const fragments = listFragments();
    if (fragments.length) {
        console.log(c.bold("\nfragments") + c.dim("  (env/parts/)"));
        const w = Math.max(...fragments.map((f) => f.id.length));
        // Grouped by dimension, because the dimension IS the question being
        // answered: one `data`, one `auth`, one `chat`, then anything else.
        const groups = new Map();
        for (const f of fragments) {
            const d = f.meta.dimension ?? "";
            if (!groups.has(d)) groups.set(d, []);
            groups.get(d).push(f);
        }
        const ordered = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
        for (const d of ordered) {
            console.log(c.dim(`  ── ${d ? `${d}  (pick one)` : "combine freely"}`));
            for (const f of groups.get(d)) {
                console.log(`  ${c.cyan(f.id.padEnd(w))}  ${f.meta.description ?? ""}`);
            }
        }
    }
    if (!names.length && !fragments.length) {
        console.log("no presets or fragments yet — see env/README.md");
    }
    console.log("");
}

/* ------------------------------------------------------------------- lints */

/**
 * Everything that can be wrong with a composition, in one pass.
 * Returns the highest exit code implied by the findings.
 */
function report(result, childEnv, { force, json, provenance }) {
    const { conflicts, warnings, env, layers } = result;
    const placeholders = collectPlaceholders(env);
    const missing = [...placeholders.values()].filter(
        (p) => !p.hasDefault && (childEnv[p.name] === undefined || childEnv[p.name] === ""));
    const required = new Set();
    for (const layer of layers) {
        for (const name of layer.meta?.requires ?? []) {
            if (childEnv[name] === undefined || childEnv[name] === "") required.add(`${name} (${layer.id})`);
        }
    }
    // Only tracked layers are a supply-chain concern; a developer's own
    // untracked ENV file holding a literal key is their business.
    const trackedSecrets = [];
    // Same tracked-only rule, second failure mode: the legacy whole-ENV pile
    // leaked no keys at all, it leaked topology — a Tailscale-range IP, internal
    // service hostnames, an institutional login endpoint. A regex over key
    // shapes cannot see any of that.
    const trackedHosts = [];
    for (const layer of layers) {
        if (!layer.file?.startsWith("env/parts/")) continue;
        for (const hit of scanForLiteralSecrets(layer.data)) trackedSecrets.push({ ...hit, layer: layer.id });
        for (const hit of scanForPrivateHosts(layer.data)) trackedHosts.push({ ...hit, layer: layer.id });
    }

    if (json) {
        console.log(JSON.stringify({
            layers: layers.map((l) => ({ id: l.id, kind: l.kind, role: l.role, dimension: l.dimension, file: l.file })),
            conflicts, warnings,
            placeholders: [...placeholders.values()],
            missingVariables: missing.map((m) => m.name),
            missingRequired: [...required],
            literalSecrets: trackedSecrets,
            privateHosts: trackedHosts,
            provenance: result.provenance,
        }, null, 2));
    } else {
        console.error(c.dim(`layers: ${layers.map((l) =>
            l.role === "base" ? `${l.id}${c.dim("(base)")}` : l.id).join(" → ")}`));
        if (conflicts.length) {
            console.error((force ? c.yellow : c.red)(formatConflicts(conflicts)));
            if (force) console.error(c.yellow("--force: continuing, the last layer wins"));
        }
        for (const w of warnings) console.error(c.yellow(`warning: ${w.message}`));
        for (const m of missing) {
            console.error(c.yellow(`warning: <% ${m.name} %> is unset and has no default (${m.paths[0]})`));
        }
        for (const r of required) console.error(c.red(`missing required variable: ${r}`));
        for (const s of trackedSecrets) {
            console.error(c.red(`literal secret in a tracked fragment: ${s.layer} → ${s.path} (${s.kind})`));
        }
        for (const h of trackedHosts) {
            console.error(c.red(
                `non-public host in a tracked fragment: ${h.layer} → ${h.path} names ${h.host} (${h.kind}). ` +
                `Write it as <% VAR %> and put the value in env/.env, or add it to PUBLIC_HOSTS in env-compose.mjs ` +
                `if it is genuinely public.`));
        }
        if (provenance) console.log(formatProvenance(result.provenance));
    }

    if (trackedSecrets.length) return EXIT.SECRET;
    if (trackedHosts.length) return EXIT.PRIVATE_HOST;
    if (required.size) return EXIT.MISSING_VAR;
    if (conflicts.length && !force) return EXIT.CONFLICT;
    return EXIT.OK;
}

/* --------------------------------------------------------------------- run */

function buildChildEnv(result, opts) {
    const files = opts.noEnvFile ? [] : (opts.envFiles.length ? opts.envFiles : [DEFAULT_ENV_FILE]);
    const secrets = {};
    for (const file of files) Object.assign(secrets, readDotEnv(fromRoot(file)));
    // Highest precedence first: a shell export must beat the secrets file,
    // which must beat a preset's env block, which must beat fragment defaults.
    return {
        env: layerEnv({ ...process.env }, secrets, result.presetEnv, result.defaults),
        files: files.filter((f) => existsSync(fromRoot(f))),
    };
}

function writeComposition(env, opts) {
    const target = opts.out ? fromRoot(opts.out) : fromRoot(COMPOSE_DIR, `${labelFor(opts.selectors, opts.label)}.json`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${serialize(env, opts.emit)}\n`, "utf8");
    return target;
}

function spawnServer(envFilePath, childEnv, opts) {
    const args = opts.dev ? [fromRoot("server/utils/node/dev-mode.js")] : [fromRoot("index.js"), "--dev"];
    const env = { ...childEnv, XOPAT_ENV: envFilePath };
    if (opts.port) env.XOPAT_NODE_PORT = String(opts.port);
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: "inherit", env });
    const stop = () => { if (!child.killed) child.kill(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

/* -------------------------------------------------------------------- main */

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.list) { printList(); return EXIT.OK; }

    if (opts.check && opts.all) return checkAll(opts);

    if (!opts.selectors.length) {
        if (!process.stdin.isTTY) {
            fail("no selectors given (and stdin is not a terminal, so the picker cannot run)\n" +
                 "try: npm run up -- --list", EXIT.USAGE);
        }
        const { pickInteractively } = await import("./env-picker.mjs");
        const picked = await pickInteractively();
        if (!picked) return EXIT.OK;
        opts.selectors = picked.selectors;
        opts.run = picked.run && opts.run;
        if (picked.dev) opts.dev = true;
    }

    let result;
    try {
        result = composeEnv(opts.selectors, { set: opts.set });
    } catch (e) {
        fail(e.message, EXIT.USAGE);
    }

    const { env: childEnv, files } = buildChildEnv(result, opts);
    const code = report(result, childEnv, opts);
    if (code !== EXIT.OK) return code;

    const target = writeComposition(result.env, opts);
    if (opts.check) {
        console.error(c.green(`ok — ${opts.selectors.join(" ")} composes cleanly`));
        return EXIT.OK;
    }
    if (!opts.json) {
        console.error(c.dim(`composed → ${path.relative(repoRoot, target).split(path.sep).join("/")}`));
        if (files.length) console.error(c.dim(`secrets   ← ${files.join(", ")}`));
    }
    if (opts.print && !opts.json) console.log(serialize(result.env, opts.emit));
    if (!opts.run) return EXIT.OK;

    spawnServer(target, childEnv, opts);
    return null; // the child owns the exit code
}

function checkAll(opts) {
    const presets = Object.keys(loadPresets());
    const fragments = listFragments().map((f) => f.id);
    let worst = EXIT.OK;
    for (const target of [...presets.map((p) => [p]), ...fragments.map((f) => [f])]) {
        console.error(c.bold(`\n· ${target.join(" ")}`));
        let result;
        try {
            result = composeEnv(target, {});
        } catch (e) {
            console.error(c.red(`error: ${e.message}`));
            worst = Math.max(worst, EXIT.USAGE);
            continue;
        }
        const { env: childEnv } = buildChildEnv(result, opts);
        // A lone fragment is not a deployment: it legitimately lacks variables a
        // preset would supply, so only structural findings count here.
        const code = report(result, childEnv, { ...opts, json: false });
        if (presets.includes(target[0])) worst = Math.max(worst, code);
        else if (code === EXIT.SECRET || code === EXIT.PRIVATE_HOST) worst = Math.max(worst, code);
    }
    console.error(worst === EXIT.OK ? c.green("\nall clean") : c.red(`\nfindings — exit ${worst}`));
    return worst;
}

const code = await main();
if (code !== null) process.exit(code);
