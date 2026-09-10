# Endpoint action availability

For Herdr 0.9.0, Studio retains the methods and capabilities from each terminal
socket's `endpoint.welcome.v1`. Advertisements are not shared across terminals
or connection runtimes. Reattachment negotiates again; browser reconnect and
connection switches clear cached availability until it is refreshed.

- `pane.focus` is required to attach a cropped terminal safely. If absent,
  attachment fails explicitly; Studio does not switch to legacy takeover.
- `pane.scroll` gates terminal history scrolling. Application mouse wheels still
  use semantic input, so a server without history scrolling can retain mouse,
  keyboard, paste, resize, and rendering support.
- `tab.create` and `workspace.create` are checked on the existing source terminal
  before creation. Controls show a missing-method reason, or a loading reason
  when that source has not negotiated. An empty session still uses the existing
  serialized, validated control-API bootstrap; it opens no temporary endpoint.

The bridge returns advertisements in terminal attach replies and in the
connection-scoped `workspace.list` metadata. Every endpoint method is checked
again at the socket dispatch boundary. Other operations using Herdr's control
API are not restricted by the endpoint method list. Browser-local workspace/tab
navigation, shared same-tab focus, cwd policy, topology, dimensions, and
foreground-recipient clipboard behavior are unchanged.

Only `health_check` enables optional endpoint ping/pong. `surface_interest` and
`presentation_effects_fence` are retained but do not enable new behavior: Studio
does not issue `client_shell.surface.set` or presentation fencing controls.
These meanings follow tagged Herdr 0.9.0 `src/protocol/endpoint.rs` and
`src/client/endpoint/registry.rs`. Input and resize are core codec operations,
not advertised methods. Unknown capability names cannot enable unknown binary
generations or codecs: Studio requires generation 1 and its four exact codecs,
in addition to the existing private-protocol allowlist.
