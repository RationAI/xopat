/**
 * Tailwind preset discovery for deployment themes.
 *
 * An element (module or plugin) may ship `tailwind.preset.js` next to its
 * `include.json`. Its contract is narrow: `daisyui.themes` (extra named
 * themes) and `theme.extend` (fonts, radii, shadows). The core
 * `tailwind.config.js` stays the source of truth for content, safelist and
 * plugins. `XOPAT_TW_PRESET` adds presets outside the repository (a Docker
 * bind mount), as a `path.delimiter`-separated list.
 *
 * Shared by `tailwind.config.js` (to apply them) and the `twinc` watcher (to
 * rebaseline when one changes), so both agree on the same file set.
 */
const fs = require("fs");
const path = require("path");

const PRESET_FILE = "tailwind.preset.js";

function findPresetFiles(root = path.resolve(__dirname, "..", "..", ".."), env = process.env) {
    const files = [];
    for (const dir of ["modules", "plugins"]) {
        let entries;
        try {
            entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            // Linked-in elements (ln -s) are directories too.
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const file = path.join(root, dir, entry.name, PRESET_FILE);
            if (fs.existsSync(file)) files.push(file);
        }
    }
    const extra = String(env.XOPAT_TW_PRESET || "").split(path.delimiter).map(s => s.trim()).filter(Boolean);
    for (const p of extra) {
        const file = path.resolve(root, p);
        if (fs.existsSync(file)) files.push(file);
        else console.warn(`[tailwind-presets] XOPAT_TW_PRESET entry not found: ${p}`);
    }
    return [...new Set(files)].sort();
}

function loadPresets(files) {
    return files.map(file => {
        delete require.cache[require.resolve(file)];
        return { file, preset: require(file) };
    });
}

/**
 * Tailwind replaces a preset's top-level keys other than `theme` with the main
 * config's, so preset DaisyUI themes would be dropped. Append them to the core
 * list explicitly. Core names win: a preset may add themes, never replace one.
 *
 * @param {Array<object|string>} coreThemes  DaisyUI `themes` array of the core config
 * @param {Array<{file: string, preset: object}>} presets
 */
function mergeDaisyThemes(coreThemes, presets) {
    const nameOf = (t) => typeof t === "string" ? [t] : Object.keys(t || {});
    const taken = new Set(coreThemes.flatMap(nameOf));
    const result = [...coreThemes];
    for (const { file, preset } of presets) {
        const themes = preset?.daisyui?.themes;
        if (!Array.isArray(themes)) continue;
        for (const theme of themes) {
            if (typeof theme === "string") {
                // A bare name selects a DaisyUI built-in theme.
                if (!taken.has(theme)) { taken.add(theme); result.push(theme); }
                continue;
            }
            const kept = {};
            for (const [name, def] of Object.entries(theme || {})) {
                if (taken.has(name)) {
                    console.warn(`[tailwind-presets] ${file}: theme "${name}" already defined, skipped.`);
                    continue;
                }
                taken.add(name);
                kept[name] = def;
            }
            if (Object.keys(kept).length) result.push(kept);
        }
    }
    return result;
}

module.exports = { PRESET_FILE, findPresetFiles, loadPresets, mergeDaisyThemes };
