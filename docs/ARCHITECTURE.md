# Architecture

This document describes Herdr Studio's current system contracts. See
[FEATURES.md](../FEATURES.md) for behavior and shortcuts and
[DEPLOYMENT.md](./DEPLOYMENT.md) for supported configurations.

## System overview

Browsers cannot open Unix domain sockets or Windows named pipes directly. A
Bun bridge serves the frontend, authenticates browsers, and connects to Herdr:

```text
Browser (React + Vite)
   |  same-origin HTTP / WebSocket
   v
Bridge (Bun + TypeScript) -- node:net --> Herdr sockets
```

`herdr.sock` carries NDJSON control requests; `herdr-client.sock` carries binary
terminal traffic. Browser RPC uses `{ id, method, params }` and returns either
`{ id, result }` or `{ id, error }`, with connection identity attached to scoped
traffic. Subscribed Herdr events are pushed as `{ event: ... }`.

The bridge owns socket access, local/SSH runtimes, file/Git/worktree/hook/session
operations, terminal and clipboard relay, authentication, health, and updates.
React owns presentation and browser-local preferences. xterm displays Herdr's
server-rendered output rather than reconstructing a PTY in the bridge.

## Terminal endpoints

Backend selection uses the verified protocol allowlist, not browser version
inference. See [Herdr compatibility](./DEPLOYMENT.md#herdr-compatibility) for
versions, fallback configuration, and clipboard limitations.

Herdr 0.9.0 endpoints require generation 1 and the exact codecs
`shell.snapshot.v1`, `shell.surface.v1`, `shell.input.semantic.v1`, and
`shell.blob.v1`. Unknown generations/codecs are rejected regardless of advertised
capabilities. Attachment waits for the initial snapshot. Each terminal crops its
pane from the server-rendered tab surface and sends semantic input to that pane;
panes retain their shared layout dimensions.

Method/capability advertisements belong to each terminal socket, never another
terminal or runtime. Reattachment negotiates again; browser reconnect and
connection changes clear cached availability until refreshed. The bridge returns
availability in attach replies and scoped workspace metadata, then checks every
method again at dispatch:

- `pane.focus` is required for safe attachment; absence fails without legacy
  takeover.
- `pane.scroll` gates history scrolling; `tab.create` and `workspace.create`
  gate creation on the existing source endpoint. UI controls explain missing
  methods or pending negotiation. Unrelated control-API operations are unaffected.
- Input and resize are core codec operations, not optional methods. Only
  `health_check` enables endpoint ping/pong. `surface_interest` and
  `presentation_effects_fence` do not enable surface-setting or fencing controls.

Mouse input uses zero-based pane-local cells, bounded to the crop. Only a press
inside the pane acquires drag/release ownership; later positions clamp to its
edge. Reporting changes and session closure cancel ownership. Mouse-aware apps
receive semantic mouse events; ordinary wheels and explicit history shortcuts
use history scrolling. During browser selection, presentation retains only the
latest full repaint and resumes when selection clears. Pane/session changes
retire pending presentation; selection replay cannot send application input.

Input waits for attachment readiness and revalidates the attachment, session,
and routing lease. It is never replayed into a detached or replaced terminal.
Disconnect rejects pending endpoint requests and invalidates clipboard ownership.

## Browser navigation and creation

On endpoint connections, `browserNavigation.ts` projects browser-local
workspace/tab/pane choices into the shared UI selection fields. Snapshots supply
topology, not subsequent navigation. Stale layouts and delayed action results
cannot replace newer browser selections. This is independent workspace/tab
navigation, not independent native same-tab pane focus. Legacy navigation,
topology mutations, and terminal dimensions remain shared.

Creation uses explicit context and `focus: false`, adopting returned IDs only
while the initiating selection and connection lease remain current. Studio-only
`browser_source` identifies the source terminal, pane, tab, and workspace. The
bridge validates attachment ownership and live topology, strips that field, and
calls the advertised create method on the existing endpoint's serialized
focus/scroll lane. It creates no extra endpoint or focus call. Omitting a
synthesized cwd preserves Herdr's `terminal.new_cwd` policy; explicit cwd wins.
Same-tab pane focus, including the `follow` cwd source, remains shared.

Missing source attachments fail explicitly. The only exception is first-workspace
bootstrap: each runtime serializes an empty `workspace.list` check and control
creation, rechecking lease and deadline before dispatch. Competing creations must
retry once topology becomes nonempty. The 20-second admission deadline covers
readiness, validation, and queue residence, below the browser RPC timeout.
Expired undispatched mutations never execute; dispatched timeouts report uncertain
completion so callers check Herdr before retrying.

Subscription acknowledgements, including reconnects, trigger fresh snapshots;
events during refresh queue another refresh. This reconciles missed changes,
not an atomic or replayable event log.

## Connection isolation

A bridge-global `ConnectionManager` owns shared profiles and independent
`ConnectionRuntime` instances. Each runtime owns its transport, clients, viewers,
clipboard relay, subscriptions, services, caches, and reconnect lifecycle.
Browser selection does not start or stop other runtimes; render streams open
only while viewed. Disconnect/removal disposes the bridge runtime and SSH tunnel,
not Herdr or its workspaces.

Downstream RPC/HTTP requires an immutable connection ID, runtime generation, and
request-local ready-runtime lease. Replies, errors, events, terminal frames, and
clipboard pushes carry that identity. HTTP streams recheck the lease per chunk
and cancel their source on replacement. Dispatched effects may finish on the
original runtime, but retired replies, chunks, and metadata cannot publish.
Explicit malformed, unknown, stale, or not-ready identities fail without fallback.
Omitted identities and legacy HTTP aliases remain a bounded, logged compatibility
path for older single-connection clients only.

Bridge-global authentication, health, updates, client accounting, and profile
management remain independent of downstream readiness. Global RPC rejects
misleading connection fields. Only ready runtimes route requests; start, stop,
replacement, and post-ready transport exit invalidate leases before publishing
status. Starts/stops are serialized, shutdown is bounded, and one failed runtime
does not block management or healthy connections.

Browser mount keys, caches, local storage, notification targets, and asynchronous
actions are connection-scoped. Switching connections retires the browser lease;
same-ID runtime replacement clears active and inactive cached sessions before
resource IDs can be reused.

## Workspace resource ownership

A checkout owns Files/Changes data; a workspace supplies its runtime route; a tab
is a return location; a pane supplies optional path/session context. Repository
groups do not represent a combined working tree. Changes describe checkout edits,
not proof that one agent produced them. Last step uses recorded activity snapshots,
not attribution of arbitrary working-tree edits.

Git resource keys use `worktree.gui_settings_key`, falling back to repository key
plus normalized checkout path. Non-Git resources use workspace identity. All are
connection-scoped. Workspaces sharing a checkout may share caches, but requests
retain workspace/runtime leases and resource revisions: refresh/removal retires
older prefetches. Tab/pane IDs do not own resource caches.

Inspector actions capture the originating workspace instead of consulting global
focus when results arrive. A vanished workspace can rebind only to the same
checkout; a missing path must not fall back to a sibling worktree. Agent cwd is
used only inside the checkout, otherwise browsing starts at its root. Successful
worktree removal clears that checkout's state and retargets/closes the Inspector
without affecting siblings. Closing one workspace does not erase resources still
used by another workspace for that checkout.

The terminal stays mounted across Inspector views and geometry changes. Resource
layout/preferences are separate from content caches. See
[Workspace Inspector](../FEATURES.md#workspace-inspector) for controls and
[History synchronization](./HISTORY.md) for session projection contracts.

## SSH transport

Each SSH runtime supervises one OpenSSH process forwarding both sockets into a
private temporary directory. Readiness requires control `ping` and a render
handshake. Transient failures use cancellable backoff capped at 30 seconds and
six attempts, resetting after 30 seconds stable-ready; authentication, host-key,
and permanent protocol failures do not retry. Post-ready exit retires the runtime
generation before retry. CLI SSH uses the same validation/probes but does not
persist or automatically retry.

Only an OpenSSH alias or `user@host` is accepted, passed after `--` with fixed
options. Host-key checking stays enabled; service authentication is noninteractive.
Credentials/options remain in the service user's OpenSSH configuration. Stderr is
bounded and sanitized, not relayed as raw banners. Cleanup removes owned paths
only after confirmed child exit; unconfirmed termination preserves paths and
reports failure. Remote file, Git, hook, and supported session operations use the
same runtime host boundary. See [connection setup](./DEPLOYMENT.md#multiple-and-remote-herdr-connections).

## Distribution model

Production builds embed the frontend and Bun runtime into one platform executable;
users need neither Bun nor Node.js. Source builds use Bun and Vite. See
[standalone builds](./DEPLOYMENT.md#build-a-standalone-executable).

## Trust boundary

Studio is a trusted single-user administration tool, not a sandbox or multi-user
permission system. Authenticated browsers can control terminals, change files,
manage shared profiles, and execute trusted repository hooks. It provides neither
TLS termination nor rate limiting; see [SECURITY.md](../SECURITY.md).

The bridge performs no browser-Origin or request-Host checks; listener access and
any required authentication determine authority. Secure the outer access path as
described in [SECURITY.md](../SECURITY.md#trust-model), including for forwarded
loopback listeners. The browser accepts one valid unscoped bridge hello before
other messages. Replies/events have validated, exclusive message kinds; downstream
events cannot inject reserved bridge fields. NDJSON lines and subscription
acknowledgements are bounded, and malformed terminal frames are dropped.
Observable HTTP traversal forms are rejected, but Bun can normalize dot segments
before routing; legacy aliases prevent distinguishing every such pre-handler
normalization.
