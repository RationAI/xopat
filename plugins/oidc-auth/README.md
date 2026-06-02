# OIDC Auth

This plugin adds support for OIDC authentication at the viewer lifecycle.
The plugin stores a 'jwt' secret on the user API. Subsequent requests
then need to include the 'Authorization' header with the 'Bearer' prefix,
or better yet, rely on built-in HTTP Client API.

It authenticates the user against the default auth scope. If you need custom
auth scopes, your module/plugin needs to use the underlying module and create a custom login session.

### Technical Note

This plugin adds auth for the default context. For other context authentications,
the particular module/plugin needs to use the underlying module and create custom login session if enecessary.