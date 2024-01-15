# Server Templates

Here we simply abstract duplicated code. If some functionality in a given language
is re-used in multiple servers / frameworks, common implementation is templated here.

## The index page

The index page layout is common to all servers, and defines four different template tags
you can init dynamically using javascript (except template `head`) or replace with initialization (e.g., compile):

> ``<template id="template-[type]"></template>``

Where type can be one of:
 - `head`: where header scripts and other tags are rendered, here we should add the core
source files, this is also the only template that do not work if added at runtime
 - `app`: where application initialization happens, this should initialize using `initXopat(...)`.
 - `modules`: where module sources should go
 - `plugins`: where plugin sources should go

The ``/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/`` regex can be used to replace all template tags.

## Compiling

Most template tags can be simply replaced by the output of given functions available from the server 
core implementation. The only thing that needs initialization is the xOpat app. We have to tell the application
all the details it needs for running:

````js
initXopat(
    <PLUGINS: json object describing available plugins and their meta>,
    <MODULES: json object describing available modules and their meta>,
    <CORE: json object describing xOpat metadata configuration>,
    <POST: post data: key value map that plugins might export data to>,
    <session: the xOpat session JSON or callback (see xOpatParseConfiguration(..))>,
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
and expect ``i18next`` object ready to be used.
