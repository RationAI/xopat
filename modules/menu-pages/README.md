## Advanced Menu Custom Pages

Allows to create non-trivial content in the advanced menu, including graphs.
See below DOCS for the configuration of pages. The configuration supposes an
array of objects, each object contains:

- [R]`title` - the page menu button title
- [O]`icon` - material icon name
- [O]`subtitle` - if set, the page subtitle, otherwise same as title
- [O]`main` - if `false` (default), the page is attached to the previous main page, the first object ignores this property, always main
- [R]`page` - a list of nodes of UI building blocks to generate data reports, where each node contains:
    - [R]`type` - a node type, can be either "columns", "vega" or one of keys of `UIComponents.Elements` interface; based on the node type other
      parameters are supported (interface nodes are described at the definition)
    - [O]`classes` - a space separated list of classes to add to the generated HTML
    - [R type=columns]`children` - a list of nodes to place in columns
    - [R type=vega]`specs` - a VEGA visualization grammar configuration for a particular GRAPH
    - ... other props as specified by the function of the given type


Note that this might not be the newest docs: it is just a copy of the javadoc:

    /**
     * Render TEXT input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for input TEXT field
     */
    textInput: function(options);
    /**
     * Render Checkbox button
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.label
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for checkbox
    */
    checkBox: function(options);
    /**
     * Render color input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @return {string} HTML for color input
    */
    colorInput: function(options);
    /**
     * Render number input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {string || *} options.default default value
     * @param {number} options.min minimum value, default 0
     * @param {number} options.max maximum value, default 1
     * @param {number} options.step allowed increase, default 0.1
     * @return {string} HTML for number input
    */
    numberInput: function(options);
    /**
     * Render select input
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.placeholder hint
     * @param {string || undefined} options.onchange string to evaluate on input change
     * @param {object} options.default default-selected opt_key
     * @param {object} options.options select options, opt_key: 'option text' map
     * @return {string} HTML for select input
    */
    select: function (options)
    /**
     * Render header
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.title
     * @return {string} HTML for header
    */
    header: function (options) 
    /**
     * Render text
     * @param options
     * @param {string} options.classes classes to assign, space-separated
     * @param {string} options.content
     * @return {string} HTML for content text
    */
    text: function (options) 
    /**
     * Render newline
     * @param options no options supported as of now
     */
    newline: function (options) 
