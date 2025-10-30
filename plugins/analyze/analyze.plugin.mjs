import { Dropdown } from "../../ui/classes/elements/dropdown.mjs";
import { NewAppForm } from "./newAppForm.mjs";

addPlugin('analyze', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.params = params || {};
        // plugin-level stored recent jobs can be configured via params or saved options
        this.recentJobs = this.getOption('recentJobs') || this.params.recentJobs || [];
    }

    pluginReady() {
        // register tab in AppBar. AppBar.addTab will call `new AnalyzeDropdown(item, menu)` internally
        const register = () => {
            console.log('[analyze] pluginReady: register called, checking AppBar availability');
            if (!window.USER_INTERFACE || !USER_INTERFACE.AppBar || !USER_INTERFACE.AppBar.menu) {
                console.log('[analyze] AppBar not ready yet, retrying shortly');
                // retry shortly if AppBar not ready yet
                return setTimeout(register, 50);
            }

                // safe translation helper: return translated value or fallback when missing
                const tOr = (key, fallback) => {
                    if (typeof $?.t === 'function') {
                        try {
                            const translated = $.t(key);
                            if (translated && translated !== key) return translated;
                        } catch (e) { /* ignore and fallback */ }
                    }
                    return fallback;
                };

                const title = tOr('analyze.title', 'Analyze');
                console.log('[analyze] calling USER_INTERFACE.AppBar.addTab', { id: this.id, title, itemClass: Dropdown });
                const tab = USER_INTERFACE.AppBar.addTab(
                    this.id,                    // ownerPluginId
                    title,                     // title (localized if available)
                    'fa-magnifying-glass',      // icon
                    [],                         // body
                    Dropdown                    // itemClass so Menu constructs plugin component
                );

                // Ensure clicking the Analyze header toggles the dropdown visibility.
                // The Dropdown's button element gets id `${parentId}-b-${id}`; find it
                // and attach a click listener to toggle the closest `.dropdown` wrapper.
                if (tab) {
                    const attachToggle = () => {
                        try {
                            const btnId = `${tab.parentId}-b-${tab.id}`;
                            const btnEl = document.getElementById(btnId);
                            if (!btnEl) return false;

                            // If a dropdown wrapper already exists, attach listener directly
                            let wrapper = btnEl.closest('.dropdown');
                            if (!wrapper) {
                                // Create the dropdown wrapper on-demand so content is rendered
                                try {
                                    const newWrapper = tab.create();
                                    const parent = btnEl.parentElement;
                                    if (parent) {
                                        parent.insertBefore(newWrapper, btnEl);
                                        // remove the old button node (avoid duplicates)
                                        btnEl.remove();
                                        wrapper = newWrapper;
                                    }
                                } catch (e) {
                                    console.error('[analyze] failed to create dropdown wrapper on demand', e);
                                }
                            }

                            if (wrapper) {
                                // Toggle the visible class on wrapper when clicked
                                const trigger = wrapper.querySelector('[tabindex]') || wrapper;
                                trigger.addEventListener('click', (e) => {
                                    try {
                                        const wasOpen = wrapper.classList.contains('dropdown-open');
                                        wrapper.classList.toggle('dropdown-open');
                                        const nowOpen = wrapper.classList.contains('dropdown-open');
                                        // if dropdown was open and now closed, also remove the recent section
                                        if (wasOpen && !nowOpen) {
                                            try { tab.hideRecent?.(); } catch(_) {}
                                        }
                                    } catch(_) {}
                                    e.stopPropagation();
                                });
                                return true;
                            }
                        } catch (e) { console.error('[analyze] attachToggle error', e); }
                        return false;
                    };
                    // Try immediate attach; if DOM not present yet, retry shortly
                    if (!attachToggle()) setTimeout(attachToggle, 50);
                }

                // Configure dropdown items for the plugin tab
                try {
                    if (tab && typeof tab.addItem === 'function') {
                        // Setup helper functions that use Dropdown API (no direct DOM manipulation)
                        let hideTimer = null;

                        // Floating-panel based show/hide so the recent list appears to the right of dropdown
                        const panelId = `${this.id}-recent-panel`;
                        const createPanel = () => {
                            let panel = document.getElementById(panelId);
                            if (!panel) {
                                panel = document.createElement('div');
                                panel.id = panelId;
                                panel.className = [
                                    'dropdown-content',
                                    'bg-base-200',
                                    'text-base-content',
                                    'rounded-box',
                                    'shadow-xl',
                                    'border',
                                    'border-base-300',
                                    'w-64',
                                    'max-w-full'
                                ].join(' ');
                                Object.assign(panel.style, {
                                    position: 'fixed',
                                    maxHeight: '70vh',
                                    overflow: 'auto',
                                    zIndex: 9999,
                                });
                                document.body.appendChild(panel);

                                // cancel hide while hovering panel
                                panel.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
                                panel.addEventListener('mouseleave', () => { scheduleHide(); });
                            }
                            return panel;
                        };

                        const populatePanel = (panel) => {
                            panel.innerHTML = '';
                            const ul = document.createElement('ul');
                            ul.className = 'menu bg-transparent p-0';
                            ul.setAttribute('role', 'none');
                            const hard = ['Recent Job 1', 'Recent Job 2', 'Recent Job 3'];
                            for (let i = 0; i < hard.length; i++) {
                                const label = hard[i];
                                const li = document.createElement('li');
                                li.setAttribute('role', 'none');
                                const a = document.createElement('a');
                                a.setAttribute('role', 'menuitem');
                                a.setAttribute('tabindex', '-1');
                                a.className = [
                                    'flex', 'items-center', 'gap-3', 'rounded-md',
                                    'px-3', 'py-2', 'hover:bg-base-300', 'focus:bg-base-300'
                                ].join(' ');
                                a.textContent = label;
                                a.addEventListener('click', (e) => {
                                    try { e.stopPropagation(); if (typeof this.onJobClick === 'function') this.onJobClick({ index: i, label }); } catch (err) { console.error(err); }
                                });
                                li.appendChild(a);
                                ul.appendChild(li);
                            }
                            panel.appendChild(ul);
                        };

                        const showRecent = (anchor) => {
                            if (!anchor) return;
                            const panel = createPanel();
                            populatePanel(panel);
                            try {
                                const rect = anchor.getBoundingClientRect();
                                const left = Math.min(window.innerWidth - panel.offsetWidth - 8, rect.right);
                                const top = Math.max(8, rect.top);
                                panel.style.left = left + 'px';
                                panel.style.top = top + 'px';
                            } catch (e) { /* ignore */ }
                            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                        };

                        const hideRecent = () => {
                            try { const p = document.getElementById(panelId); if (p) p.remove(); } catch (e) { /* ignore */ }
                        };

                        // expose helper on the tab so other scopes (toggle handler) can call it
                        try { tab.hideRecent = hideRecent; } catch(e) { /* ignore */ }

                        const scheduleHide = () => {
                            if (hideTimer) clearTimeout(hideTimer);
                            hideTimer = setTimeout(() => { hideRecent(); hideTimer = null; }, 1000);
                        };

                        // Run Recent — shows recent items as an inline section in the dropdown when hovered
                        tab.addItem({ id: 'run-recent', label: `${tOr('analyze.runRecent', 'Run Recent')} \u2192`, onClick: (ev, item) => { try { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); } catch(_){} const anchor = ev?.currentTarget || document.querySelector(`[data-item-id="${item.id}"]`); if (anchor) { showRecent(anchor); } return true; } });

                        // attach hover listeners to the generated anchor element (retry if DOM not present)
                        const attachHover = () => {
                            try {
                                const btnId = `${tab.parentId}-b-${tab.id}`;
                                let btnEl = document.getElementById(btnId);
                                if (!btnEl) return false;

                                // ensure wrapper exists
                                let wrapper = btnEl.closest('.dropdown');
                                if (!wrapper) {
                                    const newWrapper = tab.create();
                                    const parent = btnEl.parentElement;
                                    if (parent) { parent.insertBefore(newWrapper, btnEl); btnEl.remove(); wrapper = newWrapper; }
                                }

                                // attach delegated listeners to the content element so rebuilds won't remove them
                                const contentEl = tab._contentEl;
                                if (!contentEl) return false;

                                // mouseover: if entering the run-recent anchor, show recent
                                const onOver = (e) => {
                                    const hit = e.target.closest && e.target.closest('[data-item-id="run-recent"]');
                                    if (hit) {
                                        showRecent(hit);
                                        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                                    }
                                };

                                // mouseout: schedule hide when leaving the run-recent area
                                const onOut = (e) => {
                                    const related = e.relatedTarget;
                                    const leftRunRecent = !related || !related.closest || !related.closest('[data-item-id="run-recent"]');
                                    if (leftRunRecent) scheduleHide();
                                };

                                contentEl.addEventListener('mouseover', onOver);
                                contentEl.addEventListener('mouseout', onOut);

                                return true;
                            } catch (e) { console.error('[analyze] attachHover error', e); }
                            return false;
                        };

                        if (!attachHover()) setTimeout(attachHover, 50);

                        // Create New App — use plugin's NewAppForm
                        tab.addItem({
                            id: 'create-app',
                            label: tOr('analyze.createApp', 'Create New App'),
                            onClick: () => {
                                try {
                                    // Create a fullscreen overlay and attach the NewAppForm into it
                                    const overlayId = `${this.id}-newapp-overlay`;
                                    let overlay = document.getElementById(overlayId);
                                    if (!overlay) {
                                        overlay = document.createElement('div');
                                        overlay.id = overlayId;
                                        // centered modal overlay with padding and scroll support for small viewports
                                        overlay.className = 'fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4';
                                        overlay.style.overflow = 'auto';
                                        // close when clicking on backdrop
                                        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
                                        document.body.appendChild(overlay);
                                    }

                                    const form = new NewAppForm({
                                        onSubmit: (data) => {
                                            try {
                                                if (this.params.onCreate?.(data) !== false) {
                                                    // quick feedback
                                                    // eslint-disable-next-line no-alert
                                                    alert('Created new app: ' + JSON.stringify(data));
                                                }
                                            } finally {
                                                // remove overlay after submit
                                                const o = document.getElementById(overlayId);
                                                if (o) o.remove();
                                            }
                                        }
                                    });
                                    // create a centered content wrapper that constrains form height/width and scrolls internally
                                    const wrapperId = overlayId + '-wrap';
                                    let contentWrapper = document.getElementById(wrapperId);
                                    const createdWrapper = !contentWrapper;
                                    if (!contentWrapper) {
                                        contentWrapper = document.createElement('div');
                                        contentWrapper.id = wrapperId;
                                        // make the modal smaller (fixed constrained size) and avoid internal scrolling
                                        contentWrapper.style.width = '100%';
                                        contentWrapper.style.maxWidth = '420px';
                                        contentWrapper.style.maxHeight = '80vh';
                                        contentWrapper.style.overflow = 'visible';
                                        contentWrapper.style.display = 'flex';
                                        contentWrapper.style.justifyContent = 'center';
                                        contentWrapper.style.alignItems = 'flex-start';
                                        // ensure pointer events on wrapper (so clicking outside but inside overlay background still closes)
                                        contentWrapper.addEventListener('click', (ev) => { ev.stopPropagation(); });
                                    } else {
                                        // reuse existing wrapper: clear previous children so new form appears in the same spot
                                        while (contentWrapper.firstChild) contentWrapper.removeChild(contentWrapper.firstChild);
                                    }
                                    if (createdWrapper) overlay.appendChild(contentWrapper);
                                    // attach form into wrapper; NewAppForm.close will remove its parent (the wrapper)
                                    form.attachTo(contentWrapper);
                                } catch (e) {
                                    console.error('[analyze] create-app error', e);
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[analyze] failed to configure dropdown items', e);
                }
                // Diagnostic: report whether items were added to the dropdown
                try {
                    console.log('[analyze] diagnostic: tab info', {
                        id: tab?.id,
                        parentId: tab?.parentId,
                        hasAddItem: !!(tab && typeof tab.addItem === 'function'),
                        items: tab?.items ? Object.keys(tab.items) : null,
                        contentElId: tab?._contentEl?.id || null,
                    });
                } catch (e) { /* swallow */ }
        };

        register();
    }
});
