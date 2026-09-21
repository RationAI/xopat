import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Checkbox } from "../elements/checkbox.mjs";
import { Button } from "../elements/buttons.mjs";

const { div, span, table, thead, tbody, tr, th, td, code } = van.tags;

/**
 * The current user's roles, and — in debug mode — what those roles actually do.
 *
 * Two audiences in one component. For a normal user it is the read-only chip
 * list: which roles am I in. For whoever is configuring `core.roles` it is the
 * answer to "why is this button dead", which nothing else in the app could tell
 * them: a closed gate looks identical to a missing feature, and the deciding
 * role may be three `extends` levels up from the one that was assigned.
 *
 * The role switcher is debug-mode only ON PURPOSE. It is not an authorization
 * boundary — client roles gate UI, never access (src/USER_ROLES.md) — so
 * letting a developer flip them locally costs nothing a devtools console could
 * not already do, and makes the deployment's own config testable without an
 * identity provider. It is hidden in production because a "change my role"
 * control invites exactly the misreading the docs warn about.
 *
 * Subscribes to `roles-changed` and `capabilities-changed`; lazily-loaded
 * plugins declare capabilities after mount, so the table must not be a snapshot.
 */
export class UserRolesPanel extends BaseComponent {
    constructor(options) {
        super(options);
        const user = window.XOpatUser?.instance?.();
        this._user = user;
        this._roles = van.state(user?.currentRoles?.() ?? []);
        // Bumped to force a re-read of the (non-reactive) capability registry.
        this._revision = van.state(0);

        if (user) {
            this._onRolesChanged = (e) => {
                this._roles.val = Array.isArray(e?.roles) ? e.roles.slice() : (user.currentRoles?.() ?? []);
            };
            this._onCapsChanged = () => { this._revision.val = this._revision.val + 1; };
            user.addHandler('roles-changed', this._onRolesChanged);
            user.addHandler('capabilities-changed', this._onCapsChanged);
            user.addHandler('capability-declared', this._onCapsChanged);
        }
    }

    /** Whether the deployment is in developer mode. */
    get _debug() {
        return !!window.APPLICATION_CONTEXT?.getOption?.("debugMode");
    }

    /** BaseComponent contract: return a single root Node. */
    create() {
        const labelKey = () => (this._roles.val.length > 1 ? "user.roles.titlePlural" : "user.roles.title");

        const renderRoles = () => {
            const ids = this._roles.val;
            if (!ids.length) {
                return span({ class: "text-base-content/60 italic text-sm" },
                    () => $.t("user.roles.none"));
            }
            return div({ class: "flex flex-wrap gap-1" },
                ...ids.map(id => {
                    const desc = window.XOpatUser?.describeRole?.(id);
                    const label = desc?.label ?? id;
                    return span({
                        class: "badge badge-sm badge-outline",
                        title: id !== label ? id : undefined,
                    }, label);
                }));
        };

        return div({ class: "p-2 flex flex-col gap-2" },
            div({ class: "text-xs uppercase tracking-wide text-base-content/60" },
                () => $.t(labelKey())),
            () => renderRoles(),
            () => this._renderRestricted(),
            () => this._debug ? this._renderSwitcher() : null,
            () => this._debug ? this._renderCapabilities() : null,
        );
    }

    /**
     * What this role cannot do — always visible, and empty for most users.
     *
     * This is the other half of not interrupting people. Refusals for work the
     * user never requested are silenced at the pipeline
     * (`IOContext.trigger`), which would otherwise leave a restricted user with
     * inert features and no explanation anywhere. Restriction becomes something
     * you can look up instead of something you get told four times at boot.
     *
     * Grouped by declaring owner because "annotations" is the unit a user
     * thinks in; a flat list of `annotations.crud:preset.update` is a debugging
     * aid, and that one already exists below, in debug mode.
     */
    _renderRestricted() {
        void this._revision.val;
        void this._roles.val;
        const explained = this._user?.explainCapabilities?.() ?? {};
        const descriptors = window.XOpatUser?.listCapabilities?.() ?? [];
        const byId = new Map(descriptors.map(d => [d.id, d]));

        const groups = new Map();
        for (const id of Object.keys(explained)) {
            if (explained[id].value !== false) continue;
            const owner = byId.get(id)?.declaredBy ?? "";
            if (!groups.has(owner)) groups.set(owner, []);
            // `capabilityLabel`, not `desc.label`: one `io.capabilities` entry
            // derives four capabilities that share its label, so the raw label
            // rendered "Annotation" four times over with no way to tell the
            // read gate from the delete gate.
            groups.get(owner).push({ id, label: window.XOpatUser.capabilityLabel(id) });
        }
        // Nothing restricted is the common case; say nothing rather than
        // render an empty "restricted" heading that reads like a warning.
        if (!groups.size) return null;

        return div({ class: "flex flex-col gap-1 border-t border-base-300 pt-2" },
            div({ class: "text-xs uppercase tracking-wide text-base-content/60" },
                $.t("user.roles.restricted")),
            div({ class: "text-xs text-base-content/60" }, $.t("user.roles.restrictedHint")),
            ...Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(
                ([owner, caps]) => div({ class: "flex flex-wrap items-baseline gap-1" },
                    span({ class: "text-xs font-semibold" }, owner || $.t("user.roles.title")),
                    ...caps
                        .sort((a, b) => a.label.localeCompare(b.label))
                        .map(c => span({
                            class: "badge badge-sm badge-ghost",
                            title: c.id,
                        }, c.label)),
                )),
        );
    }

    /**
     * Role switcher: one checkbox per role the deployment defines.
     *
     * Assignment order matters to the resolver (later roles override earlier
     * ones), so the catalogue order is preserved rather than click order —
     * otherwise toggling the same two roles in a different sequence would
     * produce a different verdict and look like a bug in the resolver.
     */
    _renderSwitcher() {
        const catalogue = window.XOpatUser?.listRoles?.() ?? [];
        if (!catalogue.length) {
            return div({ class: "text-xs text-base-content/60 italic" },
                $.t("user.roles.noRolesDefined"));
        }
        const assigned = this._roles.val;
        const toggle = (id, on) => {
            const next = catalogue
                .map(r => r.id)
                .filter(rid => rid === id ? on : this._user?.currentRoles?.().includes(rid));
            this._user?.assignRoles?.(next);
        };
        const reset = new Button({
            size: Button.SIZE?.SMALL,
            onClick: () => this._user?.clearRoles?.(),
        }, $.t("user.roles.resetToDefault"));

        return div({ class: "flex flex-col gap-1 border-t border-base-300 pt-2" },
            div({ class: "text-xs uppercase tracking-wide text-base-content/60" },
                $.t("user.roles.devSwitch")),
            div({ class: "flex flex-wrap gap-3" },
                ...catalogue.map(role => new Checkbox({
                    label: role.label ?? role.id,
                    checked: assigned.includes(role.id),
                    onchange: (e) => toggle(role.id, !!e.target.checked),
                }).create())),
            div({ class: "pt-1" }, reset.create()),
        );
    }

    /**
     * Every declared capability, its verdict, and the role that decided it.
     *
     * Ids nobody declared are absent by construction (`explainCapabilities`
     * lists the registry): `can()` answers `true` for those, and showing them as
     * "allowed" would imply a gate that does not exist — which is the single
     * most expensive misunderstanding in this subsystem, because a typo'd
     * capability id is a permanently open gate.
     */
    _renderCapabilities() {
        void this._revision.val;   // subscribe: the registry itself is not reactive
        void this._roles.val;
        const explained = this._user?.explainCapabilities?.() ?? {};
        const ids = Object.keys(explained).sort();
        if (!ids.length) {
            return div({ class: "text-xs text-base-content/60 italic" },
                $.t("user.roles.noCapabilities"));
        }
        return div({ class: "flex flex-col gap-1 border-t border-base-300 pt-2" },
            div({ class: "text-xs uppercase tracking-wide text-base-content/60" },
                $.t("user.roles.effective")),
            // Capability ids are long; let the table scroll rather than the page.
            div({ class: "overflow-x-auto max-h-64 overflow-y-auto" },
                table({ class: "table table-xs" },
                    thead(tr(
                        th($.t("user.roles.capability")),
                        th($.t("user.roles.verdict")),
                        th($.t("user.roles.decidedBy")),
                    )),
                    tbody(...ids.map(id => {
                        const e = explained[id];
                        return tr(
                            // The ID stays primary here on purpose: this table
                            // is for whoever writes `core.roles`, and the id is
                            // what they type. The human label rides along as a
                            // tooltip rather than replacing it.
                            td(code({
                                class: "text-xs",
                                title: window.XOpatUser.capabilityLabel(id),
                            }, id)),
                            td(span({
                                class: e.value
                                    ? "badge badge-xs badge-success"
                                    : "badge badge-xs badge-error",
                            }, e.value ? $.t("user.roles.allowed") : $.t("user.roles.denied"))),
                            td({ class: "text-xs text-base-content/70" },
                                e.decidedBy
                                    ? `${e.decidedBy} (${e.pattern})`
                                    : $.t("user.roles.byDefault")),
                        );
                    })),
                )),
        );
    }

    /** Drop the event subscriptions. Called by the host when the panel is unmounted. */
    dispose() {
        if (!this._user) return;
        if (this._onRolesChanged) {
            this._user.removeHandler('roles-changed', this._onRolesChanged);
            this._onRolesChanged = null;
        }
        if (this._onCapsChanged) {
            this._user.removeHandler('capabilities-changed', this._onCapsChanged);
            this._user.removeHandler('capability-declared', this._onCapsChanged);
            this._onCapsChanged = null;
        }
    }
}
