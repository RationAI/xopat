/**
 * Turning EMPAIA HTTP failures into something a UI can act on.
 *
 * The stack answers with a status plus a JSON body whose `detail` carries the
 * real explanation (`{"detail": {"cause": "Job has wrong state: ERROR; can only
 * delete in state ASSEMBLY"}}`), while `HTTPError.message` is only
 * `HTTP DELETE … failed: 400`. Showing the latter to a pathologist is telling
 * them nothing; showing the raw body is telling them too much. This module is
 * the one place that knows how to read the difference, so no caller has to
 * inspect `statusCode` or parse `textData` itself.
 */

/** A backend refusal a caller may have to undo local state for. */
export class RemoteRefusal extends Error {
    /** HTTP status, 0 when the failure never reached the server. */
    readonly status: number;
    /** The backend's own explanation, when it sent one. */
    readonly detail?: string;
    /** The original error, for logging. */
    readonly cause?: any;

    constructor(message: string, status: number, detail?: string, cause?: any) {
        super(message);
        this.name = "RemoteRefusal";
        this.status = status;
        this.detail = detail;
        this.cause = cause;
        Object.setPrototypeOf(this, RemoteRefusal.prototype);
    }

    /**
     * True when the backend will never accept this operation, however often it
     * is retried: the record belongs to another scope (412) or a job references
     * it (423, and there is no unlock route).
     */
    get permanent(): boolean {
        return this.status === 412 || this.status === 423;
    }
}

/**
 * Read the backend's `detail` out of an error body, if it has one.
 *
 * The stack is not consistent about the shape: `detail` arrives as a plain
 * sentence, as `{cause}`, and — the annotation routes — as a nested
 * `{"detail": {"detail": "Annotation is locked"}}`. Unwrap every known
 * sentence-bearing key before giving up, because the fallback used to be
 * `JSON.stringify(detail)`, which is how a user came to read
 * `{"detail":"Annotation is locked"}` in a toast.
 *
 * A shape with no sentence in it returns undefined, so the caller's own
 * translated message wins — showing a serialized object is never better.
 */
const DETAIL_KEYS = ["cause", "detail", "message", "msg", "error"] as const;

export function detailOf(error: any): string | undefined {
    const text = error?.textData;
    if (typeof text !== "string" || !text) return undefined;
    try {
        let detail = JSON.parse(text)?.detail;
        // Bounded unwrap: nesting is one level in practice, three is generous
        // and keeps a self-referential body from spinning.
        for (let depth = 0; depth < 3 && detail && typeof detail === "object"; depth++) {
            const next = DETAIL_KEYS.map(key => (detail as any)[key]).find(v => v !== undefined);
            if (next === undefined) return undefined;
            detail = next;
        }
        if (typeof detail === "string" && detail) return detail;
    } catch (e) {
        // Not JSON — a proxy error page, say. The raw text is not worth showing.
    }
    return undefined;
}

/** Wrap any thrown value as a {@link RemoteRefusal}, preserving what is known. */
export function asRemoteRefusal(error: any): RemoteRefusal {
    if (error instanceof RemoteRefusal) return error;
    const status = Number(error?.statusCode) || 0;
    const detail = detailOf(error);
    return new RemoteRefusal(detail ?? error?.message ?? String(error), status, detail, error);
}

/**
 * The sentence to show the user for a failed EMPAIA call: the backend's own
 * `detail` when it sent one, the caller's fallback otherwise.
 */
export function describeRemoteError(error: any, fallback: string): string {
    return detailOf(error) ?? (error instanceof RemoteRefusal ? error.detail : undefined) ?? fallback;
}
