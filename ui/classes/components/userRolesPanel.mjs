import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span } = van.tags;

/**
 * Reactive read-only panel showing the current user's assigned roles.
 * Subscribes to `roles-changed` on `XOpatUser` and re-renders the chip list
 * whenever the assignment changes (deployment default → resolver plugin →
 * logout etc.). See src/USER_ROLES.md.
 *
 * v1 is display-only; no editing affordances. A future admin-mode toggle
 * could let users with the right capability tab into role overrides.
 */
export class UserRolesPanel extends BaseComponent {
    constructor(options) {
        super(options);
        const user = window.XOpatUser?.instance?.();
        this._user = user;
        this._roles = van.state(user?.currentRoles?.() ?? []);

        if (user) {
            this._onRolesChanged = (e) => {
                this._roles.val = Array.isArray(e?.roles) ? e.roles.slice() : (user.currentRoles?.() ?? []);
            };
            user.addHandler('roles-changed', this._onRolesChanged);
        }
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

        return div({ class: "p-2 flex flex-col gap-1" },
            div({ class: "text-xs uppercase tracking-wide text-base-content/60" },
                () => $.t(labelKey())),
            () => renderRoles(),
        );
    }

    /** Drop the event subscription. Called by the host when the panel is unmounted. */
    dispose() {
        if (this._user && this._onRolesChanged) {
            this._user.removeHandler('roles-changed', this._onRolesChanged);
            this._onRolesChanged = null;
        }
    }
}
