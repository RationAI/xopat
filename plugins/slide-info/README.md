# Slide Information and Switching Menu

Adds windows for slide information, file listing and slide overviews.

## Slide Switching Menu
This menu is automatically available for given ``background`` configuration block.

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
