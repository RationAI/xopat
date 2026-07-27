// Ready-made "Developer Setup" example sessions for the docs playground
// (docs/dev-setup-playground.mdx). Each entry is a complete, launchable xOpat
// session JSON that <DemoFrame> serializes onto the viewer URL hash — so the
// "Open the demo in a new tab" link boots a real viewer, and "View session
// configuration" shows the exact JSON to paste into the /dev_setup editor.
//
// IMPORTANT — data must exist on the demo server. The public demo deployment
// only serves the summer-school sample set under
// `Projects/demo/summer-school-coolab/`. A session referencing anything else
// will 404 on this deployment. When the demo data pool grows, add entries here;
// keep every `dataID` inside AVAILABLE_DATA below so the examples stay runnable.
//
// Keep these plain JSON-serializable objects (no functions, no comments in the
// emitted JSON) — they are stringified verbatim into the URL and the docs.

const DATA = 'Projects/demo/summer-school-coolab/';
const id = (name) => DATA + name;

// The data files the public demo server exposes today. Surfaced in the docs so
// authors know what they can point a session at. `channels` notes multichannel.
export const AVAILABLE_DATA = [
  {dataID: id('slide.tiff'), role: 'H&E whole-slide image (use as background)'},
  {dataID: id('heatmap_mask_precomputed.tiff'), role: 'Single-channel model-prediction heatmap'},
  {dataID: id('heatmap_mask_unfinished.tiff'), role: 'Work-in-progress prediction heatmap'},
  {dataID: id('occlusion_mask_precomputed.tiff'), role: 'Signed occlusion-importance map (bipolar)'},
  {dataID: id('occlusion_mask_unfinished.tiff'), role: 'Work-in-progress occlusion map (bipolar)'},
  {dataID: id('gradcam_mask.tiff'), role: 'GradCam intensity map (drive through a colormap)'},
  {dataID: id('ac.tiff'), role: 'Multi-channel activation clusters (6 classes, one per channel)'},
];

// --- 1. Minimal — just the slide ------------------------------------------
export const minimalConfig = {
  data: [id('slide.tiff')],
  background: [{dataReference: 0}],
};

// --- 2. Single heatmap overlay --------------------------------------------
export const heatmapConfig = {
  params: {customBlending: true},
  data: [id('slide.tiff'), id('heatmap_mask_precomputed.tiff')],
  background: [{dataReference: 0}],
  visualizations: [
    {
      name: 'Prediction heatmap',
      shaders: {
        prediction: {
          name: 'Model prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [1],
          params: {opacity: 0.6},
        },
      },
    },
  ],
};

// --- 3. Bipolar importance map --------------------------------------------
// A signed map: positive contribution one colour, negative the other.
export const bipolarConfig = {
  params: {customBlending: true},
  data: [id('slide.tiff'), id('occlusion_mask_precomputed.tiff')],
  background: [{dataReference: 0}],
  visualizations: [
    {
      name: 'Occlusion importance',
      shaders: {
        importance: {
          name: 'Occlusion importance',
          type: 'bipolar-heatmap',
          fixed: false,
          dataReferences: [1],
          params: {
            opacity: 0.7,
            colorHigh: {default: '#00ff00'},
            colorLow: {default: '#ff0000'},
          },
        },
      },
    },
  ],
};

// --- 4. Colormap (GradCam) with a threshold range selector ----------------
export const colormapConfig = {
  params: {customBlending: true},
  data: [id('slide.tiff'), id('gradcam_mask.tiff')],
  background: [{dataReference: 0}],
  visualizations: [
    {
      name: 'GradCam',
      shaders: {
        gradcam: {
          name: 'GradCam',
          type: 'colormap',
          fixed: false,
          dataReferences: [1],
          params: {
            use_gamma: 1,
            opacity: 0.8,
            color: {
              type: 'colormap',
              default: 'Turbo',
              steps: 5,
              mode: 'sequential',
              continuous: true,
            },
            threshold: {breaks: [0.2, 0.4, 0.8, 0.9], mask: [0, 1, 1, 1, 1]},
          },
        },
      },
    },
  ],
};

// --- 5. Several layers at once (heatmap + grid) ---------------------------
// Shows a shaders map with more than one layer; layers stack and each gets its
// own row in the Layers panel (reorder, opacity, on/off).
export const multiLayerConfig = {
  params: {customBlending: true},
  data: [id('slide.tiff'), id('heatmap_mask_precomputed.tiff')],
  background: [{dataReference: 0}],
  visualizations: [
    {
      name: 'Heatmap + grid',
      shaders: {
        prediction: {
          name: 'Model prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [1],
          params: {opacity: 0.55},
        },
        grid: {
          name: 'Helper grid',
          type: 'grid',
          fixed: false,
          dataReferences: [0],
          params: {
            color: {default: '#000000'},
            cell_x: {default: 256},
            cell_y: {default: 256},
          },
        },
      },
    },
  ],
};

// --- 6. Multi-channel TIFF — one class per channel ------------------------
// A single ac.tiff carries all cluster classes as channels; the `options` block
// is forwarded verbatim to the server tile-source (wsi-service `tifffile`
// plugin) to expose every channel. Each layer picks its channel with
// `use_channel_base0`.
const CLUSTER_COLORS = ['#1F77B4', '#2CA02C', '#FF7F0E', '#D62728', '#8C564B', '#17BECF'];
const clusterShaders = {};
CLUSTER_COLORS.forEach((color, i) => {
  clusterShaders[`class_${i + 1}`] = {
    name: `Class ${i + 1}`,
    type: 'heatmap',
    fixed: false,
    dataReferences: [1],
    params: {
      opacity: 0.8,
      use_channel_base0: i,
      threshold: 0,
      color: {default: color},
    },
  };
});

export const multichannelConfig = {
  params: {customBlending: true},
  data: [
    id('slide.tiff'),
    {
      dataID: id('ac.tiff'),
      options: {format: 'tiff', channels: 'all', plugin: 'tifffile'},
    },
  ],
  background: [{dataReference: 0}],
  visualizations: [{name: 'Activation clusters', shaders: clusterShaders}],
};

// --- 7. Two visualizations, switchable from the Layers dropdown -----------
// Same background, two visualization goals — the viewer's Layers panel exposes
// a `shaders` <select> to flip between them (precomputed vs work-in-progress).
export const twoVisualizationsConfig = {
  params: {customBlending: true, activeVisualizationIndex: 0},
  data: [
    id('slide.tiff'),
    id('heatmap_mask_precomputed.tiff'),
    id('heatmap_mask_unfinished.tiff'),
  ],
  background: [{dataReference: 0}],
  visualizations: [
    {
      name: 'Prediction — precomputed',
      shaders: {
        pred_ref: {
          name: 'Model prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [1],
          params: {opacity: 0.6},
        },
      },
    },
    {
      name: 'Prediction — work in progress',
      shaders: {
        pred_wip: {
          name: 'Model prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [2],
          params: {opacity: 0.6},
        },
      },
    },
  ],
};

// Ordered gallery consumed by the playground page.
export const devSetupSessions = [
  {
    key: 'minimal',
    title: 'Minimal — just the slide',
    blurb:
      'The smallest valid session: one data entry used as the background. ' +
      'No visualizations, no overlays.',
    config: minimalConfig,
  },
  {
    key: 'heatmap',
    title: 'Single heatmap overlay',
    blurb:
      'An H&E background with one heatmap layer on top. dataReferences: [1] ' +
      'points the layer at the second data entry.',
    config: heatmapConfig,
  },
  {
    key: 'bipolar',
    title: 'Bipolar importance map',
    blurb:
      'A signed map rendered with bipolar-heatmap — positive values in green, ' +
      'negative in red, transparent around zero.',
    config: bipolarConfig,
  },
  {
    key: 'colormap',
    title: 'Colormap with a threshold selector',
    blurb:
      'GradCam intensities mapped through the Turbo colour ramp. threshold.breaks ' +
      'are the band edges and mask switches each band on/off.',
    config: colormapConfig,
  },
  {
    key: 'multi-layer',
    title: 'Several layers at once',
    blurb:
      'A shaders map with two layers — a heatmap plus a helper grid. Each ' +
      'layer becomes its own reorderable row in the Layers panel.',
    config: multiLayerConfig,
  },
  {
    key: 'multichannel',
    title: 'Multi-channel TIFF (one class per channel)',
    blurb:
      'A single multi-channel ac.tiff exposed via the server options block; ' +
      'each layer selects its channel with use_channel_base0.',
    config: multichannelConfig,
  },
  {
    key: 'two-visualizations',
    title: 'Two visualizations, switchable',
    blurb:
      'Two visualization goals over the same background. The Layers panel shows a ' +
      'dropdown to flip between them — great for reference-vs-candidate comparisons.',
    config: twoVisualizationsConfig,
  },
];
