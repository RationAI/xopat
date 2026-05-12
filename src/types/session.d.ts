// ── Live-collaboration session types — ambient, visible in all files ────────
// Canonical reference: src/SESSION.md

/**
 * Session role of the current peer.
 * - `none`   — no session active
 * - `host`   — authoritative peer; owns id generation, history push, final save
 * - `guest`  — applies host's deltas; mutating writes are relayed via INTENT
 */
type SessionRole = "none" | "host" | "guest";

/**
 * Session state machine.
 * - `idle`         — no session
 * - `hosting`      — host waiting for peers (or already connected to some)
 * - `joining`      — guest negotiating with host
 * - `connected`    — live, streaming deltas
 * - `reconnecting` — transient DC failure or host failover in progress
 * - `leaving`      — graceful shutdown; plugin lock still held until `idle`
 */
type SessionState =
    | "idle"
    | "hosting"
    | "joining"
    | "connected"
    | "reconnecting"
    | "leaving";

/**
 * Declared session compatibility of a plugin/module in its `include.json`.
 * - `"provider"` — actively registers a `SessionSyncProvider`; fully supported.
 * - `true`       — declared safe (no cross-peer side effects) but does not sync.
 * - `false`      — declared incompatible; starting/joining a session is refused.
 * - omitted      — unknown; start-session modal warns listing the element.
 */
type SessionCompatibility = "provider" | boolean;

/**
 * A peer known to this client.
 * @property rank host-rank used for ranked failover — host is 0, guests by join order
 * @property color stable per-peer color derived from `userId` (HSL)
 */
interface SessionPeer {
    userId: string;
    userName: string;
    role: SessionRole;
    rank: number;
    color: string;
    connected: boolean;
}

/**
 * A mutation emitted by a provider or the core.
 * `intentId` lets the originating peer match the round-tripped authoritative
 * delta back to its pending outbox; `sourceUserId` identifies the authoring user.
 *
 * Must be serializable (JSON-clonable); avoid DOM nodes, functions, cyclic refs.
 */
interface SessionDelta<T = any> {
    providerId: string;
    /** Viewer this delta targets, when provider scope is 'per-viewer'. */
    viewerUniqueId?: string;
    /** Monotonically assigned by host; guests apply in order. */
    seq?: number;
    /** Unique id for the originating intent (UUID). Dedupe key under failover. */
    intentId: string;
    sourceUserId: string;
    kind: string;
    payload: T;
}

/**
 * A guest→host request to perform a mutation. Host applies locally; its
 * post-event subscribe broadcasts the resulting authoritative delta.
 */
interface SessionIntent<T = any> {
    intentId: string;
    providerId: string;
    viewerUniqueId?: string;
    kind: string;
    payload: T;
}

/**
 * Metadata passed to `SessionSyncProvider.applyDelta`.
 */
interface SessionApplyMeta {
    /** True iff the delta originated from a remote peer. */
    remote: boolean;
    origin: string;
    role: SessionRole;
    viewer?: any; // OpenSeadragon.Viewer — avoid direct ref to keep ambient-safe
    /** Set during bootstrap so providers can skip history/animation. */
    bootstrap?: boolean;
}

/**
 * Provider contract. A module that wants to participate in a session calls
 * `SESSION.registerProvider({...})` after `window.SESSION` is ready.
 *
 * `applyDelta` MUST be idempotent w.r.t. `intentId` — the same intent may be
 * re-delivered after a host failover. Providers typically track seen intent
 * ids in a bounded LRU to dedupe.
 *
 * `subscribe` wires the module's post-events to `emit(delta)`. It should
 * consult a `_applyingRemote` flag to suppress echo during remote application.
 */
interface SessionSyncProvider {
    id: string;
    /** 'per-viewer' deltas carry `viewerUniqueId`; 'global' deltas don't. */
    scope: "global" | "per-viewer";
    /** Lower priorities apply first during bootstrap. */
    priority?: number;

    snapshot(viewer?: any): Promise<any> | any;
    applySnapshot(data: any, viewer?: any): Promise<void> | void;

    subscribe(emit: (delta: SessionDelta) => void): () => void;
    applyDelta(delta: SessionDelta, meta: SessionApplyMeta): Promise<void> | void;
}

/**
 * Bootstrap payload assembled on host and shipped to a newly-joining guest.
 * Per-viewer payloads are keyed by `viewerUniqueId`.
 */
interface SessionBootstrapPayload {
    /** Full xOpat session envelope produced by UTILITIES.serializeApp(). */
    app: string;
    /** Map of `providerId → data | { [viewerUniqueId]: data }`. */
    providers: Record<string, any>;
    /** Host-rank list at the time of bootstrap. */
    rankList: string[];
    /** Digest (hash) of `providers` used for post-failover state reconciliation. */
    digest: string;
}

/**
 * The shared config lives under `server.secure.sessionSharing`.
 */
interface SessionSharingConfig {
    /**
     * WebRTC ICE servers. xOpat ships with an empty list by default so there
     * is no silent dependency on a third-party STUN/TURN service.
     */
    iceServers?: RTCIceServer[];
    /**
     * Optional relay endpoint (proxied via `HttpClient`/`callServer`) used to
     * exchange SDP offers/answers when set. When omitted, signalling falls
     * back to URL-fragment + paste-answer flow.
     */
    signalingEndpoint?: string;
}

/**
 * Public shape of `window.SESSION`.
 *
 * Emitted events (on this object and mirrored on `VIEWER_MANAGER`):
 * - `session-started`       `{ role, sessionId }`
 * - `session-ended`         `{ reason }`
 * - `session-peer-joined`   `{ peer: SessionPeer }`
 * - `session-peer-dropped`  `{ peer: SessionPeer, reason }`
 * - `session-role-changed`  `{ role: SessionRole, previous: SessionRole }`
 * - `session-reconnecting`  `{ peerId }`
 * - `session-state-changed` `{ state: SessionState, previous: SessionState }`
 */
interface SessionSync {
    /** Register a provider. Returns an unregister function. */
    registerProvider(provider: SessionSyncProvider): () => void;

    /** True while the session is in any non-idle state. */
    isActive(): boolean;

    getState(): SessionState;
    getRole(): SessionRole;
    getPeers(): SessionPeer[];
    getLocalPeer(): SessionPeer | null;

    /** Start hosting. Resolves with the first guest's invite URL. */
    startHosting(): Promise<string>;

    /**
     * Generate a fresh invite URL while already hosting. Call once per
     * additional guest — WebRTC requires a unique offer per peer.
     */
    prepareInviteUrl(): Promise<string>;

    /**
     * Accept a guest's SDP answer. Normally invoked automatically by the
     * server-relay polling loop or the same-origin BroadcastChannel; the
     * UI exposes it as a manual fallback.
     */
    acceptGuestAnswer(answerBlob: string): Promise<void>;

    /**
     * Join a session using a URL-fragment blob.
     * Resolves with the encoded answer blob the guest must deliver back to
     * the host (out-of-band or via the configured signalling relay).
     */
    join(offerBlob: string): Promise<string>;

    /** Leave the current session; host=end for everyone, guest=just us. */
    leave(reason?: string): Promise<void>;

    /** Save the current authoritative state and end the session. Host-only. */
    saveAndEnd(): Promise<void>;

    /** Emit / observe events. Matches OpenSeadragon.EventSource shape. */
    addHandler(eventName: string, handler: (event: any) => void): void;
    removeHandler(eventName: string, handler: (event: any) => void): void;
    raiseEvent(eventName: string, data?: any): void;
}

/**
 * Thrown by `UTILITIES.loadPlugin` when a session is active.
 * Also thrown by `SESSION.join` when the local config disallows joining.
 */
declare class SessionLockedError extends Error {
    readonly sessionId: string | null;
    readonly reason: "session-active" | "incompatible-plugin" | "manifest-mismatch";
    constructor(message: string, reason: SessionLockedError["reason"], sessionId?: string | null);
}
