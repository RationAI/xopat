/**
 * Interactive tutorial overlay — the step driver behind
 * `USER_INTERFACE.Tutorials`.
 *
 * Replaces the vendored EnjoyHint (`src/external/enjoyhint.js`, 1809 lines of
 * jQuery + KineticJS + jquery.scrollTo, loaded as three separate startup
 * scripts plus a stylesheet). Authoring is unchanged — see `src/TUTORIALS.md`.
 *
 * Reached as `APPLICATION_CONTEXT.tutorials`; there is no new global.
 */
export { TourEngine } from "./tour-engine";
export type { TourStep, TourHooks, TourOptions } from "./tour-engine";
