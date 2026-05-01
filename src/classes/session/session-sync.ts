// Live-collaboration session singleton.
// See src/SESSION.md for the full design; src/types/session.d.ts for the
// ambient public types (SessionSyncProvider, SessionDelta, SessionIntent, …).

import { makeViewportProvider } from "./providers/viewport";
import { makeVisualizationProvider } from "./providers/visualization";
import { makeCursorProvider } from "./cursor-overlay";
import { PeerConnection, type PeerMessage } from "./peer-connection";
import {
    buildProvisioningUrl,
    configuredIceServers,
    decodeBlob,
    encodeBlob,
    makeInviteId,
    openBroadcastChannel,
    relayClearSession,
    relayPollAnswers,
    relayPostAnswer,
    type BroadcastSignalAnswer,
    type SignalBlob,
} from "./signaling";
import { SessionLockedErrorImpl } from "./errors";

type Handler = (event: any) => void;

/**
 * Minimal event emitter. We don't inherit from OpenSeadragon.EventSource
 * because session-sync is instantiated by the loader before OSD is
 * guaranteed to be present, and the public contract only promises the
 * add/remove/raise triple.
 */
class EventBus {
    private readonly handlers: Map<string, Set<Handler>> = new Map();

    addHandler(eventName: string, handler: Handler) {
        let set = this.handlers.get(eventName);
        if (!set) {
            set = new Set();
            this.handlers.set(eventName, set);
        }
        set.add(handler);
    }

    removeHandler(eventName: string, handler: Handler) {
        this.handlers.get(eventName)?.delete(handler);
    }

    raiseEvent(eventName: string, data: any = {}) {
        const set = this.handlers.get(eventName);
        if (!set) return;
        for (const h of Array.from(set)) {
            try { h(data); }
            catch (e) { console.error(`[SESSION] handler for "${eventName}" threw:`, e); }
        }
    }
}

interface RegisteredProvider {
    provider: SessionSyncProvider;
    unsubscribe?: () => void;
}

interface PeerLink {
    conn: PeerConnection;
    peer: SessionPeer;
    reconnecting: boolean;
}

export class SessionSyncController implements SessionSync {
    private readonly bus = new EventBus();
    private readonly providers: Map<string, RegisteredProvider> = new Map();
    private readonly peers: Map<string, SessionPeer> = new Map();
    private readonly links: Map<string, PeerLink> = new Map();

    private state: SessionState = "idle";
    private role: SessionRole = "none";
    private sessionId: string | null = null;
    private localPeer: SessionPeer | null = null;
    private rankList: string[] = [];

    private readonly seenIntents: Set<string> = new Set();
    private static readonly SEEN_INTENTS_MAX = 4096;

    private readonly outbox: Map<string, SessionIntent> = new Map();
    private bootstrapping = false;
    private deltaSeq = 0;

    /**
     * Host-only: pending invites awaiting an answer, keyed by inviteId.
     * Each invite owns its own RTCPeerConnection — required because WebRTC
     * cannot reuse a single offer for multiple peers. Multi-guest = host
     * calls `prepareInviteUrl()` repeatedly, one URL per guest.
     */
    private pendingInvites: Map<string, { conn: PeerConnection; offerBlob: SignalBlob }> = new Map();

    /** Host-only: same-browser fast-path channel. */
    private hostRelayChannel: BroadcastChannel | null = null;
    /** Host-only: server-relay polling timer. */
    private hostRelayPollTimer: any = null;

    constructor() {
        this.registerProvider(makeViewportProvider());
        this.registerProvider(makeVisualizationProvider());
        this.registerProvider(makeCursorProvider(
            () => this.getLocalPeer(),
            (userId) => this.peers.get(userId) ?? null,
        ));
    }

    // ── provider registry ──────────────────────────────────────────────────

    registerProvider(provider: SessionSyncProvider): () => void {
        if (this.providers.has(provider.id)) {
            console.warn(`[SESSION] provider "${provider.id}" already registered; replacing`);
            this.unregisterProvider(provider.id);
        }
        const record: RegisteredProvider = { provider };
        this.providers.set(provider.id, record);
        if (this.isActive() && !this.bootstrapping) {
            record.unsubscribe = this.wireProvider(record);
        }
        return () => this.unregisterProvider(provider.id);
    }

    private unregisterProvider(id: string) {
        const record = this.providers.get(id);
        if (!record) return;
        try { record.unsubscribe?.(); }
        catch (e) { console.warn(`[SESSION] provider "${id}" unsubscribe threw:`, e); }
        this.providers.delete(id);
    }

    private wireProvider(record: RegisteredProvider): () => void {
        return record.provider.subscribe((delta) => this.emitDelta(record.provider, delta));
    }

    // ── public queries ─────────────────────────────────────────────────────

    isActive(): boolean { return this.state !== "idle"; }
    getState(): SessionState { return this.state; }
    getRole(): SessionRole { return this.role; }
    getPeers(): SessionPeer[] { return Array.from(this.peers.values()); }
    getLocalPeer(): SessionPeer | null { return this.localPeer; }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Starts hosting. Returns a shareable join URL containing the encoded
     * SDP offer in the fragment. The caller (UI) should also call
     * `acceptGuestAnswer` with the guest's answer blob once the guest
     * pastes it back.
     */
    async startHosting(): Promise<string> {
        this.requireState("idle");
        this.setState("hosting");
        this.role = "host";
        this.sessionId = makeSessionId();
        this.localPeer = this.makeLocalPeer("host", 0);
        this.peers.set(this.localPeer.userId, this.localPeer);
        this.rankList = [this.localPeer.userId];
        this.wireAllProviders();
        this.bus.raiseEvent("session-started", { role: this.role, sessionId: this.sessionId });
        this.mirrorToViewerManager("session-started", { role: this.role, sessionId: this.sessionId });
        this.openHostBroadcastChannel();
        this.startHostRelayPolling();
        return await this.prepareInviteUrl();
    }

    /** Same-browser fast path. Cross-device uses the server relay. */
    private openHostBroadcastChannel() {
        if (!this.sessionId) return;
        this.hostRelayChannel = openBroadcastChannel(this.sessionId);
        if (!this.hostRelayChannel) return;
        this.hostRelayChannel.addEventListener("message", (e) => {
            const msg = e.data as BroadcastSignalAnswer;
            if (!msg || msg.type !== "answer" || msg.sessionId !== this.sessionId) return;
            console.info(`[SESSION] received answer via BroadcastChannel inviteId=${msg.inviteId}`);
            this.deliverAnswer(msg.inviteId, msg.blob);
        });
    }

    /**
     * Cross-device auto-connect: poll the server relay every 1.5 s for
     * answers addressed to this session. Stops on `leave()`.
     */
    private startHostRelayPolling() {
        if (!this.sessionId) return;
        if (this.hostRelayPollTimer) return;
        const tick = async () => {
            if (!this.sessionId || this.state === "idle" || this.state === "leaving") return;
            const list = await relayPollAnswers(this.sessionId);
            for (const a of list) {
                console.info(`[SESSION] received answer via server relay inviteId=${a.inviteId}`);
                this.deliverAnswer(a.inviteId, a.blob);
            }
        };
        this.hostRelayPollTimer = setInterval(tick, 1500);
        // Fire one immediate tick.
        tick();
    }

    private async deliverAnswer(inviteId: string, blob: string) {
        const invite = this.pendingInvites.get(inviteId);
        if (!invite) {
            console.info(`[SESSION] answer for unknown inviteId=${inviteId} (likely already consumed); ignoring`);
            return;
        }
        try {
            await this.acceptGuestAnswer(blob);
            this.bus.raiseEvent("session-auto-connected", { inviteId });
        } catch (err) {
            console.warn(`[SESSION] auto-acceptGuestAnswer for inviteId=${inviteId} failed:`, err);
        }
    }

    /**
     * Prepare an invite URL for one new guest. Each call creates an
     * independent RTCPeerConnection (WebRTC requires a fresh offer per
     * peer). The host can call this repeatedly to invite multiple guests
     * — each guest gets its own URL.
     */
    async prepareInviteUrl(): Promise<string> {
        if (this.role !== "host" || !this.localPeer || !this.sessionId) {
            throw new Error("[SESSION] prepareInviteUrl requires an active host.");
        }

        const inviteId = makeInviteId();
        const pending = new PeerConnection(
            inviteId,
            { iceServers: configuredIceServers() },
            {
                onMessage: (m) => this.handlePeerMessage(m, pending),
                onStateChange: (s) => this.handlePendingStateChange(s, pending),
                onSoftTimeout: () => this.handleSoftTimeout(pending),
                onHardTimeout: () => this.handleHardTimeout(pending),
                onIceCandidate: () => { /* trickle disabled */ },
            },
        );
        await pending.createOffer();
        await waitForIceGatheringComplete(this.getInternalPc(pending));

        const blob: SignalBlob = {
            v: 1,
            sessionId: this.sessionId,
            hostUserId: this.localPeer.userId,
            hostUserName: this.localPeer.userName,
            rankList: this.rankList.slice(),
            sdp: this.getInternalPc(pending).localDescription!,
            iceServers: configuredIceServers(),
        };
        // Carry the inviteId so the answer can route back unambiguously
        // when multiple invites are in flight.
        (blob as any).inviteId = inviteId;
        this.pendingInvites.set(inviteId, { conn: pending, offerBlob: blob });

        const encoded = await encodeBlob(blob, Number.MAX_SAFE_INTEGER);
        let url: string;
        try {
            url = await buildProvisioningUrl(encoded);
        } catch (e) {
            console.warn("[SESSION] provisioning URL unavailable, using minimal fragment:", e);
            const params = new URLSearchParams();
            params.set("session", encoded);
            url = `${window.location.origin}${window.location.pathname}${window.location.search}#${params.toString()}`;
        }
        this.bus.raiseEvent("session-invite-ready", { url, encoded, inviteId });
        return url;
    }

    /**
     * Host: accept a guest's answer blob. The inviteId in the blob (set by
     * prepareInviteUrl) selects which pending PeerConnection to feed the
     * answer to — supporting multiple guests joining concurrently.
     */
    async acceptGuestAnswer(answerBlob: string): Promise<void> {
        if (this.role !== "host") throw new Error("[SESSION] not hosting.");
        const blob = await decodeBlob(answerBlob);
        const inviteId: string | undefined = (blob as any).inviteId;
        // Fall back to the first pending invite if no inviteId (legacy paste).
        const pending = inviteId
            ? this.pendingInvites.get(inviteId)
            : this.pendingInvites.values().next().value;
        if (!pending) throw new Error("[SESSION] no pending invite for this answer.");
        await pending.conn.acceptAnswer(blob.sdp);

        const guestId = (blob as any).guestUserId || pending.conn.remoteUserId;
        const guestName = (blob as any).guestUserName || "Guest";
        const peer: SessionPeer = {
            userId: guestId,
            userName: guestName,
            role: "guest",
            rank: this.rankList.length,
            color: colorForUserId(guestId),
            connected: false,
        };
        this.peers.set(peer.userId, peer);
        this.rankList.push(peer.userId);
        this.links.set(peer.userId, { conn: pending.conn, peer, reconnecting: false });
        if (inviteId) this.pendingInvites.delete(inviteId);
        else {
            // Consume the first invite we matched against.
            const firstKey = this.pendingInvites.keys().next().value;
            if (firstKey) this.pendingInvites.delete(firstKey);
        }
    }

    /**
     * Guest: decode the host's offer blob, produce an answer blob.
     * Returns the encoded answer for the UI to surface (paste back) or
     * to auto-ship via relay.
     */
    async join(offerBlob: string): Promise<string> {
        this.requireState("idle");
        console.info("[SESSION] join() called; decoding offer blob…");
        const offer = await decodeBlob(offerBlob);
        console.info(`[SESSION] decoded offer; sessionId=${offer.sessionId} hostUser=${offer.hostUserName}`);

        if ((globalThis as any).SESSION?.isActive?.()) {
            throw new SessionLockedErrorImpl(
                "Already in a session.", "session-active", this.sessionId,
            );
        }

        this.setState("joining");
        this.role = "guest";
        this.sessionId = offer.sessionId;
        this.localPeer = this.makeLocalPeer("guest", offer.rankList.length);
        this.peers.set(this.localPeer.userId, this.localPeer);

        // Pre-seed host as a known peer so cursor overlays can color it.
        const hostPeer: SessionPeer = {
            userId: offer.hostUserId,
            userName: offer.hostUserName,
            role: "host",
            rank: 0,
            color: colorForUserId(offer.hostUserId),
            connected: false,
        };
        this.peers.set(hostPeer.userId, hostPeer);
        this.rankList = offer.rankList.slice();

        const conn = new PeerConnection(
            offer.hostUserId,
            { iceServers: offer.iceServers ?? configuredIceServers() },
            {
                onMessage: (m) => this.handlePeerMessage(m, conn),
                onStateChange: (s) => this.handleGuestStateChange(s, conn),
                onSoftTimeout: () => this.handleSoftTimeout(conn),
                onHardTimeout: () => this.handleHardTimeout(conn),
                onIceCandidate: () => { /* trickle disabled */ },
            },
        );
        const answerSdp = await conn.acceptOffer(offer.sdp);
        await waitForIceGatheringComplete(this.getInternalPc(conn));
        this.links.set(offer.hostUserId, { conn, peer: hostPeer, reconnecting: false });

        const answerBlob: SignalBlob = {
            v: 1,
            sessionId: offer.sessionId,
            hostUserId: offer.hostUserId,
            hostUserName: offer.hostUserName,
            rankList: offer.rankList,
            sdp: this.getInternalPc(conn).localDescription!,
        };
        (answerBlob as any).guestUserId = this.localPeer.userId;
        (answerBlob as any).guestUserName = this.localPeer.userName;
        // Echo the host's inviteId so it routes back to the right PeerConnection.
        const inviteId: string = (offer as any).inviteId || "";
        if (inviteId) (answerBlob as any).inviteId = inviteId;
        const encoded = await encodeBlob(answerBlob, Number.MAX_SAFE_INTEGER);

        // Cross-device path: post to the server relay. Host polls and
        // auto-accepts. This is the production path.
        const posted = await relayPostAnswer(offer.sessionId, inviteId, encoded, this.localPeer.userId);
        console.info(`[SESSION] relay POST answer ok=${posted} inviteId=${inviteId}`);

        // Same-browser fast path (instant, useful when host and guest tabs
        // are on the same origin in one browser; harmless otherwise).
        const ch = openBroadcastChannel(offer.sessionId);
        if (ch) {
            try {
                ch.postMessage({
                    type: "answer",
                    sessionId: offer.sessionId,
                    inviteId,
                    blob: encoded,
                    guestUserId: this.localPeer.userId,
                });
                console.info("[SESSION] published answer via BroadcastChannel");
            } catch (e) { console.warn("[SESSION] BroadcastChannel publish failed:", e); }
            setTimeout(() => { try { ch.close(); } catch { /* ignore */ } }, 5000);
        }
        return encoded;
    }

    async leave(reason = "user-left"): Promise<void> {
        if (this.state === "idle") return;
        this.setState("leaving");
        if (this.role === "host") {
            for (const link of this.links.values()) {
                try { link.conn.send({ kind: "SESSION_END", data: { reason } }); } catch { /* ignore */ }
            }
        } else if (this.localPeer) {
            for (const link of this.links.values()) {
                try { link.conn.send({ kind: "PEER_LEFT", data: { userId: this.localPeer.userId } }); } catch { /* ignore */ }
            }
        }
        for (const link of this.links.values()) { try { link.conn.close(); } catch { /* ignore */ } }
        for (const inv of this.pendingInvites.values()) { try { inv.conn.close(); } catch { /* ignore */ } }
        try { this.hostRelayChannel?.close(); } catch { /* ignore */ }
        if (this.hostRelayPollTimer) { clearInterval(this.hostRelayPollTimer); this.hostRelayPollTimer = null; }
        if (this.role === "host" && this.sessionId) {
            // Best-effort: clear any leftover relay slots.
            relayClearSession(this.sessionId).catch(() => { /* ignore */ });
        }
        this.hostRelayChannel = null;
        this.pendingInvites.clear();
        this.links.clear();
        this.teardown(reason);
    }

    async saveAndEnd(): Promise<void> {
        if (this.role !== "host") throw new Error("Only the host can save and end.");
        // UI is expected to follow this with the standard export flow.
        await this.leave("save-and-end");
    }

    // ── event API ──────────────────────────────────────────────────────────

    addHandler(eventName: string, handler: Handler) { this.bus.addHandler(eventName, handler); }
    removeHandler(eventName: string, handler: Handler) { this.bus.removeHandler(eventName, handler); }
    raiseEvent(eventName: string, data?: any) { this.bus.raiseEvent(eventName, data); }

    // ── delta routing ──────────────────────────────────────────────────────

    /** Called from the transport layer for an incoming DELTA. */
    async applyRemoteDelta(delta: SessionDelta) {
        if (!delta.intentId || this.seenIntents.has(delta.intentId)) return;
        this.rememberIntent(delta.intentId);
        const record = this.providers.get(delta.providerId);
        if (!record) {
            console.warn(`[SESSION] delta for unknown provider "${delta.providerId}" — dropping`);
            return;
        }
        const meta: SessionApplyMeta = {
            remote: true,
            origin: delta.sourceUserId,
            role: this.role,
            bootstrap: this.bootstrapping,
        };
        try { await record.provider.applyDelta(delta, meta); }
        catch (e) { console.error(`[SESSION] provider "${delta.providerId}" applyDelta threw:`, e); }
        if (this.localPeer && delta.sourceUserId === this.localPeer.userId) {
            this.outbox.delete(delta.intentId);
        }
    }

    private emitDelta(provider: SessionSyncProvider, delta: SessionDelta) {
        if (this.bootstrapping) {
            console.info(`[SESSION] emitDelta dropped (bootstrapping) provider=${provider.id}`);
            return;
        }
        if (!this.localPeer) return;
        if (!delta.intentId) delta.intentId = makeIntentId();
        if (!delta.sourceUserId) delta.sourceUserId = this.localPeer.userId;
        if (!delta.providerId) delta.providerId = provider.id;

        const peerCount = this.links.size;
        if (this.role === "guest") {
            this.outbox.set(delta.intentId, toIntent(delta));
            console.info(`[SESSION] emitDelta → INTENT provider=${delta.providerId} kind=${delta.kind} peers=${peerCount}`);
            this.sendToAll({ kind: "INTENT", data: toIntent(delta) });
            return;
        }
        if (this.role === "host") {
            delta.seq = ++this.deltaSeq;
            this.rememberIntent(delta.intentId);
            console.info(`[SESSION] emitDelta → DELTA provider=${delta.providerId} kind=${delta.kind} seq=${delta.seq} peers=${peerCount}`);
            this.sendToAll({ kind: "DELTA", data: delta });
        }
    }

    private sendToAll(msg: PeerMessage) {
        for (const link of this.links.values()) {
            if (link.conn.getState() === "open") {
                try { link.conn.send(msg); } catch (e) { console.warn("[SESSION] send failed:", e); }
            }
        }
    }

    // ── inbound message handling ───────────────────────────────────────────

    private async handlePeerMessage(msg: PeerMessage, conn: PeerConnection) {
        switch (msg.kind) {
            case "HELLO":
                await this.onHello(msg.data, conn);
                return;
            case "READY":
                return;
            case "INTENT":
                if (this.role !== "host") return;
                console.info(`[SESSION] ← INTENT provider=${(msg.data as any)?.providerId} kind=${(msg.data as any)?.kind}`);
                await this.onIntent(msg.data);
                return;
            case "DELTA":
                if (this.role !== "guest") return;
                console.info(`[SESSION] ← DELTA provider=${(msg.data as any)?.providerId} kind=${(msg.data as any)?.kind} seq=${(msg.data as any)?.seq}`);
                await this.applyRemoteDelta(msg.data);
                return;
            case "BOOTSTRAP":
                if (this.role === "guest") await this.applyBootstrap(msg.data);
                return;
            case "SESSION_END":
                await this.leave(`host-ended:${msg.data.reason}`);
                return;
            case "PEER_LEFT":
                this.dropPeer(msg.data.userId, "peer-left");
                return;
            case "CANDIDATE_HOST":
                // TODO(failover): rank comparison + promotion
                return;
            default:
                return;
        }
    }

    private async onHello(data: any, conn: PeerConnection) {
        if (this.role === "host") {
            // Guest's HELLO: record peer, send BOOTSTRAP.
            const peer: SessionPeer = this.peers.get(data.userId) || {
                userId: data.userId,
                userName: data.userName,
                role: "guest",
                rank: this.rankList.length,
                color: colorForUserId(data.userId),
                connected: true,
            };
            peer.connected = true;
            this.peers.set(peer.userId, peer);
            if (!this.rankList.includes(peer.userId)) this.rankList.push(peer.userId);
            this.links.set(peer.userId, { conn, peer, reconnecting: false });
            this.bus.raiseEvent("session-peer-joined", { peer });
            this.mirrorToViewerManager("session-peer-joined", { peer });

            const payload = await this.buildBootstrap();
            conn.send({ kind: "BOOTSTRAP", data: payload });
        } else {
            // Host's HELLO confirms identity and rank list.
            this.rankList = Array.isArray(data.rankList) ? data.rankList.slice() : this.rankList;
            const host = this.peers.get(data.userId);
            if (host) host.connected = true;
        }
    }

    private async onIntent(intent: SessionIntent) {
        // Host applies the intent locally; the provider's post-event subscribe
        // re-emits as a DELTA which gets broadcast to all peers via emitDelta.
        const record = this.providers.get(intent.providerId);
        if (!record) return;
        const delta: SessionDelta = {
            providerId: intent.providerId,
            viewerUniqueId: intent.viewerUniqueId,
            intentId: intent.intentId,
            sourceUserId: this.localPeer!.userId, // host authoring
            kind: intent.kind,
            payload: intent.payload,
        };
        if (this.seenIntents.has(intent.intentId)) return;
        this.rememberIntent(intent.intentId);
        await record.provider.applyDelta(delta, {
            remote: true,
            origin: intent.intentId,
            role: "host",
            bootstrap: false,
        });
        delta.seq = ++this.deltaSeq;
        this.sendToAll({ kind: "DELTA", data: delta });
    }

    // ── bootstrap ──────────────────────────────────────────────────────────

    private async buildBootstrap(): Promise<SessionBootstrapPayload> {
        const vm: any = (globalThis as any).VIEWER_MANAGER;
        const U: any = (globalThis as any).UTILITIES;

        const providers: Record<string, any> = {};
        for (const [id, rec] of this.providers) {
            try {
                if (rec.provider.scope === "per-viewer") {
                    const perViewer: Record<string, any> = {};
                    for (const v of vm?.viewers || []) {
                        if (v?.uniqueId) perViewer[v.uniqueId] = await rec.provider.snapshot(v);
                    }
                    providers[id] = perViewer;
                } else {
                    providers[id] = await rec.provider.snapshot();
                }
            } catch (e) {
                console.warn(`[SESSION] provider "${id}" snapshot threw:`, e);
            }
        }
        const app = U?.serializeApp ? (await U.serializeApp(undefined, false))?.app || "" : "";
        const digest = `${Date.now().toString(36)}:${Object.keys(providers).length}`;
        return {
            app,
            providers,
            rankList: this.rankList.slice(),
            digest,
        };
    }

    private async applyBootstrap(payload: SessionBootstrapPayload) {
        this.setState("connected");
        this.bootstrapping = true;
        this.unwireAllProviders();
        try {
            // Apply visualization first (priority 10), then viewport (20), then
            // annotations and others.
            const ordered = Array.from(this.providers.values()).sort(
                (a, b) => (a.provider.priority ?? 50) - (b.provider.priority ?? 50),
            );
            for (const rec of ordered) {
                const data = payload.providers[rec.provider.id];
                if (data === undefined) continue;
                try {
                    if (rec.provider.scope === "per-viewer" && data && typeof data === "object") {
                        const vm: any = (globalThis as any).VIEWER_MANAGER;
                        for (const v of vm?.viewers || []) {
                            if (v?.uniqueId && data[v.uniqueId] !== undefined) {
                                await rec.provider.applySnapshot(data[v.uniqueId], v);
                            }
                        }
                    } else {
                        await rec.provider.applySnapshot(data);
                    }
                } catch (e) {
                    console.error(`[SESSION] bootstrap apply for "${rec.provider.id}" threw:`, e);
                }
            }
            this.rankList = payload.rankList.slice();
        } finally {
            this.bootstrapping = false;
            this.wireAllProviders();
            // Signal host we're ready for live stream.
            for (const link of this.links.values()) {
                try { link.conn.send({ kind: "READY", data: {} }); } catch { /* ignore */ }
            }
            this.bus.raiseEvent("session-bootstrap-complete", {});
        }
    }

    // ── transport state handling ───────────────────────────────────────────

    private handlePendingStateChange(peerState: string, conn: PeerConnection) {
        if (peerState !== "open") return;
        // Host: send HELLO to the newly-connected guest.
        if (!this.localPeer) return;
        conn.send({
            kind: "HELLO",
            data: {
                userId: this.localPeer.userId,
                userName: this.localPeer.userName,
                rankList: this.rankList.slice(),
                role: "host",
            },
        });
        this.setState("connected");
    }

    private handleGuestStateChange(peerState: string, conn: PeerConnection) {
        if (peerState !== "open") return;
        if (!this.localPeer) return;
        conn.send({
            kind: "HELLO",
            data: {
                userId: this.localPeer.userId,
                userName: this.localPeer.userName,
                role: "guest",
            },
        });
        // Guest doesn't transition to "connected" until BOOTSTRAP is applied.
    }

    private handleSoftTimeout(_conn: PeerConnection) {
        this.setState("reconnecting");
        this.bus.raiseEvent("session-reconnecting", {});
        this.mirrorToViewerManager("session-reconnecting", {});
    }

    private handleHardTimeout(conn: PeerConnection) {
        // Identify which peer dropped.
        let droppedId: string | null = null;
        for (const [userId, link] of this.links) {
            if (link.conn === conn) { droppedId = userId; break; }
        }
        if (!droppedId) return;
        if (this.role === "guest" && this.isHost(droppedId)) {
            // TODO(failover): initiate CANDIDATE_HOST exchange and ranked promotion.
            // v1: surface state so UI can offer reconnect.
            this.bus.raiseEvent("session-host-lost", { hostUserId: droppedId });
            this.mirrorToViewerManager("session-host-lost", { hostUserId: droppedId });
        } else {
            this.dropPeer(droppedId, "hard-timeout");
        }
    }

    private dropPeer(userId: string, reason: string) {
        const link = this.links.get(userId);
        if (!link) return;
        try { link.conn.close(); } catch { /* ignore */ }
        this.links.delete(userId);
        const peer = this.peers.get(userId);
        if (peer) {
            peer.connected = false;
            this.bus.raiseEvent("session-peer-dropped", { peer, reason });
            this.mirrorToViewerManager("session-peer-dropped", { peer, reason });
        }
    }

    private isHost(userId: string): boolean {
        return this.rankList[0] === userId;
    }

    // ── provider lifecycle helpers ─────────────────────────────────────────

    private wireAllProviders() {
        const ids: string[] = [];
        for (const record of this.providers.values()) {
            if (!record.unsubscribe) {
                record.unsubscribe = this.wireProvider(record);
                ids.push(record.provider.id);
            }
        }
        console.info(`[SESSION] wireAllProviders subscribed: ${ids.join(", ")}`);
    }

    private unwireAllProviders() {
        const ids: string[] = [];
        for (const record of this.providers.values()) {
            if (record.unsubscribe) ids.push(record.provider.id);
            try { record.unsubscribe?.(); } catch { /* ignore */ }
            record.unsubscribe = undefined;
        }
        if (ids.length) console.info(`[SESSION] unwireAllProviders: ${ids.join(", ")}`);
    }

    // ── misc internals ─────────────────────────────────────────────────────

    private setState(next: SessionState) {
        if (this.state === next) return;
        const previous = this.state;
        this.state = next;
        this.bus.raiseEvent("session-state-changed", { state: next, previous });
        this.mirrorToViewerManager("session-state-changed", { state: next, previous });
    }

    private requireState(...expected: SessionState[]) {
        if (!expected.includes(this.state)) {
            throw new Error(
                `[SESSION] illegal state transition from "${this.state}"; expected one of ${expected.join(", ")}`,
            );
        }
    }

    private teardown(reason: string) {
        this.unwireAllProviders();
        this.peers.clear();
        this.links.clear();
        this.outbox.clear();
        this.seenIntents.clear();
        this.rankList = [];
        this.localPeer = null;
        this.role = "none";
        const id = this.sessionId;
        this.sessionId = null;
        this.setState("idle");
        this.bus.raiseEvent("session-ended", { reason, sessionId: id });
        this.mirrorToViewerManager("session-ended", { reason, sessionId: id });
    }

    private rememberIntent(id: string) {
        this.seenIntents.add(id);
        if (this.seenIntents.size > SessionSyncController.SEEN_INTENTS_MAX) {
            const iter = this.seenIntents.values();
            const first = iter.next();
            if (!first.done) this.seenIntents.delete(first.value);
        }
    }

    private mirrorToViewerManager(name: string, data: any) {
        try {
            const vm = (globalThis as any).VIEWER_MANAGER;
            if (vm && typeof vm.raiseEvent === "function") vm.raiseEvent(name, data);
        } catch { /* VIEWER_MANAGER may not yet exist during boot */ }
    }

    private makeLocalPeer(role: SessionRole, rank: number): SessionPeer {
        const user: any = (globalThis as any).XOpatUser?.instance?.();
        const userId = user?.id || `anon-${Math.random().toString(36).slice(2, 10)}`;
        const userName = user?.name || "Anonymous";
        return {
            userId,
            userName,
            role,
            rank,
            color: colorForUserId(userId),
            connected: true,
        };
    }

    /** PeerConnection keeps its RTCPeerConnection private; pierce for SDP access. */
    private getInternalPc(pc: PeerConnection): RTCPeerConnection {
        // Matches the field name used in peer-connection.ts.
        return (pc as any).pc as RTCPeerConnection;
    }
}

// ── pure helpers ───────────────────────────────────────────────────────────

function makeSessionId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeIntentId(): string {
    return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function toIntent(delta: SessionDelta): SessionIntent {
    return {
        intentId: delta.intentId,
        providerId: delta.providerId,
        viewerUniqueId: delta.viewerUniqueId,
        kind: delta.kind,
        payload: delta.payload,
    };
}

function colorForUserId(userId: string): string {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
    const hue = ((h % 360) + 360) % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            pc.removeEventListener("icegatheringstatechange", onChange);
            clearTimeout(timer);
            resolve();
        };
        const onChange = () => {
            if (pc.iceGatheringState === "complete") done();
        };
        pc.addEventListener("icegatheringstatechange", onChange);
        // Safety net: accept whatever candidates we have after timeout.
        const timer = setTimeout(done, timeoutMs);
    });
}
