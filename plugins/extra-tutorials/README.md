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
    - `gradient` — optional CSS background string overriding the default backdrop. The default is a theme-reactive pastel: fixed pastel hue stops multiplied against `oklch(var(--b1))` (the active theme's surface) via `background-blend-mode: multiply`, so light themes show soft sherbet and dark themes show a muted dim-pastel variant. Pass a CSS gradient string to override (e.g. `"linear-gradient(135deg, #6e3afe, #00c4ff)"`); the multiply still applies, so custom gradients also dim naturally in dark mode.
  Closing the dialog with X counts as decline.
- [R]`content` - the tutorial content, a list of objects of `RULE -> TEXT` mapping that define what rule (context action + selector, e.g. `"click #item"`) maps to what textual description in each tutorial step

## Allowed HTML in text fields
Every external string (`title`, `description`, all `confirm.*` text fields, every step description in `content`) is sanitised at plugin load via the `sanitize-html` module. The allowlist is intentionally narrow — only lightweight formatting tags survive:

`<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<br>`, `<code>`, `<span>`, `<sub>`, `<sup>`

Everything else is unwrapped to plain text. **All attributes are dropped** (including `style`, `class`, and every `on*` event handler). Anchor / link tags are not allowed. Two non-HTML fields have their own guards:

- `confirm.image` — rejected when it starts with `javascript:` (the modal then falls back to the icon illustration).
- `confirm.gradient` — rejected when it contains `<`, `>`, or `javascript:` (the modal then falls back to the default themed gradient).

Step rule keys (e.g. `"click #item"`) are not HTML and any key containing `<` is discarded.

## Example
Example of running a focus-context simple tutorial upon the opening, without attaching it to available tutorials list:
````json
{
  "plugins": {
    "extra-tutorials":{"data":[{"run":true,"content":[{"click #presenter-play-icon": "Please, click play<br>to run the story."}]}]},
    "recorder": {} //note: ensures the plugin is available when we direct the the tutorial on it
  }
}
````
 


