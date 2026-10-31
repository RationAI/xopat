import type {ScriptApiAssistantHints} from "./abstract-types";

/**
 * What the `ui` namespace tells an assistant about itself (`ScriptApiMetadata.assistant`).
 * Without it the model answers "where is X" from training data about other viewers —
 * inventing menus that do not exist here.
 */
export const UI_ASSISTANT_HINTS: ScriptApiAssistantHints = {
    intentPatterns: [
        /\bwhere (is|are|can|do)\b|\bhow (do|can) i\b|\bmenu|\bpanel|\bbutton|\btoolbar|\bsettings?\b|\bshortcut|\bhotkey|\bkeyboard\b|\bshow me\b|\bopen (the|my)\b|\bfind (the|a)\b/i,
    ],
    framing: `### Interface questions — explore, never guess
- Never describe, name or promise a menu, panel, button, setting or shortcut you have not seen in \`ui\` results this conversation. "Where is…", "how do I…", "open…", "show me…" start with \`ui.listUi({ query })\` (a few words; retry with a synonym once) or \`ui.listUi()\` to browse top-level elements and \`ui.listUi({ parent: id })\` to drill down.
- Quote elements by their \`label\` and click path (\`path\`), never by id. A shortcut is answered with its \`shortcut\` combination.
- To guide the user, call \`ui.showUi(id, { message })\` — it opens the parents and highlights the element with your short plain-text message. To just open something, \`ui.openUi(id)\`.
- \`ui.invokeUiAction(id)\` triggers an element as a click would; use it only when the user asked for that action, and prefer showing over doing when they asked how.
- If nothing matches, say the viewer does not offer it — do not substitute a similar-sounding feature from another product.`,
};
