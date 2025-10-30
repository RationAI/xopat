import van from "../../ui/vanjs.mjs";
import { BaseComponent } from "../../ui/classes/baseComponent.mjs";
import { Dropdown } from "../../ui/classes/elements/dropdown.mjs";
import { NewAppForm } from "./newAppForm.mjs";

const { div } = van.tags;

class AnalyzeDropdown extends BaseComponent {
    constructor(options = {}) {
        // initialize BaseComponent (it sets up this.options)
        super(options);
        this.options = this.options || options;

        // recent jobs state
        this.recentOpen = false;

        // Dropdown instance that does most of the rendering/behaviour
        // Start with minimal items; callers may add items dynamically via addItem()/addSection().
        const items = [
            { id: "run-recent", label: "Run Recent", onClick: () => this._toggleRecent() },
            { id: "create-app", label: "Create New App", onClick: () => this._openNewAppForm() }
        ];

        this.dropdown = new Dropdown({
            parentId: options.parentId || "analyze",
            title: options.title || "Analyze",
            items,
            sections: [{ id: "main", title: "" }],
            widthClass: options.widthClass || "w-48",
            closeOnItemClick: options.closeOnItemClick ?? true,
        });

        // stash recent job list (array of strings or objects) and callback
        this.recentJobs = options.recentJobs || [];
        this.onJobClick = options.onJobClick;
        // Note: expose headerButton via a getter below so the Menu can access
        // it even if Dropdown creates it lazily.
    }

    // Expose headerButton so Menu.addTab can style and attach it like other tabs
    get headerButton() { return this.dropdown?.headerButton; }

    _openNewAppForm() {
        // open NewAppForm in provided workspace (or default id "workspace")
        const wsId = this.options.workspaceId || "workspace";
        const ws = document.getElementById(wsId);
        if (!ws) return console.warn("AnalyzeDropdown: workspace element not found:", wsId);
        ws.innerHTML = ""; // replace content like original code
        const form = new NewAppForm({
            onSubmit: (data) => {
                // keep behavior minimal — plugin may override
                if (this.options.onCreate?.(data) !== false) {
                    // default quick feedback
                    // eslint-disable-next-line no-alert
                    alert("Created new app: " + JSON.stringify(data));
                }
            }
        });
        form.attachTo(ws);
        // close dropdown after action
        this.dropdown.close();
    }

    _toggleRecent() {
        this.recentOpen = !this.recentOpen;
        if (this.recentOpen) this._showRecent();
        else this._removeRecent();
    }

    _showRecent() {
        // create 'recent' section and add items for each job
        this.dropdown.addSection({ id: "recent", title: "Recent" });
        // add jobs as items, using stable ids to support removal
        const jobs = this.recentJobs || [];
        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            const label = (typeof job === "string") ? job : (job.label || job.name || String(job));
            const itemId = `recent-${i}`;
            this.dropdown.addItem({
                id: itemId,
                label,
                section: "recent",
                onClick: (ev, it) => {
                    this.onJobClick?.(job);
                    if (this.dropdown.closeOnItemClick) this.dropdown.close();
                }
            }, "Recent");
        }
    }

    _removeRecent() {
        // remove items that belong to recent section from internal items map
        for (const key of Object.keys(this.dropdown.items)) {
            if (key?.toString?.().startsWith("recent-")) delete this.dropdown.items[key];
        }
        // remove recent section from declared sections
        this.dropdown.sections = (this.dropdown.sections || []).filter(s => s.id !== "recent");
        // force a rebuild
        if (typeof this.dropdown._rebuildContent === "function") this.dropdown._rebuildContent();
    }

    // expose API to update recent jobs list
    setRecentJobs(jobs = []) {
        this.recentJobs = jobs;
        if (this.recentOpen) {
            this._removeRecent();
            this._showRecent();
        }
    }

    // Allow adding arbitrary analysis items dynamically. This delegates to Dropdown.addItem.
    addItem(item, sectionTitleIfNew = "") {
        this.dropdown.addItem(item, sectionTitleIfNew);
    }

    // Allow adding a named section
    addSection(section) {
        this.dropdown.addSection(section);
    }

    // BaseComponent contract: return a node
    create() {
        // Delegate rendering to Dropdown component; keep wrapper for consistent attach points
        const node = this.dropdown.create();
        return div({ class: "inline-block min-w-[180px]" }, node);
    }

    // Make AnalyzeDropdown behave like a MenuTab/Dropdown for the menu system
    attachTo(target) {
        // Delegate to the underlying Dropdown.attachTo if available
        if (this.dropdown && typeof this.dropdown.attachTo === 'function') {
            return this.dropdown.attachTo(target);
        }
        // Fallback: use BaseComponent.attachTo
        return super.attachTo(target);
    }

    // Proxy visual helper methods expected by Menu/MenuTab
    iconOnly() { if (this.dropdown?.iconOnly) return this.dropdown.iconOnly(); }
    titleOnly() { if (this.dropdown?.titleOnly) return this.dropdown.titleOnly(); }
    titleIcon() { if (this.dropdown?.titleIcon) return this.dropdown.titleIcon(); }
    iconRotate() { if (this.dropdown?.iconRotate) return this.dropdown.iconRotate(); }
    close() { if (this.dropdown?.close) return this.dropdown.close(); }
    _removeFocus() { if (this.dropdown?._removeFocus) return this.dropdown._removeFocus(); }

    // expose contentDiv if underlying dropdown provides it (some systems expect it)
    get contentDiv() { return this.dropdown?.contentDiv; }
}

export { AnalyzeDropdown };
