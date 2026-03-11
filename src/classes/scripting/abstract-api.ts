import type {ScriptApiObject, ScriptApiMetadata} from "./abstract-types";

export abstract class XOpatScriptingApi implements ScriptApiObject {
    static readonly ScriptApiMetadata?: ScriptApiMetadata;

    readonly namespace: string;
    readonly name: string;
    readonly description: string;

    protected constructor(namespace: string, name: string, description: string) {
        this.namespace = namespace;
        this.name = name;
        this.description = description;
    }
}