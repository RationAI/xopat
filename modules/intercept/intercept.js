(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// shim for using process in browser
    var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

    var cachedSetTimeout;
    var cachedClearTimeout;

    function defaultSetTimout() {
        throw new Error('setTimeout has not been defined');
    }
    function defaultClearTimeout () {
        throw new Error('clearTimeout has not been defined');
    }
    (function () {
        try {
            if (typeof setTimeout === 'function') {
                cachedSetTimeout = setTimeout;
            } else {
                cachedSetTimeout = defaultSetTimout;
            }
        } catch (e) {
            cachedSetTimeout = defaultSetTimout;
        }
        try {
            if (typeof clearTimeout === 'function') {
                cachedClearTimeout = clearTimeout;
            } else {
                cachedClearTimeout = defaultClearTimeout;
            }
        } catch (e) {
            cachedClearTimeout = defaultClearTimeout;
        }
    } ())
    function runTimeout(fun) {
        if (cachedSetTimeout === setTimeout) {
            //normal enviroments in sane situations
            return setTimeout(fun, 0);
        }
        // if setTimeout wasn't available but was latter defined
        if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
            cachedSetTimeout = setTimeout;
            return setTimeout(fun, 0);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedSetTimeout(fun, 0);
        } catch(e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
                return cachedSetTimeout.call(null, fun, 0);
            } catch(e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
                return cachedSetTimeout.call(this, fun, 0);
            }
        }


    }
    function runClearTimeout(marker) {
        if (cachedClearTimeout === clearTimeout) {
            //normal enviroments in sane situations
            return clearTimeout(marker);
        }
        // if clearTimeout wasn't available but was latter defined
        if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
            cachedClearTimeout = clearTimeout;
            return clearTimeout(marker);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedClearTimeout(marker);
        } catch (e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
                return cachedClearTimeout.call(null, marker);
            } catch (e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
                // Some versions of I.E. have different rules for clearTimeout vs setTimeout
                return cachedClearTimeout.call(this, marker);
            }
        }



    }
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;

    function cleanUpNextTick() {
        if (!draining || !currentQueue) {
            return;
        }
        draining = false;
        if (currentQueue.length) {
            queue = currentQueue.concat(queue);
        } else {
            queueIndex = -1;
        }
        if (queue.length) {
            drainQueue();
        }
    }

    function drainQueue() {
        if (draining) {
            return;
        }
        var timeout = runTimeout(cleanUpNextTick);
        draining = true;

        var len = queue.length;
        while(len) {
            currentQueue = queue;
            queue = [];
            while (++queueIndex < len) {
                if (currentQueue) {
                    currentQueue[queueIndex].run();
                }
            }
            queueIndex = -1;
            len = queue.length;
        }
        currentQueue = null;
        draining = false;
        runClearTimeout(timeout);
    }

    process.nextTick = function (fun) {
        var args = new Array(arguments.length - 1);
        if (arguments.length > 1) {
            for (var i = 1; i < arguments.length; i++) {
                args[i - 1] = arguments[i];
            }
        }
        queue.push(new Item(fun, args));
        if (queue.length === 1 && !draining) {
            runTimeout(drainQueue);
        }
    };

// v8 likes predictible objects
    function Item(fun, array) {
        this.fun = fun;
        this.array = array;
    }
    Item.prototype.run = function () {
        this.fun.apply(null, this.array);
    };
    process.title = 'browser';
    process.browser = true;
    process.env = {};
    process.argv = [];
    process.version = ''; // empty string to avoid regexp issues
    process.versions = {};

    function noop() {}

    process.on = noop;
    process.addListener = noop;
    process.once = noop;
    process.off = noop;
    process.removeListener = noop;
    process.removeAllListeners = noop;
    process.emit = noop;
    process.prependListener = noop;
    process.prependOnceListener = noop;

    process.listeners = function (name) { return [] }

    process.binding = function (name) {
        throw new Error('process.binding is not supported');
    };

    process.cwd = function () { return '/' };
    process.chdir = function (dir) {
        throw new Error('process.chdir is not supported');
    };
    process.umask = function() { return 0; };

},{}],2:[function(require,module,exports){
    "use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/glossary.ts
    var IS_PATCHED_MODULE = Symbol("isPatchedModule");

// src/Interceptor.ts
    var _logger = require('@open-draft/logger');
    var _stricteventemitter = require('strict-event-emitter');
    function getGlobalSymbol(symbol) {
        return (
            // @ts-ignore https://github.com/Microsoft/TypeScript/issues/24587
            globalThis[symbol] || void 0
        );
    }
    function setGlobalSymbol(symbol, value) {
        globalThis[symbol] = value;
    }
    function deleteGlobalSymbol(symbol) {
        delete globalThis[symbol];
    }
    var InterceptorReadyState = /* @__PURE__ */ ((InterceptorReadyState2) => {
        InterceptorReadyState2["INACTIVE"] = "INACTIVE";
        InterceptorReadyState2["APPLYING"] = "APPLYING";
        InterceptorReadyState2["APPLIED"] = "APPLIED";
        InterceptorReadyState2["DISPOSING"] = "DISPOSING";
        InterceptorReadyState2["DISPOSED"] = "DISPOSED";
        return InterceptorReadyState2;
    })(InterceptorReadyState || {});
    var Interceptor = class {
        constructor(symbol) {
            this.symbol = symbol;
            this.readyState = "INACTIVE" /* INACTIVE */;
            this.emitter = new (0, _stricteventemitter.Emitter)();
            this.subscriptions = [];
            this.logger = new (0, _logger.Logger)(symbol.description);
            this.emitter.setMaxListeners(0);
            this.logger.info("constructing the interceptor...");
        }
        /**
         * Determine if this interceptor can be applied
         * in the current environment.
         */
        checkEnvironment() {
            return true;
        }
        /**
         * Apply this interceptor to the current process.
         * Returns an already running interceptor instance if it's present.
         */
        apply() {
            const logger = this.logger.extend("apply");
            logger.info("applying the interceptor...");
            if (this.readyState === "APPLIED" /* APPLIED */) {
                logger.info("intercepted already applied!");
                return;
            }
            const shouldApply = this.checkEnvironment();
            if (!shouldApply) {
                logger.info("the interceptor cannot be applied in this environment!");
                return;
            }
            this.readyState = "APPLYING" /* APPLYING */;
            const runningInstance = this.getInstance();
            if (runningInstance) {
                logger.info("found a running instance, reusing...");
                this.on = (event, listener) => {
                    logger.info('proxying the "%s" listener', event);
                    runningInstance.emitter.addListener(event, listener);
                    this.subscriptions.push(() => {
                        runningInstance.emitter.removeListener(event, listener);
                        logger.info('removed proxied "%s" listener!', event);
                    });
                    return this;
                };
                this.readyState = "APPLIED" /* APPLIED */;
                return;
            }
            logger.info("no running instance found, setting up a new instance...");
            this.setup();
            this.setInstance();
            this.readyState = "APPLIED" /* APPLIED */;
        }
        /**
         * Setup the module augments and stubs necessary for this interceptor.
         * This method is not run if there's a running interceptor instance
         * to prevent instantiating an interceptor multiple times.
         */
        setup() {
        }
        /**
         * Listen to the interceptor's public events.
         */
        on(event, listener) {
            const logger = this.logger.extend("on");
            if (this.readyState === "DISPOSING" /* DISPOSING */ || this.readyState === "DISPOSED" /* DISPOSED */) {
                logger.info("cannot listen to events, already disposed!");
                return this;
            }
            logger.info('adding "%s" event listener:', event, listener);
            this.emitter.on(event, listener);
            return this;
        }
        once(event, listener) {
            this.emitter.once(event, listener);
            return this;
        }
        off(event, listener) {
            this.emitter.off(event, listener);
            return this;
        }
        removeAllListeners(event) {
            this.emitter.removeAllListeners(event);
            return this;
        }
        /**
         * Disposes of any side-effects this interceptor has introduced.
         */
        dispose() {
            const logger = this.logger.extend("dispose");
            if (this.readyState === "DISPOSED" /* DISPOSED */) {
                logger.info("cannot dispose, already disposed!");
                return;
            }
            logger.info("disposing the interceptor...");
            this.readyState = "DISPOSING" /* DISPOSING */;
            if (!this.getInstance()) {
                logger.info("no interceptors running, skipping dispose...");
                return;
            }
            this.clearInstance();
            logger.info("global symbol deleted:", getGlobalSymbol(this.symbol));
            if (this.subscriptions.length > 0) {
                logger.info("disposing of %d subscriptions...", this.subscriptions.length);
                for (const dispose of this.subscriptions) {
                    dispose();
                }
                this.subscriptions = [];
                logger.info("disposed of all subscriptions!", this.subscriptions.length);
            }
            this.emitter.removeAllListeners();
            logger.info("destroyed the listener!");
            this.readyState = "DISPOSED" /* DISPOSED */;
        }
        getInstance() {
            var _a;
            const instance = getGlobalSymbol(this.symbol);
            this.logger.info("retrieved global instance:", (_a = instance == null ? void 0 : instance.constructor) == null ? void 0 : _a.name);
            return instance;
        }
        setInstance() {
            setGlobalSymbol(this.symbol, this);
            this.logger.info("set global instance!", this.symbol.description);
        }
        clearInstance() {
            deleteGlobalSymbol(this.symbol);
            this.logger.info("cleared global instance!", this.symbol.description);
        }
    };







    exports.IS_PATCHED_MODULE = IS_PATCHED_MODULE; exports.getGlobalSymbol = getGlobalSymbol; exports.deleteGlobalSymbol = deleteGlobalSymbol; exports.InterceptorReadyState = InterceptorReadyState; exports.Interceptor = Interceptor;

},{"@open-draft/logger":5,"strict-event-emitter":8}],3:[function(require,module,exports){
    "use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/utils/bufferUtils.ts
    var encoder = new TextEncoder();
    function encodeBuffer(text) {
        return encoder.encode(text);
    }
    function decodeBuffer(buffer, encoding) {
        const decoder = new TextDecoder(encoding);
        return decoder.decode(buffer);
    }
    function toArrayBuffer(array) {
        return array.buffer.slice(
            array.byteOffset,
            array.byteOffset + array.byteLength
        );
    }

// src/utils/responseUtils.ts
    var RESPONSE_STATUS_CODES_WITHOUT_BODY = /* @__PURE__ */ new Set([
        101,
        103,
        204,
        205,
        304
    ]);
    function isResponseWithoutBody(status) {
        return RESPONSE_STATUS_CODES_WITHOUT_BODY.has(status);
    }






    exports.encodeBuffer = encodeBuffer; exports.decodeBuffer = decodeBuffer; exports.toArrayBuffer = toArrayBuffer; exports.isResponseWithoutBody = isResponseWithoutBody;

},{}],4:[function(require,module,exports){
    "use strict";Object.defineProperty(exports, "__esModule", {value: true});



    var _chunkOJ2CN4LSjs = require('./chunk-OJ2CN4LS.js');






    var _chunk3O7223NMjs = require('./chunk-3O7223NM.js');

// src/BatchInterceptor.ts
    var BatchInterceptor = class extends _chunk3O7223NMjs.Interceptor {
        constructor(options) {
            BatchInterceptor.symbol = Symbol(options.name);
            super(BatchInterceptor.symbol);
            this.interceptors = options.interceptors;
        }
        setup() {
            const logger = this.logger.extend("setup");
            logger.info("applying all %d interceptors...", this.interceptors.length);
            for (const interceptor of this.interceptors) {
                logger.info('applying "%s" interceptor...', interceptor.constructor.name);
                interceptor.apply();
                logger.info("adding interceptor dispose subscription");
                this.subscriptions.push(() => interceptor.dispose());
            }
        }
        on(event, listener) {
            for (const interceptor of this.interceptors) {
                interceptor.on(event, listener);
            }
            return this;
        }
        once(event, listener) {
            for (const interceptor of this.interceptors) {
                interceptor.once(event, listener);
            }
            return this;
        }
        off(event, listener) {
            for (const interceptor of this.interceptors) {
                interceptor.off(event, listener);
            }
            return this;
        }
        removeAllListeners(event) {
            for (const interceptors of this.interceptors) {
                interceptors.removeAllListeners(event);
            }
            return this;
        }
    };

// src/utils/getCleanUrl.ts
    function getCleanUrl(url, isAbsolute = true) {
        return [isAbsolute && url.origin, url.pathname].filter(Boolean).join("");
    }











    exports.BatchInterceptor = BatchInterceptor; exports.IS_PATCHED_MODULE = _chunk3O7223NMjs.IS_PATCHED_MODULE; exports.Interceptor = _chunk3O7223NMjs.Interceptor; exports.InterceptorReadyState = _chunk3O7223NMjs.InterceptorReadyState; exports.decodeBuffer = _chunkOJ2CN4LSjs.decodeBuffer; exports.deleteGlobalSymbol = _chunk3O7223NMjs.deleteGlobalSymbol; exports.encodeBuffer = _chunkOJ2CN4LSjs.encodeBuffer; exports.getCleanUrl = getCleanUrl; exports.getGlobalSymbol = _chunk3O7223NMjs.getGlobalSymbol; exports.isResponseWithoutBody = _chunkOJ2CN4LSjs.isResponseWithoutBody;

},{"./chunk-3O7223NM.js":2,"./chunk-OJ2CN4LS.js":3}],5:[function(require,module,exports){
    (function (process){(function (){
        var __defProp = Object.defineProperty;
        var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
        var __getOwnPropNames = Object.getOwnPropertyNames;
        var __hasOwnProp = Object.prototype.hasOwnProperty;
        var __export = (target, all) => {
            for (var name in all)
                __defProp(target, name, { get: all[name], enumerable: true });
        };
        var __copyProps = (to, from, except, desc) => {
            if (from && typeof from === "object" || typeof from === "function") {
                for (let key of __getOwnPropNames(from))
                    if (!__hasOwnProp.call(to, key) && key !== except)
                        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
            }
            return to;
        };
        var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
        var src_exports = {};
        __export(src_exports, {
            Logger: () => Logger
        });
        module.exports = __toCommonJS(src_exports);
        var import_is_node_process = require("is-node-process");
        var import_outvariant = require("outvariant");

// src/colors.ts
        var colors_exports = {};
        __export(colors_exports, {
            blue: () => blue,
            gray: () => gray,
            green: () => green,
            red: () => red,
            yellow: () => yellow
        });
        function yellow(text) {
            return `\x1B[33m${text}\x1B[0m`;
        }
        function blue(text) {
            return `\x1B[34m${text}\x1B[0m`;
        }
        function gray(text) {
            return `\x1B[90m${text}\x1B[0m`;
        }
        function red(text) {
            return `\x1B[31m${text}\x1B[0m`;
        }
        function green(text) {
            return `\x1B[32m${text}\x1B[0m`;
        }

// src/index.ts
        var IS_NODE = (0, import_is_node_process.isNodeProcess)();
        var Logger = class {
            constructor(name) {
                this.name = name;
                this.prefix = `[${this.name}]`;
                const LOGGER_NAME = getVariable("DEBUG");
                const LOGGER_LEVEL = getVariable("LOG_LEVEL");
                const isLoggingEnabled = LOGGER_NAME === "1" || LOGGER_NAME === "true" || typeof LOGGER_NAME !== "undefined" && this.name.startsWith(LOGGER_NAME);
                if (isLoggingEnabled) {
                    this.debug = isDefinedAndNotEquals(LOGGER_LEVEL, "debug") ? noop : this.debug;
                    this.info = isDefinedAndNotEquals(LOGGER_LEVEL, "info") ? noop : this.info;
                    this.success = isDefinedAndNotEquals(LOGGER_LEVEL, "success") ? noop : this.success;
                    this.warning = isDefinedAndNotEquals(LOGGER_LEVEL, "warning") ? noop : this.warning;
                    this.error = isDefinedAndNotEquals(LOGGER_LEVEL, "error") ? noop : this.error;
                } else {
                    this.info = noop;
                    this.success = noop;
                    this.warning = noop;
                    this.error = noop;
                    this.only = noop;
                }
            }
            prefix;
            extend(domain) {
                return new Logger(`${this.name}:${domain}`);
            }
            /**
             * Print a debug message.
             * @example
             * logger.debug('no duplicates found, creating a document...')
             */
            debug(message, ...positionals) {
                this.logEntry({
                    level: "debug",
                    message: gray(message),
                    positionals,
                    prefix: this.prefix,
                    colors: {
                        prefix: "gray"
                    }
                });
            }
            /**
             * Print an info message.
             * @example
             * logger.info('start parsing...')
             */
            info(message, ...positionals) {
                this.logEntry({
                    level: "info",
                    message,
                    positionals,
                    prefix: this.prefix,
                    colors: {
                        prefix: "blue"
                    }
                });
                const performance2 = new PerformanceEntry();
                return (message2, ...positionals2) => {
                    performance2.measure();
                    this.logEntry({
                        level: "info",
                        message: `${message2} ${gray(`${performance2.deltaTime}ms`)}`,
                        positionals: positionals2,
                        prefix: this.prefix,
                        colors: {
                            prefix: "blue"
                        }
                    });
                };
            }
            /**
             * Print a success message.
             * @example
             * logger.success('successfully created document')
             */
            success(message, ...positionals) {
                this.logEntry({
                    level: "info",
                    message,
                    positionals,
                    prefix: `\u2714 ${this.prefix}`,
                    colors: {
                        timestamp: "green",
                        prefix: "green"
                    }
                });
            }
            /**
             * Print a warning.
             * @example
             * logger.warning('found legacy document format')
             */
            warning(message, ...positionals) {
                this.logEntry({
                    level: "warning",
                    message,
                    positionals,
                    prefix: `\u26A0 ${this.prefix}`,
                    colors: {
                        timestamp: "yellow",
                        prefix: "yellow"
                    }
                });
            }
            /**
             * Print an error message.
             * @example
             * logger.error('something went wrong')
             */
            error(message, ...positionals) {
                this.logEntry({
                    level: "error",
                    message,
                    positionals,
                    prefix: `\u2716 ${this.prefix}`,
                    colors: {
                        timestamp: "red",
                        prefix: "red"
                    }
                });
            }
            /**
             * Execute the given callback only when the logging is enabled.
             * This is skipped in its entirety and has no runtime cost otherwise.
             * This executes regardless of the log level.
             * @example
             * logger.only(() => {
             *   logger.info('additional info')
             * })
             */
            only(callback) {
                callback();
            }
            createEntry(level, message) {
                return {
                    timestamp: /* @__PURE__ */ new Date(),
                    level,
                    message
                };
            }
            logEntry(args) {
                const {
                    level,
                    message,
                    prefix,
                    colors: customColors,
                    positionals = []
                } = args;
                const entry = this.createEntry(level, message);
                const timestampColor = customColors?.timestamp || "gray";
                const prefixColor = customColors?.prefix || "gray";
                const colorize = {
                    timestamp: colors_exports[timestampColor],
                    prefix: colors_exports[prefixColor]
                };
                const write = this.getWriter(level);
                write(
                    [colorize.timestamp(this.formatTimestamp(entry.timestamp))].concat(prefix != null ? colorize.prefix(prefix) : []).concat(serializeInput(message)).join(" "),
                    ...positionals.map(serializeInput)
                );
            }
            formatTimestamp(timestamp) {
                return `${timestamp.toLocaleTimeString(
                    "en-GB"
                )}:${timestamp.getMilliseconds()}`;
            }
            getWriter(level) {
                switch (level) {
                    case "debug":
                    case "success":
                    case "info": {
                        return log;
                    }
                    case "warning": {
                        return warn;
                    }
                    case "error": {
                        return error;
                    }
                }
            }
        };
        var PerformanceEntry = class {
            startTime;
            endTime;
            deltaTime;
            constructor() {
                this.startTime = performance.now();
            }
            measure() {
                this.endTime = performance.now();
                const deltaTime = this.endTime - this.startTime;
                this.deltaTime = deltaTime.toFixed(2);
            }
        };
        var noop = () => void 0;
        function log(message, ...positionals) {
            if (IS_NODE) {
                process.stdout.write((0, import_outvariant.format)(message, ...positionals) + "\n");
                return;
            }
            console.log(message, ...positionals);
        }
        function warn(message, ...positionals) {
            if (IS_NODE) {
                process.stderr.write((0, import_outvariant.format)(message, ...positionals) + "\n");
                return;
            }
            console.warn(message, ...positionals);
        }
        function error(message, ...positionals) {
            if (IS_NODE) {
                process.stderr.write((0, import_outvariant.format)(message, ...positionals) + "\n");
                return;
            }
            console.error(message, ...positionals);
        }
        function getVariable(variableName) {
            if (IS_NODE) {
                return process.env[variableName];
            }
            return globalThis[variableName]?.toString();
        }
        function isDefinedAndNotEquals(value, expected) {
            return value !== void 0 && value !== expected;
        }
        function serializeInput(message) {
            if (typeof message === "undefined") {
                return "undefined";
            }
            if (message === null) {
                return "null";
            }
            if (typeof message === "string") {
                return message;
            }
            if (typeof message === "object") {
                return JSON.stringify(message);
            }
            return message.toString();
        }

    }).call(this)}).call(this,require('_process'))
},{"_process":1,"is-node-process":6,"outvariant":7}],6:[function(require,module,exports){
    (function (process){(function (){
        var __defProp = Object.defineProperty;
        var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
        var __getOwnPropNames = Object.getOwnPropertyNames;
        var __hasOwnProp = Object.prototype.hasOwnProperty;
        var __export = (target, all) => {
            for (var name in all)
                __defProp(target, name, { get: all[name], enumerable: true });
        };
        var __copyProps = (to, from, except, desc) => {
            if (from && typeof from === "object" || typeof from === "function") {
                for (let key of __getOwnPropNames(from))
                    if (!__hasOwnProp.call(to, key) && key !== except)
                        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
            }
            return to;
        };
        var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
        var src_exports = {};
        __export(src_exports, {
            isNodeProcess: () => isNodeProcess
        });
        module.exports = __toCommonJS(src_exports);
        function isNodeProcess() {
            if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
                return true;
            }
            if (typeof process !== "undefined") {
                const type = process.type;
                if (type === "renderer" || type === "worker") {
                    return false;
                }
                return !!(process.versions && process.versions.node);
            }
            return false;
        }
// Annotate the CommonJS export names for ESM import in node:
        0 && (module.exports = {
            isNodeProcess
        });

    }).call(this)}).call(this,require('_process'))
},{"_process":1}],7:[function(require,module,exports){
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
        for (var name in all)
            __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
            for (let key of __getOwnPropNames(from))
                if (!__hasOwnProp.call(to, key) && key !== except)
                    __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        }
        return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
    var src_exports = {};
    __export(src_exports, {
        InvariantError: () => InvariantError,
        format: () => format,
        invariant: () => invariant
    });
    module.exports = __toCommonJS(src_exports);

// src/format.ts
    var POSITIONALS_EXP = /(%?)(%([sdijo]))/g;
    function serializePositional(positional, flag) {
        switch (flag) {
            case "s":
                return positional;
            case "d":
            case "i":
                return Number(positional);
            case "j":
                return JSON.stringify(positional);
            case "o": {
                if (typeof positional === "string") {
                    return positional;
                }
                const json = JSON.stringify(positional);
                if (json === "{}" || json === "[]" || /^\[object .+?\]$/.test(json)) {
                    return positional;
                }
                return json;
            }
        }
    }
    function format(message, ...positionals) {
        if (positionals.length === 0) {
            return message;
        }
        let positionalIndex = 0;
        let formattedMessage = message.replace(
            POSITIONALS_EXP,
            (match, isEscaped, _, flag) => {
                const positional = positionals[positionalIndex];
                const value = serializePositional(positional, flag);
                if (!isEscaped) {
                    positionalIndex++;
                    return value;
                }
                return match;
            }
        );
        if (positionalIndex < positionals.length) {
            formattedMessage += ` ${positionals.slice(positionalIndex).join(" ")}`;
        }
        formattedMessage = formattedMessage.replace(/%{2,2}/g, "%");
        return formattedMessage;
    }

// src/invariant.ts
    var STACK_FRAMES_TO_IGNORE = 2;
    function cleanErrorStack(error) {
        if (!error.stack) {
            return;
        }
        const nextStack = error.stack.split("\n");
        nextStack.splice(1, STACK_FRAMES_TO_IGNORE);
        error.stack = nextStack.join("\n");
    }
    var InvariantError = class extends Error {
        constructor(message, ...positionals) {
            super(message);
            this.message = message;
            this.name = "Invariant Violation";
            this.message = format(message, ...positionals);
            cleanErrorStack(this);
        }
    };
    var invariant = (predicate, message, ...positionals) => {
        if (!predicate) {
            throw new InvariantError(message, ...positionals);
        }
    };
    invariant.as = (ErrorConstructor, predicate, message, ...positionals) => {
        if (!predicate) {
            const formatMessage = positionals.length === 0 ? message : format(message, positionals);
            let error;
            try {
                error = Reflect.construct(ErrorConstructor, [formatMessage]);
            } catch (err) {
                error = ErrorConstructor(formatMessage);
            }
            throw error;
        }
    };
// Annotate the CommonJS export names for ESM import in node:
    0 && (module.exports = {
        InvariantError,
        format,
        invariant
    });

},{}],8:[function(require,module,exports){
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
        for (var name in all)
            __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
            for (let key of __getOwnPropNames(from))
                if (!__hasOwnProp.call(to, key) && key !== except)
                    __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        }
        return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
    var src_exports = {};
    __export(src_exports, {
        Emitter: () => Emitter,
        MemoryLeakError: () => MemoryLeakError
    });
    module.exports = __toCommonJS(src_exports);

// src/MemoryLeakError.ts
    var MemoryLeakError = class extends Error {
        constructor(emitter, type, count) {
            super(
                `Possible EventEmitter memory leak detected. ${count} ${type.toString()} listeners added. Use emitter.setMaxListeners() to increase limit`
            );
            this.emitter = emitter;
            this.type = type;
            this.count = count;
            this.name = "MaxListenersExceededWarning";
        }
    };

// src/Emitter.ts
    var _Emitter = class {
        static listenerCount(emitter, eventName) {
            return emitter.listenerCount(eventName);
        }
        constructor() {
            this.events = /* @__PURE__ */ new Map();
            this.maxListeners = _Emitter.defaultMaxListeners;
            this.hasWarnedAboutPotentialMemoryLeak = false;
        }
        _emitInternalEvent(internalEventName, eventName, listener) {
            this.emit(
                internalEventName,
                ...[eventName, listener]
            );
        }
        _getListeners(eventName) {
            return Array.prototype.concat.apply([], this.events.get(eventName)) || [];
        }
        _removeListener(listeners, listener) {
            const index = listeners.indexOf(listener);
            if (index > -1) {
                listeners.splice(index, 1);
            }
            return [];
        }
        _wrapOnceListener(eventName, listener) {
            const onceListener = (...data) => {
                this.removeListener(eventName, onceListener);
                return listener.apply(this, data);
            };
            Object.defineProperty(onceListener, "name", { value: listener.name });
            return onceListener;
        }
        setMaxListeners(maxListeners) {
            this.maxListeners = maxListeners;
            return this;
        }
        /**
         * Returns the current max listener value for the `Emitter` which is
         * either set by `emitter.setMaxListeners(n)` or defaults to
         * `Emitter.defaultMaxListeners`.
         */
        getMaxListeners() {
            return this.maxListeners;
        }
        /**
         * Returns an array listing the events for which the emitter has registered listeners.
         * The values in the array will be strings or Symbols.
         */
        eventNames() {
            return Array.from(this.events.keys());
        }
        /**
         * Synchronously calls each of the listeners registered for the event named `eventName`,
         * in the order they were registered, passing the supplied arguments to each.
         * Returns `true` if the event has listeners, `false` otherwise.
         *
         * @example
         * const emitter = new Emitter<{ hello: [string] }>()
         * emitter.emit('hello', 'John')
         */
        emit(eventName, ...data) {
            const listeners = this._getListeners(eventName);
            listeners.forEach((listener) => {
                listener.apply(this, data);
            });
            return listeners.length > 0;
        }
        addListener(eventName, listener) {
            this._emitInternalEvent("newListener", eventName, listener);
            const nextListeners = this._getListeners(eventName).concat(listener);
            this.events.set(eventName, nextListeners);
            if (this.maxListeners > 0 && this.listenerCount(eventName) > this.maxListeners && !this.hasWarnedAboutPotentialMemoryLeak) {
                this.hasWarnedAboutPotentialMemoryLeak = true;
                const memoryLeakWarning = new MemoryLeakError(
                    this,
                    eventName,
                    this.listenerCount(eventName)
                );
                console.warn(memoryLeakWarning);
            }
            return this;
        }
        on(eventName, listener) {
            return this.addListener(eventName, listener);
        }
        once(eventName, listener) {
            return this.addListener(
                eventName,
                this._wrapOnceListener(eventName, listener)
            );
        }
        prependListener(eventName, listener) {
            const listeners = this._getListeners(eventName);
            if (listeners.length > 0) {
                const nextListeners = [listener].concat(listeners);
                this.events.set(eventName, nextListeners);
            } else {
                this.events.set(eventName, listeners.concat(listener));
            }
            return this;
        }
        prependOnceListener(eventName, listener) {
            return this.prependListener(
                eventName,
                this._wrapOnceListener(eventName, listener)
            );
        }
        removeListener(eventName, listener) {
            const listeners = this._getListeners(eventName);
            if (listeners.length > 0) {
                this._removeListener(listeners, listener);
                this.events.set(eventName, listeners);
                this._emitInternalEvent("removeListener", eventName, listener);
            }
            return this;
        }
        /**
         * Alias for `emitter.removeListener()`.
         *
         * @example
         * emitter.off('hello', listener)
         */
        off(eventName, listener) {
            return this.removeListener(eventName, listener);
        }
        removeAllListeners(eventName) {
            if (eventName) {
                this.events.delete(eventName);
            } else {
                this.events.clear();
            }
            return this;
        }
        /**
         * Returns a copy of the array of listeners for the event named `eventName`.
         */
        listeners(eventName) {
            return Array.from(this._getListeners(eventName));
        }
        /**
         * Returns the number of listeners listening to the event named `eventName`.
         */
        listenerCount(eventName) {
            return this._getListeners(eventName).length;
        }
        rawListeners(eventName) {
            return this.listeners(eventName);
        }
    };
    var Emitter = _Emitter;
    Emitter.defaultMaxListeners = 10;
// Annotate the CommonJS export names for ESM import in node:
    0 && (module.exports = {
        Emitter,
        MemoryLeakError
    });

},{}]},{},[4]);
