addPlugin('hotkeys', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
    }

    pluginReady() {
        USER_INTERFACE.AdvancedMenu.setMenu(this.id, "hotkeys", "Hotkey Shortcuts", `
<h2>Shortcuts</h2>
This plugin is a naive shortcut add-on. Later version will attempt to allow users re-defining
system shortcuts and map available ones real-time.

<br><br>
<div>
<span class="key">Alt</span>+<span class="key">w</span> &emsp; Viewport Focus <br>
<span class="text-small">Copies current viewport or aligns the viewport if copied already. <b>Transferable between different viewers.</b></span>
</div>
        
        `, 'keyboard_keys');

        VIEWER.addHandler('key-down', function (e) {
            if (e.altKey) {
                if (e.key === "w") {
                    //try parsing data and then either copy or align viewport
                    navigator.clipboard.readText().then(text => {
                        let focus = {};
                        try {
                            if (text && text.length < 100) focus = JSON.parse(text)
                        } catch (e) {
                            //pass
                        }
                        if (focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
                            VIEWER.viewport.panTo({x: Number.parseFloat(focus.point.x), y: Number.parseFloat(focus.point.y)}, false);
                            VIEWER.viewport.zoomTo(Number.parseFloat(focus.zoomLevel), null, false);
                            UTILITIES.copyToClipboard("{}");
                        } else {
                            UTILITIES.copyToClipboard(JSON.stringify({
                                point: VIEWER.viewport.getCenter(),
                                zoomLevel: VIEWER.viewport.getZoom(),
                            }));
                            Dialogs.show("Viewport copied to your clipboard!", 1500, Dialogs.MSG_INFO);
                        }
                    }).catch(e => {
                        Dialogs.show("Your browser blocked the attempt to read your clipboard!", 1500, Dialogs.MSG_ERR);
                    });
                }
            }
        });
    }
});
