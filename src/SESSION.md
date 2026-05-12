# Live Collaboration Sessions

xOpat supports real-time multi-user sessions where each peer's viewport, cursor,
visualization, and opted-in module state stay in sync. Transport is WebRTC
peer-to-peer; the default signalling mode is a URL fragment exchanged out-of-band
(no backend infra required). An optional signalling relay (through the existing
`HttpClient`) upgrades invites to one-click.

The feature lives in core under `src/classes/session/`, exposed as
`window.SESSION`. A thin UI plugin (`plugins/session-controls/`) mounts the
start/join affordances into the existing Share dropdown.

## Lifecycle

```
idle  →  hosting  →  connected  →  reconnecting  →  connected | leaving  →  idle
idle  →  joining  →  connected  →  reconnecting  →  connected | leaving  →  idle
```

Observable events on `window.SESSION` (mirrored on `VIEWER_MANAGER`):

| Event | Payload |
|---|---|
| `session-started` | `{ role: SessionRole, sessionId: string }` |
| `session-ended` | `{ reason: string }` |
| `session-peer-joined` | `{ peer: SessionPeer }` |
| `session-peer-dropped` | `{ peer: SessionPeer, reason: string }` |
| `session-role-changed` | `{ role, previous }` |
| `session-reconnecting` | `{ peerId?: string }` |
| `session-state-changed` | `{ state, previous }` |
| `session-host-lost` | `{ hostUserId }` (guest-only; precedes failover) |
| `session-bootstrap-complete` | `{}` (guest-only, after applySnapshot pass) |

## The `SessionSyncProvider` contract

Every module that participates implements this contract and registers from its
constructor or `pluginReady()`:

```js
window.SESSION?.registerProvider({
    id: 'my-feature',
    scope: 'per-viewer',          // or 'global'
    priority: 40,                 // lower applies first during bootstrap

    snapshot(viewer) {             // bootstrap payload; called on host
        return exportMyState(viewer);
    },

    applySnapshot(data, viewer) {  // called on guest during bootstrap
        return importMyState(data, viewer);
    },

    subscribe(emit) {              // wire post-events to `emit(delta)`
        const handler = (e) => emit({
            providerId: 'my-feature',
            viewerUniqueId: e.viewer?.uniqueId,
            intentId: '',          // filled in by SESSION
            sourceUserId: '',      // filled in by SESSION
            kind: 'my-kind',
            payload: serializeChange(e),
        });
        listenToModule(handler);
        return () => stopListening(handler);
    },

    async applyDelta(delta, meta) {
        // MUST be idempotent w.r.t. delta.intentId — the same intent may be
        // re-delivered after a host failover. See "Intent idempotency".
        if (meta.bootstrap) return;   // bootstrap handled via applySnapshot
        await applyChangeLocally(delta.payload, delta.viewerUniqueId);
    },
});
```

**Echo suppression.** Providers use a local `_applyingRemote` flag (or
`WeakMap<Owner, boolean>`) that `applyDelta` sets before mutating state and
`subscribe` reads to skip emission. The cancellable `*-before-*` events in
modules like annotations are **not** hijacked for echo suppression — they stay
free for authentic user-authorization logic.

### Concrete example — visualization

The visualization provider (`src/classes/session/providers/visualization.ts`)
broadcasts a full live-state snapshot keyed by `viewer.uniqueId`. The
per-viewer payload is built via `UTILITIES.exportLiveVisualization(viewer)`
in `src/layers.js`, which captures each shader layer's `cache` (where UI
controls like the opacity slider persist values), `state`
(`visible/use_mode/use_blend`), `type`, and the `layerOrder`. Apply uses
`UTILITIES.importLiveVisualization(viewer, payload)`, which writes the
incoming `cache`/`state`/`type` onto the live `shaderConfig` and routes
each mutated layer through `drawer._applyShaderConfigMutationRequest` so
the renderer's controls re-init from the new cache. Echo suppression is
via the per-viewer `viewer.__sessionApplyingRemote` flag honoured by
`UTILITIES._emitShaderConfigUpdate`. Structural changes (viewer count,
data array, layer shape, layer type) trigger a heavy reopen via
`APPLICATION_CONTEXT.openViewerWith`, followed by a light pass to restore
each viewer's cache on top of the freshly built renderers.

### Concrete example — annotations

The annotations module (`modules/annotations/annotations.js`) emits a full
per-viewer fabric snapshot on any mutation event (`annotation-create`,
`annotation-delete`, `annotation-replace`, `annotation-preset-change`,
`annotation-add-comment`, `annotation-delete-comment`, `layer-added`,
`layer-removed`). Echo suppression is via a `WeakMap<FabricWrapper, boolean>`.
Delta payload is what `fabric.export()` returns; `applyDelta` calls
`fabric.import(payload, { inheritSession: true, history: false })`.

Incremental per-annotation deltas are a v2 concern.

## Role model

- **View deltas** (cursor, viewport) — every peer broadcasts directly;
  last-write-wins. No conflict is possible because each peer owns its own
  cursor/viewport payload.
- **Mutating deltas** (annotations, visualization changes, any
  provider-scoped write) — guest sends an `INTENT` over the DataChannel to
  host. Host applies locally, its post-event subscribe fires, and the
  resulting authoritative `DELTA` is broadcast. Guest applies the returned
  delta with `_applyingRemote=true`; the outbox entry keyed by `intentId`
  clears on round-trip.

Guest-side `annotation-before-create` is not cancelled by the sync layer;
the local creation proceeds and the host's broadcast DELTA re-imports the
same state on both sides. Because `applyDelta` is idempotent, this is safe.

## Compatibility declarations

Every plugin/module declares one of the following in its `include.json`:

| Value | Meaning |
|---|---|
| `"sessionCompatible": "provider"` | Actively registers a `SessionSyncProvider`. Fully supported. |
| `"sessionCompatible": true` | Safe in a session (no cross-peer side effects) but does not sync. |
| `"sessionCompatible": false` | Incompatible. Start/join a session is refused while loaded. |
| *omitted* | Unknown. Start-session modal warns listing the element; user may proceed. |

The start-session flow scans all loaded plugins/modules:

- **Any `false` found** → refuse; show an error listing the offenders.
- **Any undeclared found** → show a confirm dialog listing them. The plugins
  stay on; user can proceed at their own risk.
- **Otherwise** → proceed silently.

### Provisioning guests via join URL

The host does not ask the guest to match its plugin set — it **provisions**
the guest. The join URL is built from
`UTILITIES.serializeApp(includedPluginsList = hostPluginIds, withCookies = false)`,
carrying the host's exact plugin set, the full app config snapshot,
`bypassCookies=true`, and `permaLoadPlugins=false` so no cached plugin state
leaks in. The guest's page loads exactly the host's set from scratch.

## Transport

- **Topology:** full mesh up to 6 peers; host fans out (star) beyond that.
  One ordered + reliable DataChannel per pair. Heartbeats at 2 s,
  soft-timeout at 6 s (reconnecting banner), hard-timeout at 20 s (failover).
- **Signalling — zero-infra default:** host gzip+base64url-encodes the SDP
  offer into `#session=<blob>`. Guest opens the URL, generates an answer,
  pastes it back into the host's "Add peer" field. ICE is not trickled —
  candidates are inline in the SDP.
- **Signalling — optional relay:** set
  `server.secure.sessionSharing.signalingEndpoint` to enable an
  `HttpClient`/`callServer`-backed relay that exchanges offer/answer for
  one-click invites.

### ICE servers — no public defaults

xOpat ships with an empty ICE server list. **STUN** (Session Traversal
Utilities for NAT) is a small service that tells a peer its own public
IP:port so peers can describe themselves to each other; it does not relay
media/data. **TURN** actually relays traffic when direct peer-to-peer fails
(e.g. both peers behind symmetric NATs).

- Peers on the **same LAN / host-network**: no STUN needed.
- Peers on **different networks**: require at least a STUN server. The start
  modal shows an inline notice when none is configured.
- **Production multi-network**: add STUN (any public one, or self-hosted
  coturn) and optionally TURN for pathological NAT cases.

```jsonc
"server": {
    "secure": {
        "sessionSharing": {
            "iceServers": [
                { "urls": ["stun:stun.example.com:3478"] },
                { "urls": ["turn:turn.example.com:3478"], "username": "u", "credential": "p" }
            ],
            "signalingEndpoint": "session/signal"  // optional relay
        }
    }
}
```

## Failover

At session start, every `HELLO` carries a `rankList` = `[hostUserId, ...guestUserIdsByJoinOrder]`.
On hard-timeout of the current host:

1. All peers transition to `reconnecting`; emission is paused.
2. Survivors exchange a small `CANDIDATE_HOST { rank, lastSeenSeq }`. Highest
   rank wins, ties broken by lowest user id.
3. Promoted peer is now authoritative using its own locally-applied state
   (near-complete; it had been applying every host delta). It re-meshes and
   sends a fresh `HELLO` + `bootstrap-digest`.
4. Peers compare digest. Mismatch → re-bootstrap from the new host.
5. Pending outbox `INTENT`s flush to the new host with their original
   `intentId` — providers dedupe by id.

### Old host rejoining

An old host returning after failover joins as a guest. New host remains
authoritative. The old host's local state is replaced via normal bootstrap.

### Solo continue & final save

The host owns "final save." When everyone else leaves, the remaining peer is
by definition the host (possibly via promotion). Two cases:

- **"End session"** → normal xOpat save/upload flow runs; plugin lock releases.
- **All other peers dropped** → solo peer remains host-of-one; the Share
  menu shows "Save and end"; plugin lock held until the user ends the
  session.

## Intent idempotency — a contract

A provider's `applyDelta` **MUST** be safe to call twice with the same
`delta.intentId`. The core's seen-intent LRU dedupes at the delivery layer,
but after a failover an `INTENT` flushed from an outbox may land on a new
host that has already processed the original. Providers typically achieve
idempotency by:

- Using content-addressed identifiers where possible (e.g. a server-assigned
  annotation id rather than a local counter).
- Tracking a bounded LRU of seen `intentId`s and short-circuiting if
  revisited.
- Applying idempotent state overwrites (the annotations `fabric.import`
  approach — it's a whole-viewer replace keyed by object ids).

## Plugin lock

While `SESSION.isActive()` returns true, `UTILITIES.loadPlugin(id)` throws
`SessionLockedError`. Lock engages on entering `hosting`/`joining` and
releases on `idle`. The pre-existing `before-plugin-load` event is
non-cancellable, so the check is made explicit at the top of `loadPlugin`
(`src/loader.ts:1919`).

## Side effects and plugins

Third-party plugins may wire upload-on-create hooks (e.g. an annotation that
saves to a server on `annotation-create`). Under the host-authoritative
model, mutations fire once — on the host's machine — so these side effects
are not duplicated across peers. Plugin authors targeting session-aware
behaviour should read `meta.role` in their own post-event handlers:

```js
OSDAnnotations.instance().addFabricHandler('annotation-create', (e) => {
    if (window.SESSION?.getRole?.() === 'guest') return;  // guest; host will upload
    uploadToServer(e.object);
});
```

## Troubleshooting

- **"No ICE configured" notice in the start modal** — peers on the same LAN
  will still connect. Cross-network requires `iceServers` in
  `server.secure.sessionSharing`.
- **"URL fragment too large"** — use the paste-offer fallback in the invite
  modal. Typical causes: unusually long SDP due to many ICE candidates.
- **Guest joined but no content appears** — bootstrap payload was likely
  delivered but a provider's `applySnapshot` threw. Check console;
  provider-level errors are caught and logged but don't re-throw.
- **Plugin won't load** after session start — the lock is working as
  intended. Leave the session first. If needed programmatically, check
  `window.SESSION.isActive()`.

## See also

- `src/types/session.d.ts` — ambient public types (`SessionSyncProvider`,
  `SessionDelta`, `SessionIntent`, `SessionLockedError`, …)
- `src/classes/session/` — implementation (singleton, transport, providers)
- `src/EVENTS.md` — `session-*` events with payload shapes
- `src/MULTI_VIEWPORTS.md` — per-viewer contract, still applies under sync
- `plugins/session-controls/` — UI plugin
- `modules/annotations/annotations.js` — reference provider registration
