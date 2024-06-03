# Server Templates

Here we simply abstract duplicated code. If some functionality in a given language
is re-used in multiple servers / frameworks, common implementation is templated here.

## JS Templates
Javascript templates implement common server logics used to parse
 - available modules and plugins
 - [todo] localization
 - configuration parameters and environmental variables
 - API for static loading of source files (e.g. functions that return valid `<script>` and other tags)

## HTML Templates
HTML templates are the html backbone of available viewer pages. These include:
 - the index page, the viewer itself including the redirect ability (POST via `#` in the url)
 - the error page that is to be shown on server failure
 - the dev setup page that allows writing custom JSON sessions manually

Html pages require replacement of some parts defined as the following HTML:
> ``<template id="template-[type]"></template>``

The ``/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/`` regex can be used to replace all template tags.
It captures the template type/name which states what part should be placed there. All such replacements
must be a valid HTML string _if not stated otherwise_.


### The index page

The index page layout is common to all servers, and defines four different template tags
you can init dynamically using javascript (except template `head`) or replace with initialization (e.g., compile):
 - `head`: where header scripts and other tags are rendered, here we should add the core
source files, this is also the only template that do not work if added at runtime
 - `app`: where application initialization happens, this should initialize using `initXopat(...)`.
 - `modules`: where module sources should go
 - `plugins`: where plugin sources should go


#### Compiling

Most template tags can be simply replaced by the output of given functions available from the server 
core implementation. The only thing that needs initialization is the xOpat app. We have to tell the application
all the details it needs for running:

````js
initXopat(
    <PLUGINS: json object describing available plugins and their meta>,
    <MODULES: json object describing available modules and their meta>,
    <CORE: json object describing static xOpat configuration, see the existing core config parsing implementations>,
    <DATA: the viewer data: key value map that plugins might export data to; 'visualization': {viewer session}>,
    '<PLUGINS_FOLDER: the path to plugins so that browser can import scripts>',
    '<MODULES_FOLDER: the path to modules so that browser can import scripts>',
    '<VERSION: the version tag>',
    //i18next init config, other values are overridden internallyZ
    {
        resources: <data: map of tag:localization data>,
        lng: '<language: can also come as a GET parameter>',
    }
);
````
The i18next configuration can be omitted, then we assume the initialization was done
and expect ``i18next`` object ready to be used. The data object:
 - must be an object, the available POST DATA if the server implementation supports POST
 - can be empty otherwise
 - can contain anything the server considers crucial, but must keep the structure:
   - key ``visualization`` describes the viewer dynamic session (see `/src/README.md`)
   - custom keys of plugins that store their data

### The error page

The error page must be provided with all the following replacements:
- `head`: where header scripts and other tags are rendered, here we require primer and jquery dependencies
- `text-title`:  the translated string for `Error` title
- `text-details`: the translated string for 'more details' button text
- `custom`: here you should provide a button that takes the user back to where they came from, and add other custom HTML
- `display-error-call`: where you should provide JS script tag that calls `DisplayError.show(title, description);`. Note that description can contain `<code>` block that gets formatted.

You can of course add more features if you like to each of the templates.

### The Developer Setup page
The dev setup page defines the following replacements:
- `head`: where header scripts and other tags are rendered, here we require 
  - CORE: ``primer``, `jquery`, `env`, `deps`
  - PLUGINS & MODULES: ``webgl``
- `form-init`:  optional JS script that can override the following `window.formInit` object (defaults are shown):
  ````html
    <script type="text/javascript">
    window.formInit = {
        location: "/",
        lang: {
            ready: "Ready!"
        }
    }     
    </script>
  ````
