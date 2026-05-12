// Runtime implementation of the ambient `SessionLockedError` class declared
// in src/types/session.d.ts. Thrown by UTILITIES.loadPlugin when a session
// is active, and by SESSION.join when the local config refuses the session.

export class SessionLockedErrorImpl extends Error implements SessionLockedError {
    readonly sessionId: string | null;
    readonly reason: SessionLockedError["reason"];

    constructor(
        message: string,
        reason: SessionLockedError["reason"],
        sessionId: string | null = null,
    ) {
        super(message);
        this.name = "SessionLockedError";
        this.reason = reason;
        this.sessionId = sessionId;
    }
}
