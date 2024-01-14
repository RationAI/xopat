# Users in xOpat

Users are managed by a singleton class `XOpatUser`. Implementing login
logics is advised to be managed through a desired module. Example
authentication flow is the following:

 - module enables static configuration of the login logics
   - including an `before-first-open` event priority configuration
   
   ````js
    VIEWER.addHandler('before-first-open', async () => {
        //... do something and once you decide the module
        // either handles the auth or exits as noop, 
        // return the function result - this event
        // asynchronously awaits all handlers and
        // should respect user.isLogged property
   
        const user = XOpatUser.instance();
        if (user.isLogged) {
            return;
        }
        await this.ensureUserLoggedIn(...);
    }, null, this.getStaticMeta('eventBeforeOpenPriority', 0));
    ````
   - module checks in the event whether user has already been logged in
   and exits as no-op if the authentication was handled elsewhere
   - module handles the even asynchronously, so that multiple authentication
   logics can be supported, and the first to succeed is used (depends on
   the event priority).
