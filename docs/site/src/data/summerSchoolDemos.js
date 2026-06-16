// xOpat session configs for the "Summer School Demos" docs page
// (docs/summer-school-demo.mdx). These mirror the `display(server, config, …)`
// payloads from the summer-school colab notebooks, ported to static JSON:
//   - Python literals True/False/None -> JS true/false/null
//   - data IDs re-homed from `ECDP2026/` to `Projects/demo/summer-school-coolab/`
// Each config is rendered by <DemoFrame config={…} />, which serializes it onto
// the viewer URL hash. Keep these plain JSON-serializable objects.

const DATA = 'Projects/demo/summer-school-coolab/';
const id = (name) => DATA + name;

// --- Occlusion masks -------------------------------------------------------
// Two visualizations: a "Precomputed" reference and the work-in-progress
// "Ours" set, switchable from the Layers-panel visualization dropdown.
export const occlusionConfig = {
  params: {
    activeBackgroundIndex: 0,
    bypassCache: true,
    ui: {globalMenu: false},
    disablePluginsUi: true,
    notificationsPosition: 'top',
  },
  data: [
    id('slide.tiff'),                       // 0
    id('occlusion_mask_precomputed.tiff'),  // 1
    id('occlusion_mask_unfinished.tiff'),   // 2
    id('heatmap_mask_precomputed.tiff'),    // 3
    id('heatmap_mask_unfinished.tiff'),     // 4
  ],
  background: [
    {dataReference: 0, goalIndex: 0},
    {dataReference: 0, goalIndex: 1},
  ],
  visualizations: [
    {
      name: 'Occlusion - Precomputed',
      shaders: {
        occlusion_heatmap: {
          name: 'Model Prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [3],
          params: {
            opacity: 0.5,
            color: {interactive: false},
            inverse: {interactive: false},
          },
        },
        occlusion_importance: {
          name: 'Occlusion Importance',
          type: 'bipolar-heatmap',
          fixed: false,
          dataReferences: [1],
          params: {
            colorHigh: {default: '#00ff00', interactive: false},
            colorLow: {default: '#ff0000', interactive: false},
          },
        },
        grid: {
          name: 'Helper grid',
          type: 'grid',
          dataReferences: [0],
          params: {
            color: {default: '#000000', interactive: false},
            cell_x: {default: 256},
            cell_y: {default: 256},
            offset_x: {interactive: false},
            offset_y: {interactive: false},
            adaptive_lod: {interactive: false},
          },
        },
      },
    },
    {
      name: 'Occlusion - Ours',
      shaders: {
        occlusion_heatmap_ours: {
          name: 'Model Prediction',
          type: 'heatmap',
          fixed: false,
          dataReferences: [4],
          params: {
            opacity: 0.5,
            color: {interactive: false},
            inverse: {interactive: false},
          },
        },
        occlusion_importance_ours: {
          name: 'Occlusion Importance',
          type: 'bipolar-heatmap',
          fixed: false,
          dataReferences: [2],
          params: {
            opacity: 0.5,
            colorHigh: {default: '#00ff00', interactive: false},
            colorLow: {default: '#ff0000', interactive: false},
          },
        },
        grid_2: {
          name: 'Helper grid',
          type: 'grid',
          dataReferences: [0],
          params: {
            color: {default: '#000000', interactive: false},
            cell_x: {default: 256},
            cell_y: {default: 256},
            offset_x: {interactive: false},
            offset_y: {interactive: false},
            adaptive_lod: {interactive: false},
          },
        },
      },
    },
  ],
  plugins: {
    'extra-tutorials': {
      data: [
        {
          title: 'ECDP2026: Occlusion masks',
          attach: true,
          runDelay: 600,
          confirm: {
            title: 'Welcome to xOpat',
            message:
              'Quick orientation around the viewer — under a minute.' +
              '<br/>You can re-run it any time from the tutorials menu.',
            acceptLabel: 'Show me around',
            declineLabel: 'Skip',
          },
          content: [
            {
              'next #viewer-container':
                'This is the slide viewer. Pan with drag, zoom with the mouse wheel. ' +
                'In the notebook, you need to hold Ctrl/Cmd while scrolling. ' +
                'This is enabled in order to not to interfere with the notebook UI. ' +
                'Here, two overlays render on top of the H&E slide — a heatmap and a bipolar importance map.',
            },
            {
              'next #osd-0-right-menu-menu-b-opened-navigator':
                'The Navigator tab opens a minimap of the slide. ' +
                'The navigator is fully interactive position preview.',
            },
            {
              'click #osd-0-right-menu-menu-b-opened-shaders':
                'Click here to open the Layers tab — it lists the overlays ' +
                '(heatmap, bipolar importance, helper grid) for the current visualization.',
            },
            {
              "next #osd-0-right-menu-menu-c-shaders select[name='shaders']":
                'Switch between <b>Occlusion — Precomputed</b> (full reference) and ' +
                '<b>Occlusion — Ours</b> (your work-in-progress masks) from this dropdown.',
            },
            {
              'next #fullscreen-button':
                'Hides all UI chrome so the slide takes the whole window. Click again to bring it back.',
            },
            {
              'next #visual-menu-b-view':
                'The View menu re-opens hidden menus, toggles panels — ' +
                "handy if you've hidden something by accident.",
            },
          ],
        },
      ],
    },
  },
};

// --- GradCam ---------------------------------------------------------------
// A single GradCam visualization driven by the work-in-progress mask, rendered
// through a `colormap` shader with an interactive threshold/range selector.
export const gradcamConfig = {
  params: {
    activeBackgroundIndex: [0],
    bypassCache: true,
    ui: {globalMenu: false},
    disablePluginsUi: true,
    notificationsPosition: 'top',
  },
  data: [
    id('slide.tiff'),       // 0
    id('gradcam_mask.tiff'),// 1
  ],
  background: [
    {dataReference: 0, goalIndex: 0},
    {dataReference: 0, goalIndex: 1},
  ],
  visualizations: [
    {
      name: 'GradCam',
      shaders: {
        'gradcam-ours': {
          name: 'Gradcam',
          type: 'colormap',
          fixed: false,
          dataReferences: [1],
          params: {
            use_gamma: 1,
            opacity: 0.8,
            connect: false,
            color: {
              type: 'colormap',
              default: 'Turbo',
              steps: 5,
              mode: 'sequential',
              continuous: true,
            },
            threshold: {
              breaks: [0.2, 0.4, 0.8, 0.9],
              mask: [0, 1, 1, 1, 1],
            },
          },
        },
      },
    },
  ],
  plugins: {
    'extra-tutorials': {
      data: [
        {
          title: 'GradCam comparison: align and inspect',
          attach: true,
          runDelay: 600,
          confirm: {
            title: 'Compare your GradCam to the reference',
            message:
              'Two viewers side-by-side: the <b>precomputed reference</b> ' +
              "and <b>your model's output</b>. We'll align them with a " +
              'couple of clicks so you can scrutinize differences.',
            acceptLabel: 'Walk me through it',
            declineLabel: 'Skip',
          },
          content: [
            {
              'next #osd-0':
                'On the slide we can see the computed GradCam overlay.',
            },
            {
              'click #osd-0-right-menu-menu-b-opened-shaders':
                'Click here to open the Layers tab as before.',
            },
            {
              'click #vosd0_gradcamours-shader .er-control__body--advanced-slider':
                'The colormap range selector is fully interactive. ' +
                'You can move the knobs and click on the red intervals to disable them.',
            },
            {
              'next #vosd0_gradcamours_connect':
                'If you need the color to follow your knobs, use this checkbox.',
            },
          ],
        },
      ],
    },
  },
};

// --- Activation clusters ---------------------------------------------------
// Palette deliberately avoids pink/purple hues (confusable with H&E tissue).
const baseClusterColors = [
  '#1F77B4', // blue
  '#2CA02C', // green
  '#FF7F0E', // orange
  '#D62728', // red
  '#8C564B', // brown
  '#17BECF', // cyan
  '#BCBD22', // olive
  '#7F7F7F', // gray
  '#006D77', // teal
  '#E76F51', // coral
  '#264653', // dark teal
  '#F4A261', // sand orange
];
const N_CLUSTERS = 6; // subset of the palette to keep the demo legible

const heatmapShaders = {};
const hatchShaders = {};
for (let cls = 0; cls < N_CLUSTERS; cls++) {
  const color = baseClusterColors[cls % baseClusterColors.length];
  heatmapShaders[`class_${cls + 1}`] = {
    name: `Class ${cls + 1} Heatmap`,
    type: 'heatmap',
    fixed: false,
    dataReferences: [1],
    params: {
      opacity: 0.8,
      use_channel_base0: cls,
      threshold: 0,
      color: {default: color},
      inverse: {interactive: false},
    },
  };
  hatchShaders[`class_${cls + 1}_hatch`] = {
    name: `Class ${cls + 1} Pattern Map`,
    type: 'patternmap',
    fixed: false,
    dataReferences: [1],
    params: {
      opacity: 0.9,
      use_channel_base0: cls,
      threshold: 0,
      pattern_type: 2,
      spacing: 7,
      line_width: 2.5,
      offset_x: 1.5 * cls,
      offset_y: 1.5 * cls,
      rotation: 17 * cls,
      color: {default: color},
      inverse: {interactive: false},
    },
  };
}

export const activationClustersConfig = {
  params: {
    activeBackgroundIndex: 0,
    bypassCache: true,
    visualizationInspectorEnabled: true,
    visualizationInspectorMode: 'reveal-outside',
    disablePluginsUi: true,
    notificationsPosition: 'top',
  },
  data: [
    id('slide.tiff'),
    {
      dataID: id('ac.tiff'),
      options: {
        format: 'tiff',
        channels: 'all',
        plugin: 'tifffile',
      },
    },
  ],
  background: [{dataReference: 0, goalIndex: 0}],
  visualizations: [
    {name: 'Activation Clusters', shaders: heatmapShaders},
    {name: 'Activation Clusters (Hatching)', shaders: hatchShaders},
  ],
  plugins: {
    'extra-tutorials': {
      data: [
        {
          title: 'Activation Clusters: inspect & tweak',
          attach: true,
          runDelay: 600,
          confirm: {
            title: 'Inspect and reshape the cluster map',
            message:
              'Two quick things: how to peek under the overlay, ' +
              'and how to reshape the colormap without touching the session config.',
            acceptLabel: 'Show me',
            declineLabel: 'Skip',
          },
          content: [
            {
              'next #osd-0':
                '<b>Hover over the slide.</b> The visualization inspector ' +
                '(<code>reveal-outside</code> mode) fades the cluster overlay away under your ' +
                'cursor so you can see the H&amp;E underneath. Move the mouse away to bring it back.',
            },
            {
              'next #visual-menu-b-edit':
                'The inspector is configurable from the <b>Edit</b> menu — toggle it off entirely, ' +
                'or swap between <i>reveal-outside</i> (overlay disappears under cursor) and ' +
                '<i>reveal-inside</i> (overlay shows only under cursor).',
            },
            {
              'click #osd-0-right-menu-menu-b-opened-shaders':
                'Open the <b>Layers</b> tab — that is where you can play with individual classes. ' +
                'You can also select a different style, a pattern heatmap, from the top select.',
            },
            {
              'next #osd-0-right-menu-menu-opendiv-shaders':
                '<b>Activation Clusters are shown as individual layers.</b><br/>' +
                'And they overlap. You can reorder layers, change opacity, turn them on/off.',
            },
            {
              "next #osd-0-right-menu-menu-opendiv-shaders select[name='shaders']":
                "<b>You can try alternative 'hatching' which tries to solve overlaps with different grid overlays.</b>",
            },
            {
              'next #osd-0':
                'Want to experiment without touching the session? <b>Right-click anywhere on the ' +
                'slide</b> and pick <b>Viewer → Open Visualization Playground</b>. ' +
                'It clones the current visualization into a sandbox where you can change shader ' +
                'type, palette, breaks, params — anything — and the underlying display() config ' +
                'stays untouched.',
            },
          ],
        },
      ],
    },
  },
};
