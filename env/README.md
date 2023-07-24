# xOpat Default Deployment Configuration

This README describes options for xOpat configurations and available core configuration details.
For details on modules and plugin configurations, see respective READMEs in given folders.

Default static configuration for plugins, modules and the viewer itself can be overridden
in ``env.json`` file. The full configuration is compiled for you (with comments) in `env.example.json`.
Only fields that are to be overridden can be present.

To compile the `env.example.json`, run

> grunt env

Then, you can simply override values you need to change, simply follow the `env.example.json` file. It looks like this:
````json
{
  "core": {
      //In particular, you will want to provide a path to redirect in case of errors
      "gateway": "../",
      "active_client": "localhost",
      "client": {
          "localhost": {
              ...
          }
      },
      ...
  },
  "plugins": [
      //here goes plugins configuration as a list of objects
  ],
  "modules": [
      //here goes modules configuration as a list of objects
  ]
}
````

### Static configuration provided in a dynamic way
To provide a configuration file path, you can set 
``XOPAT_ENV`` environmental variable to specify
 - a file path, if the file exists and _is readable_, it will try to parse its contents,
 - a string data, its contents will be treated as a serialized JSON,
 - otherwise, ``env/env.json`` is used (if exists)

### Environmental variables
You can use custom environment variables as a string values like this: ``<% ENV_VAR_NAME %>``.
If ``X=3`` then `"watch <%X%>"` will result in `"watch 3"`. The pattern used is
> ``<%\s*[a-zA-Z_][a-zA-Z0-9_]*\s*%>``

which basically says
 - start with `<%`
 - continue with any whitespace including newlines `\s*`
 - allowed a single word, name of variable, that does not start with a number: `[a-zA-Z_][a-zA-Z0-9_]*`
 - and backwards
