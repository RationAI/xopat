/**
 * `ui/services/appBarActions.mjs` — regression suite.
 *
 * Two things here are worth a test rather than a manual click-through:
 *
 *  - `QuickActionsBar.sanitizePins` is a **security control**, not formatting.
 *    The per-user pin list is resolved through `APPLICATION_CONTEXT.getOption`,
 *    which reads session params first — i.e. a URL param or an imported peer
 *    session (AGENTS.md §7). Object entries there must be reduced to bare ids,
 *    or a hostile bundle could relabel `tools:core.sync.reset` as "Save" with a
 *    floppy icon next to the real Save, and `componentIconNode` accepts image
 *    URLs, so `icon` would double as an outbound beacon.
 *  - the catalogue's aggregation / dedupe / rAF-coalescing, which the renderer
 *    depends on for correctness (a missed coalesce re-renders a button from
 *    inside its own click handler).
 *
 * The catalogue has no DOM dependencies by design, so this runs in bare node —
 * only a `window`/`$`/rAF shim is needed for the module's globals.
 *
 * Run: npm test -- --grep "legacy: ui/appbar-actions"
 */
import { pathToFileURL } from "node:url";
import { fromRoot } from "@xopat/test-harness/paths";

let failed = 0;
let n = 0;
function ok(name, cond, detail) {
    n++;
    if (cond) {
        console.log(`ok ${n} - ${name}`);
    } else {
        failed++;
        console.log(`not ok ${n} - ${name}${detail ? `\n  ${detail}` : ""}`);
    }
}

// ── globals the ui/ modules expect ──────────────────────────────────────────
globalThis.window = globalThis;
globalThis.$ = { t: (key) => String(key).split(".").pop() };
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
const flushRaf = () => { const q = rafQueue.splice(0); for (const fn of q) fn(); };

const { AppBarActions, QuickActionsBar } = await import(
    pathToFileURL(fromRoot("ui", "services", "appBarActions.mjs")).href);

// ── fakes mirroring the AppBar.Tools / AppBar.View contracts ────────────────
function makeTools() {
    const entries = new Map();
    const subs = new Set();
    return {
        _entries: entries,
        list: () => [...entries].map(([id, e]) => ({ id, ...e })),
        onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
        _notify() { for (const cb of [...subs]) cb(); },
        register(id, opts) { entries.set(id, { ...entries.get(id), ...opts }); this._notify(); },
        unregister(id) { entries.delete(id); this._notify(); },
        setDisabled(id, disabled) { const e = entries.get(id); if (e) { e.disabled = !!disabled; this._notify(); } },
    };
}

function makeVm(visible = true) {
    let state = visible;
    const handlers = new Set();
    return {
        is: () => state,
        set(v) { state = !!v; for (const h of handlers) h(state); },
        onChange(h) { handlers.add(h); return () => handlers.delete(h); },
        _handlerCount: () => handlers.size,
    };
}

function makeView(rows = []) {
    const subs = new Set();
    return {
        _rows: rows,
        list() { return this._rows; },
        onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
        _notify() { for (const cb of [...subs]) cb(); },
        _setVisibility(vm, v) { vm.set(v); },
        toggleRow(row) {
            const next = !row.vms.some(vm => vm.is());
            for (const vm of row.vms) this._setVisibility(vm, next);
            this._notify();
        },
    };
}

// ── 1. aggregation, key namespacing, pinnable ───────────────────────────────
{
    const Tools = makeTools();
    Tools.register("core.screenshot", { label: "Screenshot", icon: "ph-camera", onClick: () => {} });
    Tools.register("inspector.visualization", { label: "Inspect", children: [{ id: "a" }], onClick: () => {} });
    const vm = makeVm(true);
    const View = makeView([{ id: "navigator", icon: "ph-map", label: "Navigator", vms: [vm], category: "sideViewerMenu", group: "Sidebars" }]);

    const actions = new AppBarActions({ Tools, View }).init();
    const keys = actions.list().map(d => d.key);

    ok("tools entries are namespaced", keys.includes("tools:core.screenshot"), keys.join());
    ok("view rows are namespaced with their category",
        keys.includes("view:sideViewerMenu.navigator"), keys.join());
    ok("submenu-bearing tools entries are listed but not pinnable",
        actions.get("tools:inspector.visualization")?.pinnable === false);
    ok("view descriptors carry toggle state",
        actions.get("view:sideViewerMenu.navigator")?.selected === true);

    // raw ids keep their dots AND colons — key splits on the FIRST colon only
    actions.register("ns:with:colons", { label: "X", invoke: () => {} });
    ok("register() splits the key on the first colon only",
        actions.get("custom:ns:with:colons")?.rawId === "ns:with:colons");
}

// ── 2. invoke() gating + live handler re-read ───────────────────────────────
{
    const Tools = makeTools();
    let calls = 0;
    Tools.register("a.thing", { label: "Thing", onClick: () => { calls = -1; } });
    // A re-register swaps the handler: the catalogue must not fire the stale one.
    Tools.register("a.thing", { onClick: () => { calls += 1; } });

    const actions = new AppBarActions({ Tools, View: makeView() }).init();
    ok("invoke() runs the action", actions.invoke("tools:a.thing") === true && calls === 1);
    ok("invoke() re-reads the live handler after a re-register", calls === 1);

    Tools.setDisabled("a.thing", true);
    ok("invoke() refuses a disabled action", actions.invoke("tools:a.thing") === false && calls === 1);

    Tools.setDisabled("a.thing", false);
    Tools.register("sub.menu", { label: "Sub", children: [{ id: "x" }], onClick: () => { calls += 100; } });
    ok("invoke() refuses a non-pinnable action", actions.invoke("tools:sub.menu") === false && calls === 1);
    ok("invoke() refuses an unknown key", actions.invoke("tools:nope") === false);
    ok("invoke() refuses a key with no provider", actions.invoke("bogus:nope") === false);
}

// ── 3. change notification is rAF-coalesced ─────────────────────────────────
{
    const Tools = makeTools();
    const actions = new AppBarActions({ Tools, View: makeView() }).init();
    flushRaf();

    let changes = 0;
    actions.onChange(() => changes++);
    for (let i = 0; i < 50; i++) Tools.register(`x.${i}`, { label: `x${i}`, onClick: () => {} });
    ok("50 synchronous mutations do not notify synchronously", changes === 0);
    flushRaf();
    ok("50 synchronous mutations coalesce into one change", changes === 1, `got ${changes}`);
}

// ── 4. late registration: the catalogue is live, no pending queue ───────────
{
    const Tools = makeTools();
    const actions = new AppBarActions({ Tools, View: makeView() }).init();
    flushRaf();
    let changes = 0;
    actions.onChange(() => changes++);

    ok("catalogue starts empty", actions.list().length === 0);
    Tools.register("late.arrival", { label: "Late", onClick: () => {} });
    flushRaf();
    ok("a late registrant notifies once", changes === 1, `got ${changes}`);
    ok("a late registrant appears without any pending-pin machinery",
        !!actions.get("tools:late.arrival"));
}

// ── 5. view provider rebinds per-VisibilityManager handles ──────────────────
{
    const vmA = makeVm(true);
    const View = makeView([{ id: "a", label: "A", vms: [vmA], category: null, group: "View" }]);
    const actions = new AppBarActions({ Tools: makeTools(), View }).init();
    flushRaf();
    let changes = 0;
    actions.onChange(() => changes++);

    vmA.set(false);
    flushRaf();
    ok("a visibility flip outside the registry still notifies", changes === 1, `got ${changes}`);

    // A viewer closing replaces the row set; the old VM handle must be dropped.
    const vmB = makeVm(true);
    View._rows = [{ id: "b", label: "B", vms: [vmB], category: null, group: "View" }];
    View._notify();
    flushRaf();
    ok("stale VisibilityManager handles are released on a registry change",
        vmA._handlerCount() === 0, `still ${vmA._handlerCount()}`);
    ok("the replacement VisibilityManager is subscribed", vmB._handlerCount() === 1);
}

// ── 6. sanitizePins — the security matrix ───────────────────────────────────
{
    const S = (raw, trusted) => QuickActionsBar.sanitizePins(raw, trusted);

    const hostile = S([{ id: "tools:core.sync.reset", label: "Save", icon: "https://evil.example/x.png" }], false);
    ok("untrusted object entries are reduced to their id",
        hostile.length === 1 && hostile[0].id === "tools:core.sync.reset"
        && hostile[0].label === undefined && hostile[0].icon === undefined,
        JSON.stringify(hostile));

    const env = S([{ id: "tools:x", label: "Align", icon: "ph-crosshairs-simple" }], true);
    ok("trusted (ENV) object entries keep icon/label overrides",
        env[0].label === "Align" && env[0].icon === "ph-crosshairs-simple");

    ok("plain id strings pass through", S(["tools:a", "view:b"], false).map(e => e.id).join() === "tools:a,view:b");
    ok("AppCache JSON strings are accepted", S('["tools:a"]', false)[0]?.id === "tools:a");
    ok("malformed JSON yields an empty list", S("{not json", false).length === 0);
    ok("non-arrays yield an empty list", S({ id: "tools:a" }, false).length === 0 && S(null, true).length === 0);
    ok("non-string ids are dropped", S([1, null, {}, { id: 5 }, "tools:a"], false).map(e => e.id).join() === "tools:a");
    ok("duplicates are dropped, order preserved",
        S(["b", "a", "b"], false).map(e => e.id).join() === "b,a");
    ok("the list is capped",
        S(Array.from({ length: 100 }, (_, i) => `id${i}`), false).length === QuickActionsBar.MAX_PINS);
}

// ── 7. provider failure is contained ────────────────────────────────────────
{
    const actions = new AppBarActions({ Tools: makeTools(), View: makeView() }).init();
    actions.registerProvider({
        id: "broken",
        list: () => { throw new Error("boom"); },
        subscribe: () => () => {},
    });
    actions.register("still.here", { label: "Fine", invoke: () => {} });
    const warn = console.warn;
    console.warn = () => {};
    const list = actions.list();
    console.warn = warn;
    ok("a throwing provider does not take the catalogue down",
        list.some(d => d.key === "custom:still.here"));
}

console.log(`\n1..${n}`);
if (failed) {
    console.error(`${failed} assertion(s) failed.`);
    process.exit(1);
}
console.log("appbar-actions: all assertions passed.");
