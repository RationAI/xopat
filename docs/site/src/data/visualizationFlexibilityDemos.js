// xOpat session configs for the "Visualization Flexibility" docs page
// (docs/visualization-flexibility.mdx).
//
// Unlike the other demo data modules here, these are NOT transcribed copies:
// they import the very session files the deployment is driven by, in
// `test/fixtures/sessions/`. A demo whose page and whose deployment can disagree is
// a demo that quietly rots, and there is nothing to port — the sessions are
// already plain JSON.
//
// Each config is rendered by <DemoFrame config={…} />, which serializes it onto
// the viewer URL hash.

import multichannel from '../../../../test/fixtures/sessions/viz-flex-multichannel.json';
import geojson from '../../../../test/fixtures/sessions/viz-flex-geojson.json';
import mvt from '../../../../test/fixtures/sessions/viz-flex-mvt.json';
import grid from '../../../../test/fixtures/sessions/viz-flex-grid.json';
import maskCoarse from '../../../../test/fixtures/sessions/viz-flex-mask-coarse.json';
import maskPreview from '../../../../test/fixtures/sessions/viz-flex-mask-preview.json';

/**
 * Presentation-only params applied on top of every session.
 *
 * They belong here rather than in the session files because they are about the
 * embed, not about the visualization: a docs iframe wants no plugin chrome and
 * no cached session bleeding between the six frames on one page, while the same
 * session opened from `npm run up -- viz-flex-demo` wants the full viewer.
 */
const EMBED_PARAMS = {
  bypassCache: true,
  ui: {globalMenu: false},
  disablePluginsUi: true,
  notificationsPosition: 'top',
};

const embed = (session) => ({
  ...session,
  params: {...session.params, ...EMBED_PARAMS},
});

/**
 * These six name fileserver-relative data ids (`slides/…`, `generated/…`) that
 * only a local `npm run fixtures:serve` resolves. The public demo deployment
 * serves `Projects/demo/…` and has never had these files, so an iframe pointed
 * at it boots a viewer and then renders nothing.
 *
 * `requiresLocalData` makes DemoFrame say that instead — the session and the
 * three commands, rather than six confident empty frames.
 */
export const REQUIRES_LOCAL_DATA = true;

/** What a reader has to run to see these for real. */
export const LOCAL_SETUP = [
  'npm run fixtures:fetch            # once: the source slides',
  'npm run fixtures:derive           # once: the derived overlays',
  'npm run fixtures:serve            # terminal 1 — fixture data on :9100',
  'npm run up:dev -- viz-flex-demo   # terminal 2 — the viewer on :9000',
  'npm run fixtures:urls -- --group viz-flex   # terminal 3 — one link per demo',
];

export const multichannelConfig = embed(multichannel);
export const geojsonConfig = embed(geojson);
export const mvtConfig = embed(mvt);
export const gridConfig = embed(grid);
export const maskCoarseConfig = embed(maskCoarse);
export const maskPreviewConfig = embed(maskPreview);
