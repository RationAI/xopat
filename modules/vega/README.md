# Vega the visualization grammar

You can create arbitrary 2D graphs in the viewer. Vega is supported also
by the menu-pages module as a page node type.

````js
new AdvancedMenuPages('myPluginId').buildElements([{
    title: "Graph",
    page: [
        {
            type: 'vega', 
            vega: { ... grammar specs ... }
       }           
    ]
}]);
````
