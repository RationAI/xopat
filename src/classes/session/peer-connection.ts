// Thin RTCPeerConnection wrapper used by the session-sync singleton.
// One instance per remote peer. Owns the ordered+reliable DataChannel,
// message framing/chunking, and heartbeat timers.
// See src/SESSION.md for the protocol overview.

export type PeerMessage =
    | { kind: "HELLO"; data: any }
    | { kind: "READY"; data: any }
    | { kind: "INTENT"; data: SessionIntent }
    | { kind: "DELTA"; data: SessionDelta }
    | { kind: "HEARTBEAT"; data: { t: number } }
    | { kind: "CANDIDATE_HOST"; data: { rank: number; lastSeenSeq: number } }
    | { kind: "BOOTSTRAP"; data: SessionBootstrapPayload }
    | { kind: "SESSION_END"; data: { reason: string } }
    | { kind: "PEER_LEFT"; data: { userId: string } };

export type PeerState = "new" | "connecting" | "open" | "reconnecting" | "closed";

const CHUNK_MAX = 16 * 1024;   // conservative DC message size
const HEARTBEAT_INTERVAL = 2000;
const SOFT_TIMEOUT_MS = 6000;
const HARD_TIMEOUT_MS = 20000;

interface Listeners {
    onMessage?: (msg: PeerMessage) => void;
    onStateChange?: (state: PeerState) => void;
    /** Called when heartbeat crosses the soft threshold (may still recover). */
    onSoftTimeout?: () => void;
    /** Called when heartbeat crosses the hard threshold (failover trigger). */
    onHardTimeout?: () => void;
    /** Emits locally-gathered ICE candidates to forward via signaling. */
    onIceCandidate?: (candidate: RTCIceCandidate | null) => void;
}

export class PeerConnection {
    readonly remoteUserId: string;
    private pc: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private state: PeerState = "new";
    private heartbeatTimer: any = null;
    private watchdogTimer: any = null;
    private lastRecv = 0;
    private softFired = false;

    // Reassembly state per chunk-id.
    private chunks: Map<string, { seqs: Map<number, string>; total: number }> = new Map();

    constructor(
        remoteUserId: string,
        config: RTCConfiguration,
        private readonly listeners: Listeners,
    ) {
        this.remoteUserId = remoteUserId;
        this.pc = new RTCPeerConnection(config);
        this.pc.onicecandidate = (e) => this.listeners.onIceCandidate?.(e.candidate);
        this.pc.oniceconnectionstatechange = () => {
            const s = this.pc.iceConnectionState;
            if (s === "failed" || s === "disconnected") this.setState("reconnecting");
            if (s === "closed") this.setState("closed");
        };
        this.pc.ondatachannel = (e) => this.bindDataChannel(e.channel);
    }

    // ── setup ──────────────────────────────────────────────────────────────

    /** Host path: create the DC ourselves, then offer. */
    async createOffer(): Promise<RTCSessionDescriptionInit> {
        this.bindDataChannel(this.pc.createDataChannel("xopat-session", { ordered: true }));
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return offer;
    }

    /** Guest path: accept remote offer, return local answer. */
    async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        await this.pc.setRemoteDescription(offer);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    /** Host path: consume the guest's answer after offer was shipped. */
    async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        await this.pc.setRemoteDescription(answer);
    }

    async addRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        try { await this.pc.addIceCandidate(candidate); }
        catch (e) { console.warn("[SESSION] addIceCandidate failed:", e); }
    }

    close(): void {
        this.stopHeartbeat();
        try { this.dc?.close(); } catch { /* ignore */ }
        try { this.pc.close(); } catch { /* ignore */ }
        this.setState("closed");
    }

    // ── messaging ──────────────────────────────────────────────────────────

    send(msg: PeerMessage): void {
        const dc = this.dc;
        if (!dc || dc.readyState !== "open") return;
        const body = JSON.stringify({ k: msg.kind, d: msg.data });
        if (body.length <= CHUNK_MAX) {
            dc.send(JSON.stringify({ t: "msg", b: body }));
            return;
        }
        // Chunked.
        const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const total = Math.ceil(body.length / CHUNK_MAX);
        for (let i = 0; i < total; i++) {
            const chunk = body.slice(i * CHUNK_MAX, (i + 1) * CHUNK_MAX);
            dc.send(JSON.stringify({ t: "chunk", id, seq: i, total, b: chunk }));
        }
    }

    // ── internals ──────────────────────────────────────────────────────────

    private bindDataChannel(dc: RTCDataChannel) {
        this.dc = dc;
        dc.onopen = () => {
            this.setState("open");
            this.lastRecv = performance.now();
            this.startHeartbeat();
        };
        dc.onclose = () => {
            this.setState("closed");
            this.stopHeartbeat();
        };
        dc.onerror = (e) => console.warn("[SESSION] DC error:", e);
        dc.onmessage = (e) => this.onRawMessage(String(e.data));
    }

    private onRawMessage(raw: string) {
        this.lastRecv = performance.now();
        this.softFired = false;
        let env: any;
        try { env = JSON.parse(raw); }
        catch { return; }

        if (env.t === "msg") {
            this.deliver(env.b);
            return;
        }
        if (env.t === "chunk") {
            let rec = this.chunks.get(env.id);
            if (!rec) {
                rec = { seqs: new Map(), total: env.total };
                this.chunks.set(env.id, rec);
            }
            rec.seqs.set(env.seq, env.b);
            if (rec.seqs.size === rec.total) {
                let joined = "";
                for (let i = 0; i < rec.total; i++) joined += rec.seqs.get(i) || "";
                this.chunks.delete(env.id);
                this.deliver(joined);
            }
        }
    }

    private deliver(body: string) {
        let parsed: any;
        try { parsed = JSON.parse(body); }
        catch { return; }
        if (!parsed?.k) return;
        const msg = { kind: parsed.k, data: parsed.d } as PeerMessage;
        if (msg.kind !== "HEARTBEAT") {
            this.listeners.onMessage?.(msg);
        }
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.send({ kind: "HEARTBEAT", data: { t: Date.now() } });
        }, HEARTBEAT_INTERVAL);
        this.watchdogTimer = setInterval(() => {
            const idle = performance.now() - this.lastRecv;
            if (idle >= HARD_TIMEOUT_MS) {
                this.stopHeartbeat();
                this.setState("reconnecting");
                this.listeners.onHardTimeout?.();
            } else if (idle >= SOFT_TIMEOUT_MS && !this.softFired) {
                this.softFired = true;
                this.listeners.onSoftTimeout?.();
            }
        }, 1000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    }

    private setState(next: PeerState) {
        if (this.state === next) return;
        this.state = next;
        this.listeners.onStateChange?.(next);
    }

    getState(): PeerState { return this.state; }
}
