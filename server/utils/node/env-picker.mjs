/**
 * The interactive half of `npm run up`.
 *
 * Bare `npm run up` has no selectors, and the honest answer to "what can I
 * run?" is not a help text — it is the library itself. So the picker walks the
 * dimensions in dependency order and asks one question each, reading the
 * choices and their descriptions straight out of `env/parts/**`. A fragment
 * added tomorrow appears here with no code change.
 *
 * It filters as it goes: once a dimension is answered, that dimension is done,
 * and anything a chosen fragment declares `conflictsWith` disappears from the
 * later questions. The picker therefore cannot assemble a combination that the
 * composer would then refuse — the constraint is enforced once, in the data.
 *
 * It ends by printing the equivalent non-interactive command, because the point
 * of a picker is to stop needing it.
 */
import { createInterface } from "node:readline/promises";
import { listFragments, loadPresets } from "./env-compose.mjs";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
    cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
    green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
};

/**
 * The order the questions get asked in. Not alphabetical: it follows what a
 * deployment actually decides first — slides, then who may see them, then what
 * else is attached. Dimensions not listed here are asked afterwards, so a new
 * one still gets a question.
 */
const DIMENSION_ORDER = ["data", "transport", "auth", "roles", "chat", "io", "storage", "logging"];

const LABEL = {
    data: "Where do slides come from?",
    transport: "How is slide traffic routed?",
    auth: "How do users log in?",
    roles: "Role-based capability gating?",
    chat: "Which assistant?",
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

function render(options, { allowSkip }) {
    const w = Math.max(...options.map((o) => o.id.length));
    options.forEach((o, i) => {
        console.log(`  ${String(i + 1).padStart(2)}) ${c.cyan(o.id.padEnd(w))}  ${o.meta.description ?? ""}`);
    });
    if (allowSkip) console.log(c.dim("   -) skip — leave this to the elements' own defaults"));
}

async function askOne(ask, prompt, options, { allowSkip = true } = {}) {
    if (!options.length) return null;
    console.log(`\n${c.bold(prompt)}`);
    render(options, { allowSkip });
    for (;;) {
        const answer = (await ask(c.dim(`  [1-${options.length}${allowSkip ? ", Enter to skip" : ""}] `))).trim();
        if (!answer || answer === "-") {
            if (allowSkip) return null;
            continue;
        }
        const byIndex = options[Number(answer) - 1];
        if (byIndex) return byIndex;
        const byName = options.find((o) => o.id === answer || o.id.endsWith(`/${answer}`));
        if (byName) return byName;
        console.log(c.dim("  not one of the options"));
    }
}

async function askMany(ask, prompt, options) {
    if (!options.length) return [];
    console.log(`\n${c.bold(prompt)}`);
    render(options, { allowSkip: true });
    const answer = (await ask(c.dim("  [numbers, comma-separated, Enter for none] "))).trim();
    if (!answer) return [];
    return answer.split(/[\s,]+/)
        .map((token) => options[Number(token) - 1] ?? options.find((o) => o.id === token))
        .filter(Boolean);
}

async function askYesNo(ask, prompt, fallback = true) {
    const answer = (await ask(`${prompt} ${c.dim(fallback ? "[Y/n] " : "[y/N] ")}`)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer.startsWith("y");
}

export async function pickInteractively() {
    const fragments = listFragments();
    const presets = loadPresets();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = makeAsker(rl, process.stdout);

    try {
        const presetNames = Object.keys(presets);
        if (presetNames.length) {
            const chosen = await askOne(
                ask,
                "Start from a named deployment?",
                presetNames.map((name) => ({ id: name, meta: { description: presets[name].description ?? "" } })),
                { allowSkip: true });
            if (chosen) {
                const extras = await askMany(
                    ask, "Layer anything else on top?",
                    fragments.filter((f) => !f.meta.dimension && f.meta.role !== "base"));
                return finish(ask, [chosen.id, ...extras.map((e) => e.id)]);
            }
            console.log(c.dim("\ncomposing from scratch — one question per dimension\n"));
        }

        // Base layers are not a question: they are the floor every deployment
        // stands on, and they exist to be overridden by everything that follows.
        const selected = fragments.filter((f) => f.meta.role === "base").map((f) => f.id);
        const excluded = new Set();

        const dimensions = [...new Set(fragments.map((f) => f.meta.dimension).filter(Boolean))]
            .sort((a, b) => {
                const ia = DIMENSION_ORDER.indexOf(a), ib = DIMENSION_ORDER.indexOf(b);
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });

        for (const dimension of dimensions) {
            const options = fragments.filter((f) => f.meta.dimension === dimension && !excluded.has(f.id));
            const chosen = await askOne(ask, LABEL[dimension] ?? `${dimension}?`, options);
            if (!chosen) continue;
            selected.push(chosen.id);
            for (const other of chosen.meta.conflictsWith ?? []) excluded.add(other);
            for (const f of fragments) {
                if ((f.meta.conflictsWith ?? []).includes(chosen.id)) excluded.add(f.id);
            }
        }

        const extras = await askMany(
            ask, "Anything else? (flags, extra providers — these combine freely)",
            fragments.filter((f) => !f.meta.dimension && f.meta.role !== "base" && !excluded.has(f.id)));
        selected.push(...extras.map((e) => e.id));

        return finish(ask, selected);
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

async function finish(ask, selectors) {
    if (!selectors.length) {
        console.log(c.dim("\nnothing selected — run `npm run up -- --list` to see the library"));
        return null;
    }
    console.log(`\n${c.green("→")} ${c.bold(`npm run up -- ${selectors.join(" ")}`)}`);
    console.log(c.dim("  (that command reproduces this configuration without the questions)\n"));

    const run = await askYesNo(ask, "Start the server now?");
    if (!run) return { selectors, run: false, dev: false };
    const dev = await askYesNo(ask, "With the asset watcher (npm run dev)?", false);
    return { selectors, run: true, dev };
}
