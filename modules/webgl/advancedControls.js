/**
 * Re-uses two compound components since they are fully compatible
 * @type {WebGLModule.UIControls.SliderWithInput}
 */
WebGLModule.UIControls.SliderWithInput = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this._c1 = new WebGLModule.UIControls.SimpleUIControl(
            context, name, webGLVariableName, params, WebGLModule.UIControls.getUiElement('range'));
        let paramsClone = $.extend({}, params, {title: ""});
        this._c2 = new WebGLModule.UIControls.SimpleUIControl(
            context, name, webGLVariableName, paramsClone, WebGLModule.UIControls.getUiElement('number'), "second-");
    }

    init() {
        const _this = this;
        this._c1.init();
        this._c2.init();
        this._c1.on(this.name, function (value, encoded, context) {
            $(`#${_this._c2.id}`).val(encoded);
            _this._c2.value = value;
            _this.changed(this.name, value, encoded, context);
        }, true); //silently fail if registered
        this._c2.on(this.name, function (value, encoded, context) {
            $(`#${_this._c1.id}`).val(encoded);
            _this._c1.value = value;
            _this.changed(this.name, value, encoded, context);
        }, true); //silently fail if registered
    }

    glDrawing(program, dimension, gl) {
        this._c1.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this._c1.glLoaded(program, gl);
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this._c1.params.interactive) return "";
        let cls = breakLine ? "" : "class='d-inline-block'";
        return `<div ${cls} ${controlCss}>${this._c1.toHtml(false, 'style="width: 48%;"')}
        ${this._c2.toHtml(false, 'style="width: 12%;"')}</div>`;
    }

    define() {
        return this._c1.define();
    }

    sample(ratio) {
        return this._c1.sample(ratio);
    }

    get supports() {
        return this._c1.supports;
    }

    get type() {
        return this._c1.type;
    }

    get raw() {
        return this._c1.raw;
    }

    get encoded() {
        return this._c1.encoded;
    }
};
WebGLModule.UIControls.registerClass("range_input", WebGLModule.UIControls.SliderWithInput);

WebGLModule.UIControls.ColorMap = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this.params = this.supports;
        //Note that colormap must support 2->this.MAX_SAMPLES color arrays
        this.MAX_SAMPLES = 8;
        $.extend(this.params, params);

        this.params.steps = Math.max(Math.round(this.params.steps), 2);

        this.parser = WebGLModule.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.context.includeGlobalCode('colormap', `
#define COLORMAP_ARRAY_LEN ${this.MAX_SAMPLES}
vec3 sample_colormap(in float ratio, in vec3 map[COLORMAP_ARRAY_LEN], in float steps[COLORMAP_ARRAY_LEN], in bool interpolate) {
    for (int i = 0; i < COLORMAP_ARRAY_LEN; i++) {
        if (ratio <= steps[i] || steps[i] < .0) {
            if (i == 0) return map[0];           
            float remainder = ratio - steps[i];               
            if (ratio > steps[i]) {
                return map[i];
            }
            if (interpolate) return mix(map[i], map[i+1], remainder);
            if (steps[i+1] > steps[i] && remainder > abs(ratio - steps[i+1])) return map[i+1];   
            return map[i];
        }
    }
}`);
    }

    init() {
        this.value = this.context.loadProperty(this.name, this.params.default);

        this.setSteps();

        if (!this.value || !ColorMaps.schemeGroups[this.params.mode].hasOwnProperty(this.value)) {
            this.value = ColorMaps.defaults[this.params.mode];
        }
        this.pallete = ColorMaps[this.value][this.maxSteps];

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target),
                    selected = self.val();
                let pallete = ColorMaps[selected][_this.maxSteps];
                _this._setPallete(pallete);
                self.css("background", _this.cssGradient(pallete));
                _this.value = selected;
                _this.context.storeProperty(_this.name, selected);
                _this.changed(_this.name, _this.pallete, _this.value, _this);
                _this.context.invalidate();
            };
            let node = $(`#${this.id}`);
            node.css("background", this.cssGradient(this.pallete));
            this._setPallete(this.pallete);

            let schemas = [];
            for (let pallete of ColorMaps.schemeGroups[this.params.mode]) {
                schemas.push(`<option value="${pallete}">${pallete}</option>`);
            }
            node.html(schemas.join(""));
            node.val(this.value);
            node.change(updater);
        } else {
            //be careful with what the DOM elements contains or not if not interactive...
            let existsNode = document.getElementById(this.id);
            if (existsNode) existsNode.style.background = this.cssGradient(this.pallete);
        }
    }

    setSteps(steps) {
        this.steps = steps || this.params.steps;
        if (! Array.isArray(this.steps)) {
            if (this.steps < 2) this.steps = 2;
            if (this.steps > this.MAX_SAMPLES) this.steps = this.MAX_SAMPLES;
            this.maxSteps = this.steps;
            let step = 1.0 / this.maxSteps;
            this.steps = new Array(this.MAX_SAMPLES);
            this.steps.fill(-1);
            this.steps[0] = step;
            for (let i = 1; i < this.maxSteps; i++) this.steps[i] = this.steps[i - 1] + step;
            this.steps[this.maxSteps-1] = 1.0;
        } else {
            this.steps = this.steps.filter(x => x >= 0);
            this.steps.sort();
            let max = this.steps[0];
            let min = this.steps[this.steps.length-1];
            this.steps = this.steps.slice(0, this.MAX_SAMPLES);
            this.maxSteps = this.steps.length;
            this.steps.forEach(x => (x - min) / (max-min));
            for (let i = this.maxSteps; i < this.MAX_SAMPLES; i++) this.steps.push(-1);
        }
    }

    _continuousCssFromPallete(pallete) {
        let step = 100 / (pallete.length-1),
            percent = step;
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < pallete.length; i++) {
            css.push(`, ${pallete[i]} ${percent}%`);
            percent += step;
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        let step = 100 / pallete.length,
            percent = step;
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < pallete.length; i++) {
            css.push(`, ${pallete[i-1]} ${percent}%, ${pallete[i]} ${percent}%`);
            percent += step;
        }
        css.push(")");
        return css.join("");
    }

    _setPallete(newPallete, stepSize) {
        if (typeof newPallete[0] === "string") {
            let temp = newPallete; //if this.pallete passed
            this.pallete = [];
            for (let color of temp) {
                this.pallete.push(...this.parser(color));
            }
        }
        for (let i = this.pallete.length; i < 3*this.MAX_SAMPLES; i++) this.pallete.push(0);
    }

    glDrawing(program, dimension, gl) {
        gl.uniform3fv(this.colormap_gluint, Float32Array.from(this.pallete));
        gl.uniform1fv(this.steps_gluint, Float32Array.from(this.steps));
    }

    glLoaded(program, gl) {
        this.steps_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_steps[0]");
        this.colormap_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap[0]");
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this.params.interactive) return `<span> ${this.params.title}</span><div id="${this.id}" class="text-readable" 
style="width: 60%;">${this.params.default}</div>`;

        if (!ColorMaps.hasOwnProperty(this.params.pallete)) {
            this.params.pallete = "OrRd";
        }

        return `<span> ${this.params.title}</span><select id="${this.id}" class="form-control text-readable" 
style="width: 60%;"></select><br>`;
    }

    define() {
        return `uniform vec3 ${this.webGLVariableName}_colormap[COLORMAP_ARRAY_LEN];
uniform float ${this.webGLVariableName}_steps[COLORMAP_ARRAY_LEN];`;
    }

    get type() {
        return "vec3";
    }

    sample(ratio) {
        if (!ratio) return "ERROR colormap requires sample(ratio) argument!";
        return `sample_colormap(${ratio}, ${this.webGLVariableName}_colormap, ${this.webGLVariableName}_steps, ${this.params.continuous})`;
    }

    get supports() {
        return {
            steps: 3,
            default: "YlOrRd",
            mode: "sequential",
            interactive: true,
            title: "Colormap",
            continuous: false,
        };
    }

    get raw() {
        return this.pallete;
    }

    get encoded() {
        return this.value;
    }
};
WebGLModule.UIControls.registerClass("colormap", WebGLModule.UIControls.ColorMap);

/**
 * Advanced slider that can define multiple points and interval masks
 * | --- A - B -- C -- D ----- |
 * will be sampled with mask float[5], the result is
 * the percentage reached within this interval: e.g. if C <= ratio < D, then
 * the result is  4/5 * mask[3]   (4-th interval out of 5 reached, multiplied by 4th mask)
 * @type {WebGLModule.UIControls.AdvancedSlider}
 */
WebGLModule.UIControls.AdvancedSlider = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);
        this.MAX_SLIDERS = 12;
        this.params = this.supports;
        $.extend(this.params, params);

        this.context.includeGlobalCode('advanced_slider', `
#define ADVANCED_SLIDER_LEN ${this.MAX_SLIDERS} 
float sample_advanced_slider(in float ratio, in float breaks[ADVANCED_SLIDER_LEN], in float mask[ADVANCED_SLIDER_LEN+1], in bool maskOnly) {
    float bigger = .0, actualLength = .0, masked = .0;
    bool sampling = true;
    for (int i = 0; i < ADVANCED_SLIDER_LEN; i++) {
        if (breaks[i] < .0) {
            if (sampling) masked = mask[i];
            sampling = false;
            break;
        }
       
        if (sampling) {
            if (ratio <= breaks[i]) {
                sampling = false;
                masked = mask[i];
            } else bigger++;
        }
        actualLength++;
    }
    if (sampling) masked = mask[ADVANCED_SLIDER_LEN];
    if (maskOnly) return masked;
    return masked * bigger / actualLength;
}`);
    }

    init() {
        this._updatePending = false;
        this.value = this.context.loadProperty(this.name, this.params.default);
        this.mask = this.context.loadProperty(this.name + "_mask", this.params.mask);

        this.value = this.value.slice(0, this.MAX_SLIDERS);
        this.sampleSize = this.value.length;

        this.mask = this.mask.slice(0, this.MAX_SLIDERS+1);
        let size = this.mask.length;
        this.connects = this.value.map(_ => true); this.connects.push(true); //intervals have +1 elems
        for (let i = size; i <  this.MAX_SLIDERS+1; i++) this.mask.push(-1);

        if (this.params.step && this.params.step < 1) delete this.params.step;

        let limit =  this.value.length < 2 ? undefined : this.params.max;

        let format = this.params.max < 10 ? {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 1 }),
            from: v => Number.parseFloat(v)
        } : {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 0 }),
            from: v => Number.parseFloat(v)
        };

        if (this.params.interactive) {
            const _this = this;
            let container = document.getElementById(this.id);
            noUiSlider.create(container, {
                range: {
                    'min': _this.params.min,
                    'max': _this.params.max
                },
                step: _this.params.step,
                start: _this.value,
                margin: _this.params.minGap,
                limit: limit,
                connect: _this.connects,
                direction: 'ltr',
                orientation: 'horizontal',
                behaviour: 'drag',
                tooltips: true,
                format: format,
                pips: $.extend({format: format}, this.params.pips)
            });

            if (this.params.pips) {
                let pips = container.querySelectorAll('.noUi-value');
                function clickOnPip() {
                    let idx = 0;
                    let value = Number(this.getAttribute('data-value'));
                    let values = container.noUiSlider.get().map(v => Number.parseFloat(v));
                    if (Array.isArray(values)) {
                        let closest = Math.abs(values[0] - value);
                        for (let i = 1; i < values.length; i++) {
                            let d = Math.abs(values[i] - value);
                            if (d < closest) {
                                idx = i;
                                closest = d;
                            }
                        }
                        container.noUiSlider.setHandle(idx, value, false, false);
                    } else { //just one
                        container.noUiSlider.set(value);
                    }
                    _this.value[idx] = value;

                    _this.changed(_this.name + "_mask", _this.mask, _this.mask, _this);
                    _this.context.invalidate();
                }

                for (let i = 0; i < pips.length; i++) {
                    pips[i].addEventListener('click', clickOnPip);
                }
            }

            if (this.params.invertMask) {
                let connects = container.querySelectorAll('.noUi-connect');
                for (let i = 0; i < connects.length; i++) {
                    connects[i].addEventListener('mouseup', function (e) {
                        let d = Math.abs(Date.now() - _this._timer);
                        _this._timer = 0;
                        if (d >= 180) return;

                        let idx = Number.parseInt(this.dataset.index);
                        _this.mask[idx] = 1 - _this.mask[idx];
                        this.style.background = _this.mask[i] >= 0.5 ? "var(--color-bg-danger-inverse)" : "var(--color-bg-primary)";
                        _this.context.invalidate();
                        _this._ignoreNextClick = idx !== 0 && idx !== _this.sampleSize-1;
                        _this.context.storeProperty(_this.name + "_mask", _this.mask);
                    });

                    connects[i].addEventListener('mousedown', function (e) {
                        _this._timer = Date.now();
                    });

                    connects[i].style.cursor = "pointer";
                }
            }

            container.noUiSlider.on("change", function(values, handle, unencoded, tap, positions, noUiSlider) {
                _this.value[handle] = _this._normalize(unencoded[handle]);
                _this.encodedValues = values;
                if (_this._ignoreNextClick) {
                    _this._ignoreNextClick = false;
                } else if (!_this._updatePending) {
                    //can be called multiple times upon multiple handle updates, do once if possible
                    _this._updatePending = true;
                    setTimeout(_ => {

                        //todo re-scale values or filter out -1ones
                        _this.changed(_this.name, unencoded, values, _this);
                        _this.context.storeProperty(_this.name, unencoded);

                        _this.context.invalidate();
                        _this._updatePending = false;
                    }, 50);
                }
            });

            this._updateConnectStyles(container);
        }

        //do at last since value gets stretched by -1ones
        for (let i =  this.sampleSize; i < this.MAX_SLIDERS; i++) this.value.push(-1);
    }

    _normalize(value) {
        return (value - this.params.min) / (this.params.max - this.params.min);
    }

    _updateConnectStyles(container) {
        if (!container) container = document.getElementById(this.id);
        let pips = container.querySelectorAll('.noUi-connect');
        for (let i = 0; i < pips.length; i++) {
            pips[i].style.background = this.mask[i] >= 0.5 ? "var(--color-bg-danger-inverse)" : "var(--color-bg-primary);";
            pips[i].dataset.index = (i).toString();
        }
    }

    glDrawing(program, dimension, gl) {
        gl.uniform1fv(this.breaks_gluint, Float32Array.from(this.value));
        gl.uniform1fv(this.mask_gluint, Float32Array.from(this.mask));
    }

    glLoaded(program, gl) {
        this.breaks_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_breaks[0]");
        this.mask_gluint = gl.getUniformLocation(program, this.webGLVariableName + "_mask[0]");
    }

    toHtml(breakLine=true, controlCss="") {
        if (!this.params.interactive) return "";
        return `<span style="height: 54px;">${this.params.title}: </span><div id="${this.id}" style="height: 9px; 
margin-left: 5px; width: 60%; display: inline-block"></div>`;
    }

    define() {
        return `uniform float ${this.webGLVariableName}_breaks[ADVANCED_SLIDER_LEN];
uniform float ${this.webGLVariableName}_mask[ADVANCED_SLIDER_LEN+1];`;
    }

    get type() {
        return "float";
    }

    sample(ratio) {
        if (!ratio) return "ERROR advanced slider requires sample(ratio) argument!";
        return `sample_advanced_slider(${ratio}, ${this.webGLVariableName}_breaks, ${this.webGLVariableName}_mask, ${this.params.maskOnly})`;
    }

    get supports() {
        return {
            default: [0.2, 0.8],
            mask: [1, 0, 1],
            interactive: true,
            maskOnly: true,
            invertMask: true,
            title: "Threshold",
            min: 0,
            max: 1,
            minGap: 0.05,
            step: -1,
            pips: {
                mode: 'positions',
                values: [0, 20, 40, 50, 60, 80, 90, 100],
                density: 4
            }
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValues;
    }
};
WebGLModule.UIControls.registerClass("advanced_slider", WebGLModule.UIControls.AdvancedSlider);

// WebGLModule.UIControls.LocalizeColorMap = class extends WebGLModule.UIControls.ColorMap {
//
//     constructor(context, name, webGLVariableName, params) {
//         $.extend(true, params.col, );
//         super(context, name, webGLVariableName, WebGLModule.UIControls.LocalizeColorMap.redefineParams(params));
//     }
//
//     static redefineParams(params) {
//         if (!params.hasOwnProperty("color")) params.color = {};
//         if (!params.hasOwnProperty("threshold")) params.threshold = {};
//         params.color.type = "colormap";
//         params.threshold.type = "advanced_slider";
//         params.color.default = params.color.default || "Set1";
//         params.color.mode = "quantitative";
//         params.color.interactive = false;
//         params.color.title = params.color.title || "Localized: ";
//
//         //to-do maybe adjust steps/mask for threshold
//     }
// };
// WebGLModule.UIControls.registerClass("localize_colormap", WebGLModule.UIControls.LocalizeColorMap);
//
//
// /**
//  * Kernel filter applied onto texture
//  * @type {WebGLModule.UIControls.Kernel}
//  */
// WebGLModule.UIControls.Kernel = class extends WebGLModule.UIControls.IControl {
//     constructor(context, name, webGLVariableName, params) {
//         super(context, name, webGLVariableName);
//
//         this.params = this.supports;
//         $.extend(this.params, params);
//
//         if (this.params.width < 3) throw "Invalid kernel width < 3.";
//         if (this.params.height < 3) throw "Invalid kernel height < 3.";
//
//         this.DX = Math.round(this.params.width);
//         this.DY = Math.round(this.params.height);
//     }
//
//     init() {
//         this.value = this.context.loadProperty(this.name, this.params.default);
//         if (!Array.isArray(this.value) || this.value.length !== this.width*this.height) {
//             console.warn("Invalid kernel.");
//             this.value = new Array(this.width*this.height);
//             this.value.fill(1/this.width*this.height);
//         }
//         this.encodedValue = JSON.stringify(this.value);
//
//         if (this.params.interactive) {
//             const _this = this;
//             let updater = function(e) {
//                 let self = $(e.target),
//                     selected = self.val();
//                 try {
//                     _this.value = JSON.parse(selected);
//                     _this.encodedValue = selected;
//                     self.css('border', 'none');
//                     _this.context.storeProperty(_this.name, _this.value);
//                     _this.changed(_this.name, _this.value, _this.encodedValue, _this);
//                     _this.context.invalidate();
//                 } catch (e) {
//                     self.css('border', 'red 1px solid');
//                 }
//             };
//             let node = $(`#${this.id}`);
//             node.val(this.encodedValue);
//             node.change(updater);
//         }
//     }
//
//     glDrawing(program, dimension, gl) {
//         gl.uniform1fv(this.kernel_gluint, Float32Array.from(this.value));
//     }
//
//     glLoaded(program, gl) {
//         this.kernel_gluint = gl.getUniformLocation(program, this.webGLVariableName + "[0]");
//     }
//
//     toHtml(breakLine=true, controlCss="") {
//         if (!this.params.interactive) return "";
//         return `<span style="height: 54px;">${this.params.title}: </span><br><textarea id="${this.id}" style="height: 90px;
//  width: 100%;" placeholder="Enter kernel as JSON array, row-order stored."></textarea>`;
//     }
//
//     define() {
//         let dxLow = this.DX % 2 == 0 ? this.DX/2-1 : (this.DX-1) / 2;
//         let dyLow = this.DY % 2 == 0 ? this.DY/2-1 : (this.DY-1) / 2;
//
//         return `uniform float ${this.webGLVariableName}[${this.DX*this.DY}];
// float filter_${this.context.uid}_kernel(in vec2 coords, in float kernel[${this.DX}*${this.DY}]) {
//    vec2 stepSize = 1.0 / ${this.context.textureSize()};
//    float result = .0;
//    for (int i = -${dxLow}/2; i<${Math.floor(this.DX/2)}; i++) {
//        for (int j = -${dyLow}/2; j<${Math.floor(this.DY/2)}; j++) {
//            vec2 sampleCoord = vec2(coords.x + float(i)*stepSize.x, coords.y + float(j)*stepSize.y);
//            result += kernel[i*${this.DY}+j] * ${this.context.sampleChannel("sampleCoord")};
//        }
//    }
//    return result;
// }`;
//     }
//
//     get type() {
//         return "float";
//     }
//
//     sample(ratio) {
//         if (typeof ratio !== "string") ratio = "tile_texture_coords";
//         return `filter_${this.context.uid}_kernel(${ratio}, ${this.webGLVariableName})`;
//     }
//
//     get supports() {
//         return {
//             default: [1/273, 4/273, 7/273, 4/273, 1/273,
//                 4/273, 16/273, 26/273, 16/273, 4/273,
//                 7/273, 26/273, 41/273, 26/273, 7/273,
//                 4/273, 16/273, 26/273, 16/273, 4/273,
//                 1/273, 4/273, 7/273, 4/273, 1/273,
//             ],
//             width: 5,
//             height: 5,
//             interactive: true,
//             title: "Applied kernel:"
//         };
//     }
//
//     get raw() {
//         return this.value;
//     }
//
//     get encoded() {
//         return this.encodedValues;
//     }
// };
// WebGLModule.UIControls.registerClass("kernel", WebGLModule.UIControls.Kernel);

WebGLModule.UIControls.TextArea = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);

        this.params = this.supports;
        $.extend(this.params, params);
    }

    init() {
        this.value = this.context.loadProperty(this.name, this.params.default);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target);
                _this.value = self.val();
                _this.context.storeProperty(_this.name, _this.value);
                _this.changed(_this.name, _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.val(this.value);
            node.change(updater);
        } else {
            let node = $(`#${this.id}`);
            node.val(this.value);
        }
    }

    glDrawing(program, dimension, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(breakLine=true, controlCss="") {
        let disabled = this.params.interactive ? "" : "disabled";
        let title = this.params.title ? `<span style="height: 54px;">${this.params.title}: </span>` : "";
        return `${title}<textarea id="${this.id}" class="form-control" 
style="width: 100%; display: block; resize: vertical; ${controlCss}" ${disabled} placeholder="${this.params.placeholder}"></textarea>`;
    }

    define() {
        return "";
    }

    get type() {
        return "text";
    }

    sample(ratio=undefined) {
        return this.value;
    }

    get supports() {
        return {
            default: "",
            placeholder: "",
            interactive: true,
            title: "Text:"
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
WebGLModule.UIControls.registerClass("text_area", WebGLModule.UIControls.TextArea);

WebGLModule.UIControls.Button = class extends WebGLModule.UIControls.IControl {
    constructor(context, name, webGLVariableName, params) {
        super(context, name, webGLVariableName);

        this.params = this.supports;
        $.extend(this.params, params);
    }

    init() {
        this.value = this.context.loadProperty(this.name, this.params.default);

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.value++;
                _this.changed(_this.name, _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.html(this.params.title);
            node.click(updater);
        } else {
            let node = $(`#${this.id}`);
            node.html(this.params.title);
        }
    }

    glDrawing(program, dimension, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(breakLine=true, controlCss="") {
        let disabled = this.params.interactive ? "" : "disabled";
        let css = controlCss ? controlCss : 'style="float: right;"';
        return `<button id="${this.id}" ${css} class="btn" ${disabled}></button>
${breakLine ? '<br style="clear: both;">' : ""}`;
    }

    define() {
        return "";
    }

    get type() {
        return "action";
    }

    sample(ratio=undefined) {
        return "";
    }

    get supports() {
        return {
            default: 0, //counts clicks
            interactive: true,
            title: "Button"
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
WebGLModule.UIControls.registerClass("button", WebGLModule.UIControls.Button);
