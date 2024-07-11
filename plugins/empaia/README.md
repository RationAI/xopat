# Empaia in xOpat

Empaia uses WBC application to drive iframe rendering of custom viewers. The UI is, however, unsuitable for general
pathology workstations as it is meant to navigate within data using _existing AI apps_, while we
focus on customize-ability: the viewer
should be configurable via plugins into a 
general pathology workstation, research visualization, learning platform and more. Therefore, 
WorkBench Service is accessed directly.

### Opening a Case / Slide
Instead of traditional xOpat session object, you should focus on the empaia plugin.
You will still configure the session, but the empaia plugin also needs to know, 
which cases and slides are to be opened.

````js
{
    cases: {
        "b10648a7-340d-43fc-a2d9-4d91cc86f33f": {
            // reference to data array that belongs to this scope
            slides: [0],
            //optional app to override global app    
            appId: "b10648a7-340d-43fc-a2d9-4d91cc86f33f"  
        }
    }
}
````
