class MyPlugin extends XOpatPlugin {
	constructor(id) {
		super(id);
		this._starOverlays = [];
		this._updateHandler = null;
	}

	/*
	 * Ready to fire
	 */
	async pluginReady() {
		this.initHTML();
		console.log("MyPlugin: pluginReady");
	}

	initHTML() {
		USER_INTERFACE.addHtml(
			new UI.FloatingWindow(
				{
					id: "test-menu",
					title: "Comments",
					closable: false,
				}, new Button({
					id: "myButton",
					size: Button.SIZE.LARGE,
					outline: Button.OUTLINE.ENABLE,
					onClick: () => {
						// demo: add a star at the center of the image when clicked
						try {
							const imgSize = VIEWER.world.getItemAt(0).getContentSize();
							this.addStar(imgSize.x / 2, imgSize.y / 2);
						} catch (e) {
							console.warn('MyPlugin: failed to add demo star', e);
						}
					},
				},
					"Add star (demo)")
			)
		);
	}

	/**
	 * Add a star overlay at image pixel coordinates (x, y).
	 * @param {number} x Image X coordinate in pixels
	 * @param {number} y Image Y coordinate in pixels
	 * @param {object} [opts] Optional {sizePx, id}
	 */
	addStar(x, y, opts = {}) {
		if (typeof VIEWER === 'undefined' || !VIEWER) {
			console.warn('MyPlugin: VIEWER not available');
			return;
		}

		// determine image dimensions
		let imgW = 0, imgH = 0;
		try {
			const item = VIEWER.world.getItemAt(0);
			if (item && item.getContentSize) {
				const p = item.getContentSize();
				imgW = p.x; imgH = p.y;
			}
		} catch (e) {}
		if (!imgW && VIEWER.source && VIEWER.source.dimensions) {
			imgW = VIEWER.source.dimensions.x;
			imgH = VIEWER.source.dimensions.y;
		}
		if (!imgW || !imgH) {
			console.warn('MyPlugin: could not determine image dimensions');
			return;
		}

		const sizePx = opts.sizePx || 32;
		const nx = x / imgW;
		const ny = y / imgH;

		// create star element (inline SVG)
		const elt = document.createElement('div');
		elt.className = 'myplugin-star-overlay';
		elt.style.pointerEvents = 'auto';
		// fixed screen pixel size (not affected by viewer zoom)
		elt.style.width = Math.round(sizePx) + 'px';
		elt.style.height = Math.round(sizePx) + 'px';
		elt.style.display = 'flex';
		elt.style.alignItems = 'center';
		elt.style.justifyContent = 'center';
		elt.style.transform = 'translate(-50%, -50%)';
		elt.style.position = 'absolute';
		elt.innerHTML = `
			<svg viewBox="0 0 24 24" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
			  <path fill="#000000" stroke="#000000" stroke-width="0.8" d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.788 1.402 8.174L12 18.896 4.664 23.172l1.402-8.174L.132 9.21l8.2-1.192z"/>
			</svg>`;

		// make star clickable without letting clicks fall through to the viewer
		elt.setAttribute('role', 'button');
		elt.tabIndex = 0;
		elt.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			console.log('MyPlugin: star clicked at image coords', x, y);
		});

		// append to viewer container and remember image coords for updates
		try {
			const container = (VIEWER && (VIEWER.container || VIEWER.element)) || document.body;
			container.appendChild(elt);
		} catch (e) {}

		this._starOverlays.push({ el: elt, x: x, y: y, sizePx: sizePx });

		// register update handler once
		if (!this._updateHandler && VIEWER && VIEWER.addHandler) {
			this._updateHandler = () => {
				try {
					const item = VIEWER.world.getItemAt(0);
					if (!item) return;
					this._starOverlays.forEach(rec => {
						try {
							const vp = (item.imageToViewportCoordinates)
								? item.imageToViewportCoordinates(rec.x, rec.y, true)
								: VIEWER.viewport.imageToViewportCoordinates(rec.x, rec.y, true);
							const px = VIEWER.viewport.pixelFromPoint(vp, true);
							rec.el.style.left = Math.round(px.x) + 'px';
							rec.el.style.top = Math.round(px.y) + 'px';
						} catch (e) {}
					});
				} catch (e) {}
			};
			VIEWER.addHandler('animation', this._updateHandler);
			VIEWER.addHandler('open', this._updateHandler);
			// apply initial position immediately
			this._updateHandler();
		}

		return elt;
	}

	/** Remove all stars added by this plugin */
	clearStars() {
		if (!this._starOverlays.length) return;
		this._starOverlays.forEach(rec => {
			try { if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el); } catch (e) {}
		});
		this._starOverlays = [];
		// unregister update handler when no overlays left
		if (this._updateHandler && VIEWER && VIEWER.removeHandler) {
			try { VIEWER.removeHandler('animation', this._updateHandler); } catch (e) {}
			try { VIEWER.removeHandler('open', this._updateHandler); } catch (e) {}
			this._updateHandler = null;
		}
	}
}

addPlugin("my_plugin", MyPlugin);
