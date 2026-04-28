// Signaling — SDP exchange for the session-sync WebRTC transport.
//
// Two modes:
//   1. URL-fragment + paste-answer (zero-infra default)
//   2. Optional relay via HttpClient.callServer when
//      server.secure.sessionSharing.signalingEndpoint is configured
//
// See src/SESSION.md.

/** Envelope shipped between host and guest (before/after WebRTC setup). */
export interface SignalBlob {
    v: 1;
    sessionId: string;
    hostUserId: string;
    hostUserName: string;
    rankList: string[];
    sdp: RTCSessionDescriptionInit;
    iceServers?: RTCIceServer[];
    relay?: { endpoint: string; room: string };
}

// ── gzip + base64url helpers (browser-native CompressionStream) ─────────────

async function gzipEncode(s: string): Promise<Uint8Array> {
    const enc = new TextEncoder().encode(s);
    const cs: any = (globalThis as any).CompressionStream;
    if (!cs) return enc; // fallback: identity (larger URL)
    const stream = new Response(
        new Blob([enc as unknown as BlobPart]).stream().pipeThrough(new cs("gzip")),
    );
    const buf = await stream.arrayBuffer();
    return new Uint8Array(buf);
}

async function gzipDecode(bytes: Uint8Array): Promise<string> {
    const ds: any = (globalThis as any).DecompressionStream;
    if (!ds) return new TextDecoder().decode(bytes);
    const stream = new Response(
        new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new ds("gzip")),
    );
    return await stream.text();
}

function toBase64Url(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    const b64 = btoa(s);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string): Uint8Array {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ── URL-fragment encoding ───────────────────────────────────────────────────

/**
 * Encode a signal blob for transport in a URL fragment. The caller composes
 * the full URL, e.g. `${window.location.origin}${window.location.pathname}#session=${blob}`.
 *
 * Throws if the encoded blob would exceed `maxLen` (caller falls back to
 * textarea paste flow).
 */
export async function encodeBlob(blob: SignalBlob, maxLen = 3800): Promise<string> {
    const json = JSON.stringify(blob);
    const gz = await gzipEncode(json);
    const b64 = toBase64Url(gz);
    if (b64.length > maxLen) {
        throw new Error(`signal blob too large for URL fragment (${b64.length} > ${maxLen}); use paste flow`);
    }
    return b64;
}

export async function decodeBlob(encoded: string): Promise<SignalBlob> {
    const bytes = fromBase64Url(encoded);
    const json = await gzipDecode(bytes);
    return JSON.parse(json);
}

/** Read a `#session=<blob>` param from the current URL, if present. */
export function readJoinFragment(location: Location = window.location): string | null {
    const hash = location.hash?.replace(/^#/, "") || "";
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get("session");
}

/** Build a shareable join URL with the given blob in the fragment. */
export function buildJoinUrl(blob: string, base: Location = window.location): string {
    const params = new URLSearchParams();
    params.set("session", blob);
    return `${base.origin}${base.pathname}${base.search}#${params.toString()}`;
}

/**
 * Build a full provisioning URL: the host's entire serialized app config
 * (plugins, data, visualizations, bypass flags) with the signalling blob
 * embedded as `params.sessionJoinBlob`. The guest's xOpat parses this
 * exactly like a normal shared-session URL and boots with the host's
 * plugin set from scratch (bypassCookies=true, permaLoadPlugins=false).
 */
export function buildProvisioningUrl(sessionBlob: string): string {
    const U: any = (globalThis as any).UTILITIES;
    const ctx: any = (globalThis as any).APPLICATION_CONTEXT;
    if (!U?.serializeAppConfig || !ctx?.url) {
        throw new Error("[SESSION] UTILITIES.serializeAppConfig unavailable; cannot build provisioning URL");
    }

    // withCookies=false → bypassCookies=true, bypassCacheLoadTime=true baked in.
    const configJson: string = U.serializeAppConfig(false, false);
    let config: any;
    try { config = JSON.parse(configJson); }
    catch { throw new Error("[SESSION] serializeAppConfig returned non-JSON"); }
    config.params = config.params || {};
    config.params.sessionJoinBlob = sessionBlob;
    // Don't pollute the guest's persistent plugin cache.
    config.params.permaLoadPlugins = false;

    const url = `${ctx.url}#${encodeURIComponent(JSON.stringify(config))}`;
    console.info(`[SESSION] built provisioning URL; bytes=${url.length} plugins=${Object.keys(config.plugins || {}).join(',')}`);
    return url;
}

/** Read `params.sessionJoinBlob` that the host injected via the URL fragment. */
export function readJoinBlobFromConfig(): string | null {
    const ctx: any = (globalThis as any).APPLICATION_CONTEXT;
    const blob = ctx?.config?.params?.sessionJoinBlob;
    return typeof blob === "string" && blob.length > 0 ? blob : null;
}

// ── Relay mode (optional) ───────────────────────────────────────────────────

function getRelayConfig(): { endpoint: string } | null {
    const cfg = (globalThis as any).APPLICATION_CONTEXT?.config?.server?.secure?.sessionSharing;
    const endpoint: string | undefined = cfg?.signalingEndpoint;
    if (!endpoint) return null;
    return { endpoint };
}

function makeRelayClient(): any {
    const HC: any = (globalThis as any).HttpClient;
    if (!HC) return null;
    return new HC({ auth: { contextId: "core", required: false } });
}

export async function relayPublishOffer(room: string, blob: SignalBlob): Promise<void> {
    const cfg = getRelayConfig();
    const client = makeRelayClient();
    if (!cfg || !client) throw new Error("signaling relay not configured");
    await client.request(`${cfg.endpoint}/offer`, { method: "POST", body: { room, blob } });
}

export async function relayFetchAnswer(room: string): Promise<SignalBlob | null> {
    const cfg = getRelayConfig();
    const client = makeRelayClient();
    if (!cfg || !client) throw new Error("signaling relay not configured");
    const r = await client.request(`${cfg.endpoint}/answer?room=${encodeURIComponent(room)}`);
    return r?.blob || null;
}

export async function relayPublishAnswer(room: string, blob: SignalBlob): Promise<void> {
    const cfg = getRelayConfig();
    const client = makeRelayClient();
    if (!cfg || !client) throw new Error("signaling relay not configured");
    await client.request(`${cfg.endpoint}/answer`, { method: "POST", body: { room, blob } });
}

export function isRelayConfigured(): boolean {
    return !!getRelayConfig();
}

// ── Same-browser BroadcastChannel fast path ────────────────────────────────
// Two tabs in the same browser don't need the server. The relay still
// works for that case but BroadcastChannel is instant.

export interface BroadcastSignalAnswer {
    type: "answer";
    sessionId: string;
    inviteId: string;
    blob: string;
    guestUserId?: string;
}

export function openBroadcastChannel(sessionId: string): BroadcastChannel | null {
    try {
        if (typeof BroadcastChannel === "undefined") return null;
        return new BroadcastChannel(`xopat-session-relay-${sessionId}`);
    } catch {
        return null;
    }
}

// ── Cross-device signalling relay (HTTP, in-memory, in xOpat node server) ──
// Endpoint: /session-relay/answer
// POST body { sessionId, inviteId, blob, guestUserId } → 204
// GET  ?sessionId=X → { answers: [{inviteId, blob, guestUserId, ts}] }; consumed on read
// TTL 10 min. See src/SESSION.md and server/node/index.js.

export interface RelayAnswer {
    inviteId: string;
    blob: string;
    guestUserId: string | null;
}

const RELAY_PATH = "/session-relay/answer";

export async function relayPostAnswer(
    sessionId: string,
    inviteId: string,
    blob: string,
    guestUserId: string,
): Promise<boolean> {
    try {
        const r = await fetch(RELAY_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, inviteId, blob, guestUserId }),
            credentials: "same-origin",
        });
        return r.ok;
    } catch (e) {
        console.warn("[SESSION] relay POST failed:", e);
        return false;
    }
}

export async function relayPollAnswers(sessionId: string): Promise<RelayAnswer[]> {
    try {
        const r = await fetch(`${RELAY_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
            method: "GET",
            credentials: "same-origin",
        });
        if (!r.ok) return [];
        const j = await r.json();
        return Array.isArray(j?.answers) ? j.answers : [];
    } catch {
        return [];
    }
}

export async function relayClearSession(sessionId: string): Promise<void> {
    try {
        await fetch(`${RELAY_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
            method: "DELETE",
            credentials: "same-origin",
        });
    } catch { /* ignore */ }
}

export function makeInviteId(): string {
    return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── ICE servers from config ────────────────────────────────────────────────

export function configuredIceServers(): RTCIceServer[] {
    const cfg = (globalThis as any).APPLICATION_CONTEXT?.config?.server?.secure?.sessionSharing;
    return Array.isArray(cfg?.iceServers) ? cfg.iceServers : [];
}
