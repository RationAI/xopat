# Extra Tutorials
Adds the possibility to create tutorials within an external system and enable them or run them immediately.

The parameters of this plugin expect ``data`` element to be present, an array of objects that have:
- [R]`title` - the tutorial name
- [O]`description` - the tutorial description
- [O]`runDelay` - whether to run the tutorial immediately or not; only first element is run, others are ignored, default `undefined`, otherwise set a MS delay for the tutorial to start, minimum 250ms
- [O]`attach` - whether to enable the user to run the tutorial whenever they want, default `true`
- [O]`confirm` - when truthy, shows a confirmation overlay (built on `UI.IllustratedModal`) before the tutorial starts and the user can decline. Works with or without `runDelay`: if `runDelay` is omitted, the tour starts immediately on accept; otherwise the delay is applied after accept. Pass `true` for defaults or an object to customise:
    - `title` — modal heading
    - `message` — HTML-capable body copy (description is **not** used as a default to keep technical wording out of the overlay)
    - `acceptLabel`, `declineLabel` — button labels
    - `image` — URL of an illustration shown on the right pane (overrides `illustrationIcon`)
    - `illustrationIcon` — Phosphor icon class (e.g. `"ph-graduation-cap"`, `"ph-laptop"`) used when no `image` is provided
    - `accent` — palette accent for the primary button: `"primary"` (default), `"accent"`, `"secondary"`, `"success"`, `"info"`
    - `gradient` — optional CSS background string overriding the default themed gradient on the right pane (e.g. `"linear-gradient(135deg, #6e3afe, #00c4ff)"`)
  Closing the dialog with X counts as decline.
- [R]`content` - the tutorial content, a list of objects of `RULE -> TEXT` mapping that define what rule (context action + selector, e.g. `"click #item"`) maps to what textual description in each tutorial step

Example of running a focus-context simple tutorial upon the opening, without attaching it to available tutorials list:
````json
{
  "plugins": {
    "extra-tutorials":{"data":[{"run":true,"content":[{"click #presenter-play-icon": "Please, click play<br>to run the story."}]}]},
    "recorder": {} //note: ensures the plugin is available when we direct the the tutorial on it
  }
}
````
 


