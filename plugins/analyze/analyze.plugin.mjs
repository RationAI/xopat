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

            try {
                console.log('[analyze] calling USER_INTERFACE.AppBar.addTab', { id: this.id, title: $.t ? $.t('analyze.title') : 'Analyze', itemClass: Dropdown });
                const tab = USER_INTERFACE.AppBar.addTab(
                    this.id,                    // ownerPluginId
                    $.t ? $.t('analyze.title') : 'Analyze', // title (localized if available)
                    'fa-magnifying-glass',      // icon
                    [],                         // body
                    Dropdown                   // itemClass so Menu constructs plugin component
                );

                // Configure dropdown items for the plugin tab
                try {
                    if (tab && typeof tab.addItem === 'function') {
                        // Run Recent — opens a right-side panel listing recent jobs
                        tab.addItem({
                            id: 'run-recent',
                            label: $.t ? $.t('analyze.runRecent') : 'Run Recent',
                            onClick: () => {
                                const panelId = `${this.id}-recent-panel`;
                                let panel = document.getElementById(panelId);
                                if (!panel) {
                                    panel = document.createElement('div');
                                    panel.id = panelId;
                                    Object.assign(panel.style, {
                                        position: 'fixed',
                                        right: '12px',
                                        top: '64px',
                                        width: '260px',
                                        maxHeight: '70vh',
                                        overflow: 'auto',
                                        background: 'var(--base-200, #fff)',
                                        border: '1px solid var(--base-300, #ccc)',
                                        padding: '8px',
                                        borderRadius: '8px',
                                        zIndex: 9999,
                                    });
                                    document.body.appendChild(panel);
                                }
                                // populate
                                panel.innerHTML = '';
                                const hdr = document.createElement('div');
                                hdr.textContent = $.t ? $.t('analyze.recentJobs') : 'Recent Jobs';
                                hdr.style.fontWeight = '600';
                                hdr.style.padding = '6px 4px';
                                panel.appendChild(hdr);

                                const list = document.createElement('div');
                                list.style.display = 'flex';
                                list.style.flexDirection = 'column';
                                list.style.gap = '6px';
                                list.style.padding = '6px 4px';

                                const jobs = this.recentJobs || [];
                                if (!jobs.length) {
                                    const none = document.createElement('div');
                                    none.textContent = $.t ? $.t('analyze.noRecentJobs') : 'No recent jobs';
                                    none.style.opacity = '0.7';
                                    list.appendChild(none);
                                } else {
                                    for (let j of jobs) {
                                        const label = (typeof j === 'string') ? j : (j.label || j.name || String(j));
                                        const item = document.createElement('div');
                                        item.textContent = label;
                                        item.style.padding = '6px 8px';
                                        item.style.borderRadius = '6px';
                                        item.style.cursor = 'pointer';
                                        item.onmouseenter = () => item.style.background = 'var(--base-300, #f3f3f3)';
                                        item.onmouseleave = () => item.style.background = 'transparent';
                                        item.onclick = () => {
                                            try {
                                                if (typeof this.onJobClick === 'function') this.onJobClick(j);
                                            } catch (e) { console.error('onJobClick error', e); }
                                        };
                                        list.appendChild(item);
                                    }
                                }
                                panel.appendChild(list);
                            }
                        });

                        // Create New App — use plugin's NewAppForm
                        tab.addItem({
                            id: 'create-app',
                            label: $.t ? $.t('analyze.createApp') : 'Create New App',
                            onClick: () => {
                                const wsId = this.params.workspaceId || 'workspace';
                                const ws = document.getElementById(wsId);
                                if (!ws) return console.warn('Analyze plugin: workspace element not found:', wsId);
                                ws.innerHTML = '';
                                const form = new NewAppForm({
                                    onSubmit: (data) => {
                                        if (this.params.onCreate?.(data) !== false) {
                                            // quick feedback
                                            // eslint-disable-next-line no-alert
                                            alert('Created new app: ' + JSON.stringify(data));
                                        }
                                    }
                                });
                                form.attachTo(ws);
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[analyze] failed to configure dropdown items', e);
                }

            } catch (e) {
                console.error('[analyze] pluginReady failed during addTab/configure', e);
                throw e;
            }
        };

        register();
    }
});
