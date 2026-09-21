# Slide Information and Switching Menu

Adds windows for slide information, file listing and slide overviews.

## Slide Switching Menu
This menu is automatically available for given ``background`` configuration block.

Slides are listed as compact rows. Clicking a row opens the slide in the active
viewport (or focuses the viewport that already shows it); the split button offers
opening in a specific viewport or a new one. Rows can also be **dragged onto the
viewer area**. Drop intent is dwell-based: a quick drop opens the slide in a
**new** viewport (non-destructive default), while **holding over an occupied
viewport for a moment** switches the drop to *replace* that viewport — a floating
label and the outline style (dashed = new, solid = replace) announce the current
intent. Dropping on an empty placeholder viewport fills it.

Opening a slide that is already open is treated as a user mistake: the UI focuses
the existing viewport (with an info toast) instead of opening a duplicate. The
programmatic path (``APPLICATION_CONTEXT.openViewerWith``) is intentionally not
restricted — two viewports on the same slide remain possible via the API.

Closing a viewport (single close or "Close all") never removes the slide from the
``config.background`` catalog — the slide stays listed in the switcher as
available and can be reopened; only its viewport is torn down.

## Slide Information
Moreover, any Slide Information is displayed from the provided metadata getter of the background
tileSource object. Supported is any value, the parser tries to guess a suitable UI representation
for the given JSON structure. If ``info`` field is present, it is used to display the slide information.
Otherwise, the whole return value is used.

``````js
   getMetadata() {
        return {
            info: {...}
        };
    }
``````

## Slide Browser
Hierarchy browser is available for any data source. It uses the ``Explorer`` component from UI.
