xOpat has three configuration levels:

1. **static configuration**: available to the system manager, configures the viewer
as shown in the previous chapter. Up-to-date configuration can be generated using
``grunt env``, but it has to be modified (notably the default server to use).
2. **dynamic configuration**: configuration given to the viewer at startup, decides
the viewer session - the data you can view, the dynamic plugin configurations
3. **cached configuration**: anything that is being cached when using the viewer

Higher level overrides values in the lower level. Unsafe values are typically configurable
only with _static configuration_, the _dynamic configuration_ usually setups the actual
workplace for a given user.

## Dynamic configuration & Opening the Viewer

We've seen <http://localhost:9000/?slides=*SLIDE_ID*> way of opening the viewer. In fact,
this only creates default _dynamic configuration_ for the viewer. If you want to have more control,
you can provide such fonfiguration:

 - manually at <http://viewer.url/dev_setup> page
 - programatically **[GET]** <http://viewer.url#visualization=*HTML_ENDODED_CONF*>
 - programatically **[POST]** with ``visualization`` field with the configuration

Example of the configuration:
``` json 
{    
    "params": {
        "theme": "dark"
    }, 
    "data": ["slide_1", "slide_2"],
    "background": [
        {
            "dataReference": 0,
            "lossless": false,
        }
    ],
    "visualizations": [
        {
            "name": "A visualization setup 1",
            "lossless": true,
            "shaders": {
                "shader_id_1": { 
                    "name": "My visualization layer",
                    "type": "heatmap", 
                    "fixed": false,
                    "visible": 1, 
                    "dataReferences": [1],
                    "params": {}
                }
            }      
        }
    ],
    "plugins": {} 
}
```
Typically, you can delete unused keys. They are shown here just for the sake of completeness.
