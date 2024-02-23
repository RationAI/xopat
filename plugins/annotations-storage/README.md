# Annotations Storage Addon

This plugin integrates with the Annotations GUI plugin to provide support
for remote storage of annotation data. The target storage must implement the
storage interface (based on `XOpatStorage.Data`) - this plugin alone does not
implement any specific annotation storage, but rather enables interface-based
integration with the annotations UI.

There are two parts of the integration:
 - when the Annotations GUI plugin is enabled, its UI is extended with server storage options
 - Annotations Module events are subscribed and forwarded to the storage interface.

### But... why using this plugin? Why not doing it on my own?

You _can_ use this plugin to integrate storage capabilities simply by following one JS interface. 
But you can also provide your own logics & UI by
 - integrating with ``Annotations GUI`` plugin and attaching custom UI
 - integrating with ``Annotations`` module events and taking actions on relevant 
  parts.

This plugin implementation is a great example on how this can be done.
