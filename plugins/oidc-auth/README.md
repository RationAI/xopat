# OIDC Auth

This plugin adds support for OIDC authentication at the viewer lifecycle.
The plugin stores a 'jwt' secret on the user API. Subsequent requests
then need to include the 'Authorization' header with the 'Bearer' prefix.

TODO: turn the design around: do not create jwt secret but let the
user API to modify each request with 'scope-based' auth storage.