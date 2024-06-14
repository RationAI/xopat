# EmpationAPI Service

A library for communication with empaia-compliant WSI infrastructure.

> [!CAUTION]
> Due to missing features in the empaia standard, this library supports
> additional functionality that relies on certain data available in the system.
> This data need not to be imported, but then the library full features will
> not be available.

The API is exposed by the EmpationAPI namespace. The library functionality
is available (for V3) as ``EmpationAPI.V3``, and a ready-to-use instance of the
API connector (`Root` instance) can be obtained using ``EmpationAPI.V3.get()``.

### Authentication

Auth is expected to be done by intercepting requests and passing token information
to requests that _do not_ set the auth header themselves. Auth url depends on
the infrastructure itself and is not part of the API specs.

This module works well with `oidc-client-ts` module.

### xOpat Protocol

To use xOpat protocol definition with this service, you must not specify
a url - this is resolved and handled internally. Instead, you
must provide slide IDs you want to access, and pass the following configuration:

````json
{
    "type": "leav3",
    "slide": "<slide_id>"   
}
````
This configuration _must be serialized_ and provided as a string output instead
of an url. Furthermore, server specification must refer to this module by
custom protocol URL: ``xo.module://empation-api`` (which tells the system)
this functionality is handled elsewhere and by whom.

Full example of configuration for env file looks like this:

````js
...
"image_group_server": "xo.module://empation-api", // a string
"image_group_protocol": "`{\"type\":\"leav3\",\"slide\":\"${data}\"}`", // one-liner returns serialized JSON
"image_group_preview": null,  // handled event-wise
...
````
