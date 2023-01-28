(function () {
    const parser = vega.parse;
    vega.parse = (x, _, __) => parser(x, null, {ast: true});

    const View = vega.View;
    vega.View = class extends View {
        constructor(runtime, config) {
            super(runtime, {
                ...config,
                expr: vega.expressionInterpreter
            });
        }
    };
})();