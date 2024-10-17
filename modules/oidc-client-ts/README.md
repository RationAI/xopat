# OIDC Auth for the User module

``oidc-client-ts`` based module for authentication againts OIDC service.
Performs automated login and token refresh capabilities. Intercepts network
traffic and attaches the JWT token to requests (configurable).

The module works automatically - just configure it and enable it.
Based on the priority, it logs-in a user (if not logged in yet)
on the application startup, and manages automated token retrieval.
