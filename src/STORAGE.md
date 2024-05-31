# XOpat - Managing the Viewer Storage

By default, the viewer allows sharing data via
 - URL exports: these carry over only the explicit session storage (and turn off cached storages - cache and cookies -
 when viewed)
 - FILE exports: contain all the viewer data AS-IS (except when a plugin does not properly implement
 the persistence API)

More on the default persistence is described in plugins/modules. Other than that,
the viewer supports web Storage API (and its `async` brother) that can decide on
where and how all the viewer data is stored.

## Managing Custom Storages

xOpat offers three basic abstract storage providers:
 - ``XOpatStorage.Data`` (async)
 - ``XOpatStorage.Cache``
 - ``XOpatStorage.Cookies``

Furthermore, ``APPLICATION_CONTEXT`` has `AppCache` and `AppCookies` instances
that are to be used for the cache and cookies storage. You should use these
providers to store your temporary data. Plugins nor Modules should need
to create these, the base class for both offers direct cache store api routed
exactly to these storages.

> If you want to write a simple plugin/module, following knowledge is probably
irrelevant to you. If you want to control the data flow in the viewer
(e.g. connecting to desired API), here you can find useful directions.

### Storage Providers
Providers are either sync or async, and provide simple pair of
get-set methods (get can specify default value). Furthermore,
``Cache`` and `Cookies` are bypassed if the viewer configuration requires so.

These storage providers accept storage driver which can be registered for a provider.
All instances of that provider will use the driver to store the data.

### Storage Drivers
Storage drivers are either classes or instances that execute storage actions.
Available storage interfaces are
 - ``Storage`` (meant for passing e.g. `localStorage`) or `XOpatStorage.Storage` (meant for
 custom class implementation, mirrors the `Storage` interface)
 - ``AsyncStorage`` (does not exist, reserved name for future) or `XOpatStorage.AsyncStorage`
 (custom implementations)
 - ``CookiesStorage`` that, when used with `Cookies` provider can provide additional method `with`
able to provide set parameters for the consecutive setters (e.g. set custom expiration). Note
that such options are not (yet) standardized and depend on the underlying driver.

Async drivers are usable only within async providers and vice versa.

When a provider is crated, it uses the last driver it was registered with.
Registration checks the direct interface inheritance and can be:
 - ``Provider.registerClass(class extends $Driver {...})`` registered as a class for custom implementations, or
 - ``Provider.registerInstance(localStorage)`` registered as an instance.

Registered instances are shared drivers between providers. Registered classes depend on the implementation.

Notable are the builtin ``AppCache`` and `AppCookies` stores, that
must be registered (if one wants to redefine defaults) with drivers before app lifecycle spins up (see events).
Already instantiated provider cannot change its driver.

> Note: built-in browser 'drivers' such as ``localStorage`` are directly use-able.
