// Helpers shared by the built-in sinks.

/** An owner opting into byte storage — see `IOBinaryPayload`. */
export function isBinaryPayload(p: unknown): p is IOBinaryPayload {
    if (!p || typeof p !== "object") return false;
    const bytes = (p as IOBinaryPayload).bytes;
    return bytes instanceof Uint8Array || bytes instanceof ArrayBuffer;
}
