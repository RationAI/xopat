/**
 * The interactive half of `npm run up`.
 *
 * Bare `npm run up` has no selectors, and the honest answer to "what can I
 * run?" is not a help text — it is the library itself. The choices and their
 * descriptions are read straight out of `env/parts/**` and `env/presets.json`;
 * a fragment added tomorrow appears here with no code change.
 *
 * The flow is a starting point plus a loop, not a questionnaire:
 *
 *  1. how many deployments the server should offer (one, unless asked);
 *  2. start from a preset — Enter takes `default` — or from scratch;
 *  3. layer on top for as long as wanted: answer, re-answer or clear any
 *     dimension (data, auth, chat, …), toggle the freely-combining extras.
 *
 * Each step is composed on the spot, so a conflict, a variable nobody set, or a
 * fragment's setup note shows at the step that caused it. Anything a chosen
 * fragment declares `conflictsWith` is not offered, so the picker does not
 * assemble a combination the composer would then refuse.
 *
 * With more than one deployment, the first stack is the base env and each
 * further one becomes a named deployment layered over it (`--deployment`).
 *
 * It ends by printing the equivalent non-interactive command, because the point
 * of a picker is to stop needing it.
 */
import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import {
    listFragments, loadPresets, expandSelectors, composeEnv,
    describeVariables, collectHints, formatVariables, formatConflicts,
} from "./env-compose.mjs";

// The server's own rule for a deployment id — one definition, not a copy.
const { isDeploymentId } = createRequire(import.meta.url)("../../templates/javascript/deployments.js");

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
    cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
    green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
};

/**
 * The order dimensions are listed in. Not alphabetical: it follows what a
 * deployment actually decides first — slides, then who may see them, then what
 * else is attached. Dimensions not listed here come afterwards, so a new one
 * still gets an entry.
 */
const DIMENSION_ORDER = ["data", "transport", "auth", "roles", "chat", "voice", "io", "storage", "logging"];

const LABEL = {
    data: "Where do slides come from?",
    transport: "How is slide traffic routed?",
    auth: "How do users log in?",
    roles: "Role-based capability gating?",
    chat: "Which assistant?",
    voice: "Dictation (speech-to-text)?",
    io: "Where does saved state go?",
    storage: "Server-side persistence?",
    logging: "Session logging?",
};

/** Thrown when stdin ends mid-question (Ctrl+D, or a piped input running out). */
class Aborted extends Error {}

/**
 * Line-queue reader rather than `rl.question`.
 *
 * `question()` never settles once stdin has ended — the process would hang
 * instead of exiting — and racing it against `close` loses lines that arrived
 * in the same tick, which is exactly what happens when the answers are piped
 * in. Buffering the `line` events keeps both cases honest: every line asked for
 * is a line that was sent, and end-of-input raises instead of stalling.
 */
function makeAsker(rl, output) {
    const queue = [];
    let waiting = null;
    let closed = false;
    rl.on("line", (line) => {
        if (waiting) { const resolve = waiting; waiting = null; resolve(line); }
        else queue.push(line);
    });
    rl.on("close", () => {
        closed = true;
        if (waiting) { const resolve = waiting; waiting = null; resolve(null); }
    });
    return async (prompt) => {
        output.write(prompt);
        if (queue.length) return queue.shift();
        if (closed) throw new Aborted();
        const line = await new Promise((resolve) => { waiting = resolve; });
        if (line === null) throw new Aborted();
        return line;
    };
}


function render(options, { skipLabel, marked }) {
    const w = Math.max(...options.map((o) => o.id.length));
    options.forEach((o, i) => {
        const mark = marked ? (marked.has(o.id) ? "[x] " : "[ ] ") : "";
        console.log(`  ${String(i + 1).padStart(2)}) ${mark}${c.cyan(o.id.padEnd(w))}  ${o.meta.description ?? ""}`);
    });
    if (skipLabel) console.log(c.dim(`   -) ${skipLabel}`));
}

/**
 * One choice out of `options`.
 *
 * Enter and `-` are different answers, because in a loop they mean different
 * things ("leave it as it is" vs "take it away"):
 *  - an option  → that option
 *  - Enter      → `enter` when given, else `undefined`
 *  - `-`        → `null` (only offered when `skipLabel` is set)
 */
async function askOne(ask, prompt, options, { skipLabel = null, enter, enterLabel = "to skip" } = {}) {
    if (!options.length) return undefined;
    console.log(`\n${c.bold(prompt)}`);
    render(options, { skipLabel });
    for (;;) {
        const answer = (await ask(c.dim(`  [1-${options.length}${skipLabel ? ", -" : ""}, Enter ${enterLabel}] `))).trim();
        if (!answer) return enter;
        if (answer === "-") {
            if (skipLabel) return null;
            continue;
        }
        const byIndex = options[Number(answer) - 1];
        if (byIndex) return byIndex;
        const byName = options.find((o) => o.id === answer || o.id.endsWith(`/${answer}`));
        if (byName) return byName;
        console.log(c.dim("  not one of the options"));
    }
}

async function askMany(ask, prompt, options, marked) {
    if (!options.length) return [];
    console.log(`\n${c.bold(prompt)}`);
    render(options, { marked });
    const answer = (await ask(c.dim("  [numbers, comma-separated, each one toggles; Enter for no change] "))).trim();
    if (!answer || answer === "-") return [];
    return answer.split(/[\s,]+/)
        .map((token) => options[Number(token) - 1] ?? options.find((o) => o.id === token))
        .filter(Boolean);
}

async function askYesNo(ask, prompt, fallback = true) {
    const answer = (await ask(`${prompt} ${c.dim(fallback ? "[Y/n] " : "[y/N] ")}`)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer.startsWith("y");
}

async function askCount(ask) {
    for (;;) {
        const answer = (await ask(
            `\n${c.bold("How many deployments should this server offer?")} ${c.dim("[1] ")}`)).trim();
        if (!answer) return 1;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= 16) return n;
        console.log(c.dim("  a number from 1 to 16"));
    }
}

async function askDeploymentId(ask, taken, index) {
    for (;;) {
        const answer = (await ask(
            `\n${c.bold(`Deployment ${index} — its id`)} ${c.dim("(a session picks it with ?deployment=<id>) ")}`)).trim();
        if (!isDeploymentId(answer)) {
            console.log(c.dim("  lowercase letters, digits, - and _ (and not \"base\")"));
        } else if (taken.has(answer)) {
            console.log(c.dim("  already used"));
        } else {
            return answer;
        }
    }
}

/* ------------------------------------------------------------------- stack */

/**
 * What one deployment is made of while it is being picked.
 *
 * A preset stays ONE selector (it carries `env` / `override` blocks a flat
 * layer list would lose); what the user changes is recorded beside it and the
 * composer's replacement rule does the rest — a fragment named directly takes
 * the place of the preset's fragment in the same dimension.
 */
function createStack(fragments, presetName, overlay) {
    const stack = { preset: presetName, fromPreset: new Map(), presetExtras: [], picked: new Map(), extras: [], base: [] };
    if (presetName) {
        for (const layer of expandSelectors([presetName]).layers) {
            if (layer.role === "base" || layer.role === "override") continue;
            if (layer.dimension) stack.fromPreset.set(layer.dimension, layer.id);
            else stack.presetExtras.push(layer.id);
        }
    } else if (!overlay) {
        // Base layers are not a question: they are the floor every deployment
        // stands on. A named deployment is an overlay on the base one, so it
        // brings none of its own.
        stack.base = fragments.filter((f) => f.meta.role === "base").map((f) => f.id);
    }
    return stack;
}

const sortDimensions = (list) => [...list].sort((a, b) => {
    const ia = DIMENSION_ORDER.indexOf(a), ib = DIMENSION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

function selectorsOf(stack) {
    const picked = sortDimensions([...stack.picked.keys()]).map((d) => stack.picked.get(d));
    return [...(stack.preset ? [stack.preset] : stack.base), ...picked, ...stack.extras];
}

/** Every fragment currently in effect, whoever put it there. */
function effective(stack, exceptDimension) {
    const ids = [...stack.presetExtras, ...stack.extras];
    for (const d of new Set([...stack.fromPreset.keys(), ...stack.picked.keys()])) {
        if (d !== exceptDimension) ids.push(stack.picked.get(d) ?? stack.fromPreset.get(d));
    }
    return ids;
}

/** Fragments a declared `conflictsWith` rules out, in either direction. */
function excludedBy(fragments, active) {
    const on = new Set(active);
    const out = new Set();
    for (const f of fragments) {
        const declared = f.meta.conflictsWith ?? [];
        if (on.has(f.id)) for (const other of declared) out.add(other);
        else if (declared.some((other) => on.has(other))) out.add(f.id);
    }
    return out;
}

function printStack(stack, dimensions) {
    console.log(`\n${c.bold("current stack")}${stack.preset ? c.dim(`  (started from ${stack.preset})`) : ""}`);
    const w = Math.max(6, ...dimensions.map((d) => d.length));
    for (const d of dimensions) {
        const mine = stack.picked.get(d);
        const id = mine ?? stack.fromPreset.get(d);
        console.log(`  ${d.padEnd(w)}  ${id ? c.cyan(id) : c.dim("—")}${
            mine && stack.fromPreset.has(d) ? c.dim(`  (replaces ${stack.fromPreset.get(d)})`) : ""}`);
    }
    const extras = [...stack.presetExtras, ...stack.extras];
    console.log(`  ${"extras".padEnd(w)}  ${extras.length ? c.cyan(extras.join(", ")) : c.dim("—")}`);
}

/**
 * Compose what has been picked so far and say what the last step brought with
 * it — conflicts, the variables it reads that nobody has set, its setup note.
 * Shown at the step that caused it rather than in one wall at the end.
 */
function preview(stack, changed, userEnv) {
    const selectors = selectorsOf(stack);
    if (!selectors.length) return;
    let result;
    try {
        result = composeEnv(selectors, {});
    } catch (e) {
        console.log(c.yellow(e.message));
        return;
    }
    if (result.conflicts.length) console.log(c.yellow(formatConflicts(result.conflicts)));
    const user = userEnv ? userEnv(result) : process.env;
    const variables = describeVariables(result, { user })
        .filter((v) => v.status !== "set" && v.layers.some((l) => changed.includes(l)));
    for (const row of formatVariables(variables)) {
        console.log((row.status === "unset" ? c.yellow : c.dim)(`  ${row.text}`));
    }
    for (const h of collectHints(result)) {
        if (changed.includes(h.layer)) console.log(c.cyan(`  ${h.layer}: ${h.hint}`));
    }
}

/**
 * Pick a starting point, then keep layering until the user stops: any
 * dimension can be answered, re-answered or cleared, in any order, as often as
 * wanted. That is what lets a shipped preset be rebuilt — or bent — by hand.
 */
async function buildStack(ask, { fragments, presets, overlay, title, userEnv }) {
    if (title) console.log(`\n${c.bold(c.green(`── ${title}`))}`);
    const presetNames = Object.keys(presets);
    let presetName = null;
    if (!overlay && presetNames.length) {
        const options = presetNames.map((name) => ({ id: name, meta: { description: presets[name].description ?? "" } }));
        const fallback = options.find((o) => o.id === "default");
        const chosen = await askOne(ask, "Start from", options, {
            skipLabel: "from scratch — only the base layer, add everything yourself",
            enter: fallback,
            enterLabel: fallback ? "for default" : "for scratch",
        });
        presetName = chosen ? chosen.id : null;
    }
    const stack = createStack(fragments, presetName, overlay);
    const layerable = fragments.filter((f) => f.meta.role !== "base");
    const dimensions = sortDimensions(new Set(layerable.map((f) => f.meta.dimension).filter(Boolean)));
    const menu = [
        ...dimensions.map((d) => ({ id: d, meta: { description: LABEL[d] ?? "" } })),
        { id: "extras", meta: { description: "flags, demos, extra providers — these combine freely" } },
    ];

    for (;;) {
        printStack(stack, dimensions);
        const what = await askOne(ask, "Add or change a layer?", menu, { enterLabel: "when done" });
        if (!what) break;

        if (what.id === "extras") {
            const excluded = excludedBy(fragments, effective(stack));
            const options = layerable.filter((f) => !f.meta.dimension
                && !stack.presetExtras.includes(f.id) && (!excluded.has(f.id) || stack.extras.includes(f.id)));
            const toggled = await askMany(ask, "Extras", options, new Set(stack.extras));
            const added = [];
            for (const f of toggled) {
                if (stack.extras.includes(f.id)) stack.extras = stack.extras.filter((id) => id !== f.id);
                else { stack.extras.push(f.id); added.push(f.id); }
            }
            preview(stack, added, userEnv);
            continue;
        }

        const dimension = what.id;
        const excluded = excludedBy(fragments, effective(stack, dimension));
        const options = layerable.filter((f) => f.meta.dimension === dimension && !excluded.has(f.id));
        const current = stack.picked.get(dimension) ?? stack.fromPreset.get(dimension);
        const inherited = stack.fromPreset.get(dimension);
        const chosen = await askOne(ask, LABEL[dimension] ?? `${dimension}?`, options, {
            // A preset's own answer cannot be taken away, only replaced: the
            // selector grammar has no "minus".
            skipLabel: !stack.picked.has(dimension) ? null
                : inherited ? `back to ${inherited}` : "remove — leave it to the elements' own defaults",
            enterLabel: current ? `to keep ${current}` : "to leave unset",
        });
        if (chosen === undefined) continue;
        if (chosen === null || chosen.id === inherited) {
            stack.picked.delete(dimension);
            continue;
        }
        stack.picked.set(dimension, chosen.id);
        preview(stack, [chosen.id], userEnv);
    }
    return selectorsOf(stack);
}

/* -------------------------------------------------------------------- main */

/**
 * @param {object} [options]
 * @param {(result: object) => object} [options.userEnv] variables the user set
 *   (shell + secrets file) for a composition; defaults to `process.env`.
 * @param {NodeJS.ReadableStream} [options.input] answers source (tests pipe one in).
 * @returns {Promise<null | {selectors: string[], deployments: Record<string, string[]>,
 *   defaultDeployment: string|null, run: boolean, dev: boolean}>}
 */
export async function pickInteractively({ userEnv, input = process.stdin } = {}) {
    const fragments = listFragments();
    const presets = loadPresets();
    const rl = createInterface({ input, output: process.stdout });
    const ask = makeAsker(rl, process.stdout);

    try {
        const count = await askCount(ask);
        const selectors = await buildStack(ask, {
            fragments, presets, userEnv, overlay: false,
            title: count > 1 ? "base deployment — what a session gets unless it names another" : null,
        });

        const deployments = {};
        for (let i = 2; i <= count; i++) {
            const id = await askDeploymentId(ask, new Set(Object.keys(deployments)), i);
            const layers = await buildStack(ask, {
                fragments, presets, userEnv, overlay: true,
                title: `deployment "${id}" — layered over the base one`,
            });
            if (layers.length) deployments[id] = layers;
            else console.log(c.dim(`  "${id}" has no layers — left out`));
        }

        let defaultDeployment = null;
        const ids = Object.keys(deployments);
        if (ids.length) {
            const chosen = await askOne(
                ask, "Which deployment does a session get when it names none?",
                ids.map((id) => ({ id, meta: { description: deployments[id].join(" ") } })),
                { enterLabel: "for the base one" });
            defaultDeployment = chosen ? chosen.id : null;
        }

        // `await`, not a bare return: an unawaited promise leaves the
        // try/finally immediately, so `rl.close()` would fire while finish() is
        // still on a prompt — closing stdin under it and raising Aborted
        // outside the catch that handles it.
        return await finish(ask, { selectors, deployments, defaultDeployment });
    } catch (e) {
        if (e instanceof Aborted) {
            console.log(c.dim("\naborted — nothing composed"));
            return null;
        }
        throw e;
    } finally {
        rl.close();
    }
}

/** The non-interactive command that reproduces a picked configuration. */
export function commandFor({ selectors, deployments = {}, defaultDeployment = null }) {
    const parts = [...selectors];
    for (const [id, layers] of Object.entries(deployments)) parts.push("--deployment", `${id}=${layers.join(",")}`);
    if (defaultDeployment) parts.push("--default-deployment", defaultDeployment);
    return `npm run up -- ${parts.join(" ")}`;
}

async function finish(ask, picked) {
    if (!picked.selectors.length) {
        console.log(c.dim("\nnothing selected — run `npm run up -- --list` to see the library"));
        return null;
    }
    console.log(`\n${c.green("→")} ${c.bold(commandFor(picked))}`);
    console.log(c.dim("  (that command reproduces this configuration without the questions)\n"));

    const run = await askYesNo(ask, "Start the server now?");
    if (!run) return { ...picked, run: false, dev: false };
    const dev = await askYesNo(ask, "With the asset watcher (npm run dev)?", false);
    return { ...picked, run: true, dev };
}
