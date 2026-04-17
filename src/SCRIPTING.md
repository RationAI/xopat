# ScriptManager API Documentation

A secure, singleton-based Web Worker Sandbox designed to run untrusted third-party scripts. It uses MessageChannel and Blob wrapping to ensure scripts remain isolated, preventing them from accessing the host's global scope or hijacking the communication bridge.

---

## 🚀 Quick Start

### 1. Initialization
The ScriptManager is a singleton. Initialize it with your host-side implementation functions.

```javascript
// Actual functions that run on the Main Thread
const hostActions = {
zoomIn: () => console.log("Main Thread: Zooming in..."),
navigateToSlide: (index) => console.log("Main Thread: Moving to slide", index)
};

// Access the singleton
const manager = ScriptManager.instance(hostActions);
```

### 2. Registering Custom Namespaces
Extend the manager dynamically to support new features (like Annotations or Chat).

```javascript
manager.registerNamespace(
'annotations',
{ add: false, remove: false }, // Security Schema (Default: Locked)
{
// Implementations
add: (content) => console.log("Host saved annotation:", content),
remove: (id) => console.log("Host deleted annotation:", id)
}
);
```

### 3. Granting Permissions
Scripts cannot call methods until you explicitly grant consent on the host side.

```javascript
// Grant specific method
manager.setConsent('annotations', 'add', true);

// Grant entire namespace
manager.grantNamespaceConsent('viewer', true);
```

### 4. Creating a Worker
Pass a raw JavaScript string to the manager. It will be wrapped in a secure IIFE sandbox.

```javascript
const pluginCode = `
console.log("Worker started!");

    // Access allowed methods via the 'api' global
    api.viewer.zoomIn();
    api.annotations.add("Hello from the sandbox!");
`;

manager.createWorker(pluginCode, 'plugin-01');
```

## 🛡️ Security Architecture



The manager implements several layers of protection to prevent "Escapes":

1. Closure Isolation: The MessagePort is stored in a private variable inside an IIFE. The plugin script has no lexical access to the port.
2. Listener Lockdown: self.onmessage is frozen as null. Even if the script tries to attach its own onmessage, the host is not listening to the main worker thread.
3. Object Sealing: The api object is defined via Object.defineProperty with configurable: false and writable: false, then frozen.
4. Host-Side Verification: Every incoming message is re-verified against the host's consent map before the function is executed.

---

## 📖 API Reference

### Static Methods
- ScriptManager.instance(actions): Returns the singleton instance.
- ScriptManager.instantiated(): Returns true if the manager is already running.

### Instance Methods
- registerNamespace(ns, schema, impl): Registers a new API group and its functions.
- setConsent(ns, method, bool): Toggles a specific capability for the sandbox.
- grantNamespaceConsent(ns, bool): Toggles all capabilities in a namespace.
- createWorker(script, id): Spawns a new isolated worker from a code string.

---

## ⚠️ Limitations
- URLs not supported: createWorker only accepts serialized strings for security. I.e., scripts you 'have at hand'.
- One-Way Communication: Host-side calls are currently fire-and-forget.