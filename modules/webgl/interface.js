//https://stackoverflow.com/questions/55971662/how-to-check-if-child-class-has-overridden-parent-method-function
WebGLModule.Interface = class { //todo not used now, maybe use for context...?
    constructor(className) {
        console.log(this);
        const proto = Object.getPrototypeOf(this);
        const superProto = className.prototype;
        const missing = Object.getOwnPropertyNames(superProto).find(name =>
            typeof superProto[name] === "function" && !proto.hasOwnProperty(name)
        );
        if (missing) throw new TypeError(`${this.constructor.name} must implement ${missing}`);
    }
};
