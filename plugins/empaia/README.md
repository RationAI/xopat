# Empaia in xOpat

Empaia uses WBC application to drive iframe rendering of custom viewers. The UI is, however, unsuitable for general
pathology workstations as it is meant to navigate within data using _existing AI apps_, while we
focus on customize-ability: the viewer
should be configurable via plugins into a 
general pathology workstation, research visualization, learning platform and more. Therefore, 
WorkBench Service is accessed directly.

### Opening a Case / Slide
Instead of traditional xOpat session object, you should focus on the empaia plugin.
You can still configure the session to your will (and it will be respected),
but the empaia plugin needs to know, which cases and slides are to be opened.

It also automatically fills the necessary data into the session for you if you don't
provide one, therefore it is easier to use.

````js
{
    cases: {
        "b10648a7-340d-43fc-a2d9-4d91cc86f33f": {
            slides: ["b10648a7-340d-43fc-a2d9-4d91cc86f33f"]    
        }
    }
}
````

This way, you can open a specific case and its slides. If `slides` are omitted, all slides of the particular
case are opened.
