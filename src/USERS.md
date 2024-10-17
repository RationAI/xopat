# Users in xOpat

Users are managed by a singleton class `XOpatUser`. Implementing login
logics is advised to be managed through a desired module. Example
authentication flow is the following:

 - module enables static configuration of the login logics
   - including an `before-first-open` event priority configuration
   
   ````js
    VIEWER.addHandler('before-first-open', async event => {
        //... do something and once you decide the module
        // either handles the auth or exits as noop, 
        // return the function result - this event
        // asynchronously awaits all handlers and
        // should respect user.isLogged property
   
        const user = XOpatUser.instance();
        if (user.isLogged) {
            return;
        }
        await this.myRoutineEnsureUserLoggedIn(...);
    }, null, this.getStaticMeta('eventBeforeOpenPriority', 0));
    ````
   - module checks in the event whether user has already been logged in
   and exits as no-op if the authentication was handled elsewhere
   - module handles the even asynchronously, so that multiple authentication
   logics can be supported, and the first to succeed is used (depends on
   the event priority).

## Handling Secrets

Depending on the authentication module or plugin used, 
the user secret might be populated with a secret data:
this data is a string value and its semantics is dependent on the
authentication party. Typically:

````js
const user = XOpatUser.instance();
if (user.isLogged) {
   console.info("Already logged in: no-op.", user);
   return;
}

//... do some login logics

user.login(userid, username, ""); //login with ID, name and possibly icon
user.setSecret(someSecret, "jwt"); //optionally set secret, default type=jwt
user.addOnceHandler('logout', () => {
    //act upon logout
    user.setSecret(null, "jwt"); //this is an example
});
user.addHandler('secret-needs-update', async event => {
    //you should refresh token in case this event happens
    console.log(event.type);
});
````

And other parts of the system can use this data to perform required
actions. See the snipplet below about handling the user secret data:
````js
const user = XOpatUser.instance();
if (user.isLogged) {
    const secret = user.getSecret("jwt"); //default jwt
    //do something with the secret, note it might be not set, and
    // although it is typically encoded JWT, its syntax depends on the
    // auth module used
    user.addHandler('secret-updated', event => {
        console.log("Secret updated!", event.secret, event.type);
    });
    user.addHandler('secret-removed', event => {
        //this event is NOT called oupon logout, all tokens are erased
        console.log("Secret removed!", event.type);
    });
    
    //you can trigger request for secret update
    // (fires 'secret-needs-update'), which in turn
    // should trigger 'secret-updated' 
    await user.requestSecretUpdate("jwt");
}
````

