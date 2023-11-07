/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
WebGLModule.TimeSeries = class extends WebGLModule.VisualisationLayer {

    construct(options, dataReferences) {
        //todo supply options clone? options changes are propagated and then break things

        const ShaderClass = WebGLModule.ShaderMediator.getClass(options.seriesRenderer);
        if (!ShaderClass) {
            //todo better way of throwing errors to show users
            throw "";
        }
        this._renderer = new ShaderClass(`series_${this.uid}`, {
            layer: this.__visualisationLayer,
            webgl: this.webglContext,
            invalidate: this.invalidate,
            rebuild: this._rebuild,
            refetch: this._refetch
        });
        this.series = options.series;
        if (!this.series) {
            //todo err
            this.series = [];
        }

        // dynamic override which specifies
        options.timeline = options.timeline || {};
        options.timeline.max = options.series.length;
        options.timeline.default = options.series.indexOf(dataReferences[0]) + 1;

        this._dataReferences = dataReferences;
        super.construct(options, dataReferences);
        this._renderer.construct(options, dataReferences);
    }

    static type() {
        return "time-series";
    }

    static name() {
        return "Time Series";
    }

    static description() {
        return "internally use different shader to render one of chosen elements";
    }

    static customParams = {
        seriesRenderer: {
            usage: "Specify shader type to use in this series. Attach the shader properties as you would normally do with your desired shader.",
            default: "identity"
        },
        series: {
            //todo allow using the same data in different channels etc.. now the data must be distinct
            usage: "Specify data indexes for the series order. The starting item is the dataReferences value at index 0. For now, the data indexes must be unique.",
        }
    }

    static defaultControls = {
        timeline: {
            default: {title: "Timeline: "},
            accepts: (type, instance) => type === "float",
            required: {type: "range_input", step: 1, min: 1}
        },
        opacity: false
    };

    static sources() {
        return [{
            acceptsChannelCount: (x) => true,
            description: "render selected data source by underlying shader"
        }];
    }

    getFragmentShaderDefinition() {

        return `
${super.getFragmentShaderDefinition()}
${this._renderer.getFragmentShaderDefinition()}`;
    }

    getFragmentShaderExecution() {
        return this._renderer.getFragmentShaderExecution();
    }

    glLoaded(program, gl) {
        super.glLoaded(program, gl);
        this._renderer.glLoaded(program, gl);
    }

    glDrawing(program, dimension, gl) {
        super.glDrawing(program, dimension, gl);
        this._renderer.glDrawing(program, dimension, gl);
    }

    init() {
        this.timeline.params

        super.init();
        this._renderer.init();

        const _this = this;
        this.timeline.on('default', (raw, encoded, ctx) => {
            const value = Number.parseInt(encoded);
            if (value < 0 || value >= _this.series.length) return;
            this._dataReferences[0] = _this.series[value - 1];
            _this._refetch();
        });
    }

    htmlControls() {
        return `
${super.htmlControls()}
<h4>Rendering as ${this._renderer.constructor.name()}</h4>        
${this._renderer.htmlControls()}`;
    }
};

WebGLModule.ShaderMediator.registerLayer(WebGLModule.TimeSeries);
