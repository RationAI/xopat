import { PhIcon } from "./ph-icon.mjs";

let deprecationWarned = false;

/**
 * @class FAIcon
 * @extends PhIcon
 * @deprecated Font Awesome is no longer shipped. This is a back-compatibility
 * alias for third-party plugins that still call `new UI.FAIcon(...)`: it renders
 * a Phosphor icon and best-effort translates a legacy `fa-*` name. New code must
 * use {@link PhIcon} with a native Phosphor name.
 */
class FAIcon extends PhIcon {

    /**
     * @param {*} options either the icon name or an options object
     * @param {string} [options.name] legacy `fa-*` (translated) or `ph-*` name
     * @param  {...any} args
     */
    constructor(options = undefined, ...args) {
        if (typeof options === "string") {
            options = { name: options };
        }
        if (options && typeof options === "object" && options.name) {
            options = { ...options, name: FAIcon.toPhosphorName(options.name) };
        }
        super(options, ...args);

        if (!deprecationWarned) {
            deprecationWarned = true;
            console.warn("UI.FAIcon is deprecated: Font Awesome is no longer shipped. Use UI.PhIcon with a Phosphor name.");
        }
    }

    /**
     * @param {string} name new icon name, `fa-*` names are translated
     */
    changeIcon(name) {
        super.changeIcon(FAIcon.toPhosphorName(name));
    }

    /**
     * Translate a legacy Font Awesome class to its Phosphor counterpart. Names
     * that are already Phosphor (or unknown) pass through unchanged - an unknown
     * name renders as nothing rather than as the wrong glyph.
     * @param {string} name
     * @return {string}
     */
    static toPhosphorName(name) {
        const tokens = String(name ?? "").trim().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
            if (token.startsWith("ph-") && token !== "ph-light") return token;
        }
        for (const token of tokens) {
            const mapped = FAIcon.LEGACY_MAP[token];
            if (mapped) return mapped;
        }
        return "";
    }
}

/**
 * Legacy `fa-*` to Phosphor translation table. Covers the names xOpat itself
 * used before the migration plus their common aliases; it is a courtesy for
 * third-party callers, not a surface to extend.
 * @type {Object<string,string>}
 */
FAIcon.LEGACY_MAP = {
    "fa-angle-down": "ph-caret-down",
    "fa-angle-left": "ph-caret-left",
    "fa-angle-right": "ph-caret-right",
    "fa-angle-up": "ph-caret-up",
    "fa-arrow-left": "ph-arrow-left",
    "fa-arrow-right": "ph-arrow-right",
    "fa-arrows-up-down": "ph-arrows-vertical",
    "fa-backward": "ph-rewind",
    "fa-bars": "ph-list",
    "fa-camera": "ph-camera",
    "fa-caret-down": "ph-caret-down",
    "fa-check": "ph-check",
    "fa-chevron-down": "ph-caret-down",
    "fa-chevron-left": "ph-caret-left",
    "fa-chevron-right": "ph-caret-right",
    "fa-chevron-up": "ph-caret-up",
    "fa-circle": "ph-circle",
    "fa-circle-dot": "ph-record",
    "fa-circle-info": "ph-info",
    "fa-circle-user": "ph-user-circle",
    "fa-close": "ph-x",
    "fa-cog": "ph-gear",
    "fa-cogs": "ph-gear-six",
    "fa-comment-medical": "ph-chat-teardrop-dots",
    "fa-comments": "ph-chats",
    "fa-copy": "ph-copy",
    "fa-display": "ph-monitor",
    "fa-download": "ph-download",
    "fa-ellipsis-h": "ph-dots-three",
    "fa-ellipsis-vertical": "ph-dots-three-vertical",
    "fa-envelope": "ph-envelope",
    "fa-eye": "ph-eye",
    "fa-eye-slash": "ph-eye-slash",
    "fa-file": "ph-file",
    "fa-film": "ph-film-strip",
    "fa-filter": "ph-funnel",
    "fa-flask": "ph-flask",
    "fa-folder": "ph-folder",
    "fa-forward": "ph-fast-forward",
    "fa-gauge": "ph-gauge",
    "fa-gear": "ph-gear",
    "fa-grip-lines": "ph-dots-six",
    "fa-headset": "ph-headset",
    "fa-home": "ph-house",
    "fa-house": "ph-house",
    "fa-image": "ph-image",
    "fa-images": "ph-images",
    "fa-info-circle": "ph-info",
    "fa-layer-group": "ph-stack",
    "fa-link": "ph-link",
    "fa-lock": "ph-lock",
    "fa-lock-open": "ph-lock-open",
    "fa-magnifying-glass": "ph-magnifying-glass",
    "fa-minus": "ph-minus",
    "fa-panorama": "ph-panorama",
    "fa-paper-plane": "ph-paper-plane-tilt",
    "fa-pen": "ph-pencil-simple",
    "fa-pen-to-square": "ph-note-pencil",
    "fa-play": "ph-play",
    "fa-plus": "ph-plus",
    "fa-question": "ph-question",
    "fa-question-circle": "ph-question",
    "fa-readme": "ph-book-open",
    "fa-right-to-bracket": "ph-sign-in",
    "fa-rotate": "ph-arrows-clockwise",
    "fa-school": "ph-graduation-cap",
    "fa-search": "ph-magnifying-glass",
    "fa-shapes": "ph-shapes",
    "fa-shield-halved": "ph-shield-check",
    "fa-sliders": "ph-sliders-horizontal",
    "fa-square": "ph-square",
    "fa-star": "ph-star",
    "fa-stop": "ph-stop",
    "fa-tag": "ph-tag",
    "fa-times": "ph-x",
    "fa-trash": "ph-trash",
    "fa-trash-can": "ph-trash-simple",
    "fa-triangle-exclamation": "ph-warning",
    "fa-exclamation-triangle": "ph-warning",
    "fa-up-down-left-right": "ph-arrows-out-cardinal",
    "fa-up-right-from-square": "ph-arrow-square-out",
    "fa-upload": "ph-upload",
    "fa-user": "ph-user",
    "fa-users": "ph-users",
    "fa-warning": "ph-warning",
    "fa-wrench": "ph-wrench",
    "fa-xmark": "ph-x",
};

export { FAIcon };
