import { Dropdown } from "../../ui/classes/elements/dropdown.mjs";
import { NewAppForm } from "./newAppForm.mjs";
import { SidePanel } from "../../ui/classes/components/sidePanel.mjs";

addPlugin('analyze', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.params = params || {};
        // plugin-level stored recent jobs can be configured via params or saved options
        this.recentJobs = this.getOption('recentJobs') || this.params.recentJobs || [];
    }

    pluginReady() {
        const register = () => {
            
                if (!window.USER_INTERFACE || !USER_INTERFACE.AppBar || !USER_INTERFACE.AppBar.menu) {
                
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
                const tab = USER_INTERFACE.AppBar.addTab(
                    this.id,                    // ownerPluginId
                    title,                     // title (localized if available)
                    'fa-magnifying-glass',      // icon
                    [],                         // body
                    Dropdown                    // itemClass so Menu constructs plugin component
                );

                
                if (tab) {
                    const attachToggle = () => {
                        try {
                            const btnId = `${tab.parentId}-b-${tab.id}`;
                            const btnEl = document.getElementById(btnId);
                            if (!btnEl) return false;
                            let wrapper = btnEl.closest('.dropdown');
                            if (!wrapper) {
                                try {
                                    const newWrapper = tab.create();
                                    const parent = btnEl.parentElement;
                                    if (parent) {
                                        parent.insertBefore(newWrapper, btnEl);
                                        btnEl.remove();
                                        wrapper = newWrapper;
                                    }
                                } catch (e) {
                                }
                            }

                            if (wrapper) {
                                const trigger = wrapper.querySelector('[tabindex]') || wrapper;
                                trigger.addEventListener('click', (e) => {
                                    try {
                                        wrapper.classList.toggle('dropdown-open');
                                        if (!wrapper.classList.contains('dropdown-open')) {
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

                // Configure dropdown items using the Dropdown API
                try {
                    if (tab && typeof tab.addItem === 'function') {
                        // create the 'recent' section but keep its title empty so no uppercase header is shown
                        try { tab.addSection({ id: 'recent', title: '' }); } catch (e) {}
                        // prefer a slightly wider dropdown to match previous styling
                        try { if (tab) { tab.widthClass = 'w-64'; if (tab._contentEl) tab._contentEl.classList.add('w-64'); } } catch(e) {}

                        // Only add a single anchor item for Run Recent; the detailed list appears in the SidePanel on hover
                        tab.addItem({
                            id: 'run-recent',
                            section: 'recent',
                            label: tOr('analyze.runRecent', 'Run Recent') + ' \u2192',
                            onClick: () => false,
                        });

                        // create a reusable SidePanel and attach delegated hover handlers to show it
                        try {
                            // let the panel size to its content by default (width: 'auto')
                            const side = new SidePanel({ id: `${this.id}-recent-panel`, width: 'auto', maxHeight: '70vh' });
                            const attachHover = () => {
                                try {
                                    const content = tab._contentEl;
                                    if (!content) return false;

                                    // delegate to the 'run-recent' item inside the dropdown content
                                    content.addEventListener('mouseover', (e) => {
                                        const hit = e.target.closest && e.target.closest('[data-item-id]');
                                        if (hit && hit.dataset && hit.dataset.itemId === 'run-recent') {
                                            try {
                                                // cancel any pending hide so we can reopen immediately
                                                side.cancelHide?.();
                                                const jobs = (this.recentJobs && this.recentJobs.length) ? this.recentJobs : ['Recent Job 1','Recent Job 2','Recent Job 3'];
                                                // use SidePanel helper to build a menu and position the panel next to the anchor
                                                side.setMenu(jobs, (it, idx) => {
                                                    try { if (typeof this.onJobClick === 'function') this.onJobClick({ index: idx, label: (typeof it === 'string' ? it : (it && it.label)) }); } catch(_){}
                                                });
                                                side.showNear(hit, { nudge: 1 });
                                                try { tab.hideRecent = () => side.hide(); } catch(_) {}
                                            } catch (err) { console.error('[analyze] show side panel error', err); }
                                        }
                                    });

                                    content.addEventListener('mouseout', (e) => {
                                        const related = e.relatedTarget;
                                        if (!related || !related.closest || !related.closest(`#${side.id}`)) side.scheduleHide();
                                    });
                                    return true;
                                } catch (e) { console.error('[analyze] attachHover error', e); }
                                return false;
                            };
                            if (!attachHover()) setTimeout(attachHover, 50);
                        } catch (e) { /* ignore */ }

                        

                        tab.addItem({
                            id: 'create-app',
                            label: tOr('analyze.createApp', 'Create New App'),
                            onClick: () => {
                                try {
                                    const form = new NewAppForm({ onSubmit: (data) => {
                                        try { if (this.params.onCreate?.(data) !== false) { alert('Created new app: ' + JSON.stringify(data)); } }
                                        catch (err) { console.error(err); }
                                    }});
                                    const win = form.showFloating({ title: tOr('analyze.createApp', 'Create New App'), width: 420, height: 360 });
                                    if (!win) {
                                        const overlayId = `${this.id}-newapp-overlay`;
                                        USER_INTERFACE.Dialogs.showCustom(overlayId, 'New App', `<div id="${overlayId}-content"></div>`, '', { allowClose: true });
                                        const container = document.getElementById(overlayId)?.querySelector('.card-body');
                                        if (container) form.attachTo(container);
                                    }
                                } catch (e) { console.error('[analyze] create-app error', e); }
                                return false;
                            }
                        });

                        // Add Apps item: collapses dropdown and opens floating window listing apps
                        tab.addItem({
                            id: 'apps-list',
                            label: tOr('analyze.apps', 'Apps'),
                            onClick: async () => {
                                try {
                                    // collapse the dropdown
                                    try {
                                        const btnId = `${tab.parentId}-b-${tab.id}`;
                                        const btnEl = document.getElementById(btnId);
                                        const wrapper = btnEl?.closest('.dropdown');
                                        wrapper?.classList.remove('dropdown-open');
                                        try { tab.hideRecent?.(); } catch(_) {}
                                    } catch(_) {}

                                    // fetch apps via standalone_jobs
                                    let items = [];
                                    try {
                                        const resp = await window.EmpaiaStandaloneJobs?.getApps?.();
                                        items = Array.isArray(resp?.items) ? resp.items : [];
                                    } catch (e) {
                                        console.warn('[analyze] failed to fetch apps, showing empty list', e);
                                    }

                                    // render content using menu-pages if available, fallback to simple list
                                    const { FloatingWindow } = await import('../../ui/classes/components/floatingWindow.mjs');
                                    const fw = new FloatingWindow({
                                        id: `${this.id}-apps-window`,
                                        title: tOr('analyze.apps', 'Apps'),
                                        width: 460,
                                        height: 380
                                    });
                                    fw.attachTo(document.body);

                                    // Prefer a simple interactive list for reliability
                                    const container = document.createElement('div');
                                    container.className = 'p-2 space-y-2';
                                    const caseIdHardcoded = '87fbb59a-3183-4d36-ab22-48f4e027d1f0';

                                    // No input preloading for now; keep simple run flow

                                    items.forEach((app, idx) => {
                                        const appId = app?.id || app?.app_id;
                                        const btn = document.createElement('button');
                                        btn.type = 'button';
                                        btn.className = 'btn btn-sm btn-primary w-full justify-start';
                                        btn.textContent = app?.name_short || app?.name || `App ${idx+1}`;
                                        const status = document.createElement('div');
                                        status.className = 'text-xs mt-1';
                                        status.textContent = tOr('analyze.jobReady', 'Ready to run');

                                        // Keep UI minimal: no inputs or mode selector

                                        btn.addEventListener('click', async () => {
                                            try {
                                                status.textContent = tOr('analyze.jobStarting', 'Starting job...');
                                                // Create + run job via helper (returns final job)
                                                const res = await window.EmpaiaStandaloneJobs?.createAndRunJob?.({ appId, caseId: caseIdHardcoded });
                                                status.textContent = `${tOr('analyze.jobFinal', 'Final status')}: ${res?.status || 'UNKNOWN'}`;
                                                console.log('[analyze] Job final:', res);
                                            } catch (err) {
                                                console.error('[analyze] Failed to run app job', err);
                                                alert('Failed to run app job: ' + (err?.message || err));
                                                status.textContent = tOr('analyze.jobError', 'Error running job');
                                            }
                                        });
                                        const desc = document.createElement('div');
                                        desc.className = 'text-xs opacity-70 mt-1';
                                        desc.textContent = app?.store_description || '';
                                        const wrap = document.createElement('div');
                                        wrap.className = 'p-2 rounded-box bg-base-100';
                                        wrap.appendChild(btn);
                                        wrap.appendChild(status);
                                        // Minimal controls only
                                        if (desc.textContent) wrap.appendChild(desc);
                                        container.appendChild(wrap);
                                    });

                                    // Fallback when no items
                                    if (!items.length) {
                                        const empty = document.createElement('div');
                                        empty.className = 'p-2 text-sm opacity-70';
                                        empty.textContent = tOr('analyze.noApps', 'No apps available.');
                                        container.appendChild(empty);
                                    }

                                    fw.setBody(container);
                                    fw.focus();
                                    
                                } catch (e) {
                                    console.error('[analyze] apps-list error', e);
                                }
                                return false;
                            }
                        });
                    }
                } catch (e) { console.warn('[analyze] failed to configure dropdown items', e); }
                // Close dropdowns when clicking away: attach a document-level click handler once per tab
                const attachDocumentCloser = (t) => {
                    try {
                        if (!t || t.__analyzeDocCloserAttached) return;
                        const btnId = `${t.parentId}-b-${t.id}`;
                        const docHandler = (ev) => {
                            try {
                                const openWrappers = Array.from(document.querySelectorAll('.dropdown.dropdown-open'));
                                openWrappers.forEach((wrapper) => {
                                    const btnEl = document.getElementById(btnId);
                                    if (btnEl && (btnEl === ev.target || btnEl.contains(ev.target))) return;
                                    try { wrapper.classList.remove('dropdown-open'); } catch(_) {}
                                });
                                try { t.hideRecent?.(); } catch(_) {}
                            } catch (_) { /* swallow */ }
                        };
                        document.addEventListener('click', docHandler, true);
                        const keyHandler = (ev) => { if (ev.key === 'Escape') { try { Array.from(document.querySelectorAll('.dropdown.dropdown-open')).forEach(w=>w.classList.remove('dropdown-open')); try { t.hideRecent?.(); } catch(_){} } catch(_){} } };
                        document.addEventListener('keydown', keyHandler, true);
                        t.__analyzeDocCloserAttached = true;
                    } catch (e) { /* ignore */ }
                };
                try { attachDocumentCloser(tab); } catch(e) { /* ignore */ }
                // diagnostic logs removed
        };

        register();
    }
});
