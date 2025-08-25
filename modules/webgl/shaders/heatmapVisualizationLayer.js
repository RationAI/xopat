// /**
//  * Heatmap shader
//  * data reference must contain one index to the data to render using heatmap strategy
//  *
//  * expected parameters:
//  *  index - unique number in the compiled shader
//  * supported parameters:
//  *  color - for more details, see @WebGLModule.UIControls color UI type
//  *  threshold - for more details, see @WebGLModule.UIControls number UI type
//  *  opacity - for more details, see @WebGLModule.UIControls color UI type
//  *
//  *  inverse - low values are high opacities instead of high values, 1 or 0, default 0
//  *  logScale - use logarithmic scale instead of linear, 1 or 0, default 0
//  *  logScaleMax - maximum value used in the scale (remember, data values range from 0 to 1), default 1.0
//  *
//  * colors shader will read underlying data (red component) and output
//  * to canvas defined color with opacity based on the data
//  * (0.0 => transparent, 1.0 => opaque)
//  * supports thresholding - outputs color on areas above certain value
//  * mapping html input slider 0-100 to .0-1.0
//  */
// WebGLModule.HeatmapLayer = class extends WebGLModule.ShaderLayer {
//
//     static type() {
//         return "heatmap";
//     }
//
//     static name() {
//         return "Heatmap";
//     }
//
//     static description() {
//         return "data values encoded in color/opacity";
//     }
//
//     static sources() {
//         return [{
//             acceptsChannelCount: (x) => x===1,
//             description: "1D sequential data encoded in opacity"
//         }];
//     }
//
//     static defaultControls = {
//         color: {
//             default: {type: "color", default: "#fff700", title: "Color: "},
//             accepts: (type, instance) => type === "vec3",
//         },
//         threshold: {
//             default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
//             accepts: (type, instance) => type === "float"
//         },
//         inverse: {
//             default: {type: "bool", default: false, title: "Invert: "},
//             accepts: (type, instance) => type === "bool"
//         }
//     };
//
//
//     getFragmentShaderExecution() {
//         return `
//     float chan = ${this.sampleChannel('v_texture_coords')};
//     bool shows = chan >= ${this.threshold.sample('chan', 'float')};
//     if (${this.inverse.sample()}) {
//         if (!shows) {
//             shows = true;
//             chan = 1.0;
//         } else chan = 1.0 - chan;
//     }
//     if (shows) return vec4(${this.color.sample('chan', 'float')}, chan);
//     return vec4(.0);
// `;
//     }
// };
//
// WebGLModule.ShaderMediator.registerLayer(WebGLModule.HeatmapLayer);

// (function($) {
//     /**
//      * Identity shader
//      */
//     $.FlexRenderer.HeatmapLayer = class extends $.FlexRenderer.ShaderLayer {
//
//         static type() {
//             return "heatmap";
//         }
//
//         static name() {
//             return "Heatmap";
//         }
//
//         static description() {
//             return "encode data values in opacity";
//         }
//
//         static sources() {
//             return [{
//                 acceptsChannelCount: (x) => x === 1,
//                 description: "The value to map to opacity"
//             }];
//         }
//
//         static get defaultControls() {
//             return {
//                 use_channel0: {  // eslint-disable-line camelcase
//                     default: "r"
//                 },
//                 color: {
//                     default: {type: "color", default: "#fff700", title: "Color: "},
//                     accepts: (type, instance) => type === "vec3",
//                 },
//                 threshold: {
//                     default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
//                     accepts: (type, instance) => type === "float"
//                 },
//                 inverse: {
//                     default: {type: "bool", default: false, title: "Invert: "},
//                     accepts: (type, instance) => type === "bool"
//                 }
//             };
//         }
//
//         getFragmentShaderExecution() {
//             return `
//     float chan = ${this.sampleChannel('v_texture_coords')};
//     bool shows = chan >= ${this.threshold.sample('chan', 'float')};
//     if (${this.inverse.sample()}) {
//         if (!shows) {
//             shows = true;
//             chan = 1.0;
//         } else chan = 1.0 - chan;
//     }
//     if (shows) return vec4(${this.color.sample('chan', 'float')}, chan);
//     return vec4(.0);
// `;
//         }
//     };
//
//     $.FlexRenderer.ShaderMediator.registerLayer($.FlexRenderer.HeatmapLayer);
//
// })(OpenSeadragon);
