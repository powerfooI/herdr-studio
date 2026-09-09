# Endpoint mouse input (issue #108)

## Contract and routing

The wire contract was checked against Herdr **v0.9.0**, commit
`b99002ac99b09e00b4ca692436cb15a6b0d676f1`:

- [`src/protocol/wire.rs`](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/protocol/wire.rs):
  `ClientShellPaneInput` is message 13; `ClientPaneInputEvent::Mouse` is event 2.
  Its fields are kind, position, optional geometry, modifiers (`u8`), lines
  (`u16`). Kind order is Down, Up, Drag (each with Left/Right/Middle), Moved,
  ScrollUp, ScrollDown, ScrollLeft, ScrollRight. Cell position is variant 0.
- [`src/client/shell/mouse.rs`](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/client/shell/mouse.rs):
  `pane_mouse_position` subtracts the pane inner rectangle origin; cell positions
  are zero-based and have no geometry payload.
- [`src/server/pane_input.rs`](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/server/pane_input.rs):
  the runtime encodes semantic mouse input for the child's negotiated modes.
  Vertical wheel input uses `apply_scroll`; the runtime decides whether the
  child consumes it.

Studio crops each endpoint pane before displaying it. It negotiates xterm
cell-based SGR drag reporting (`1002` + `1006`), so subtracting one from incoming
SGR coordinates already gives pane-local cells; adding the tab offset would be
incorrect. Full surfaces and patches carry each pane's `mouse_reporting` flag.
The bridge forwards that flag only on endpoint terminal frames, checks mouse
input against the current target pane's mode and bounds, and keeps history on
`pane.scroll` when the app is not consuming mouse. A press must begin inside the
crop; its subsequent drag/release stays owned by that pane and clamps to the crop
edge even when the browser canvas is larger. Reporting changes and session close
cancel gesture ownership. Half-page keyboard/mobile shortcuts carry explicit
history intent: endpoint sessions use `pane.scroll`, while legacy connections
retain their original Wheel source and line count.

Browser selection uses xterm's native escape: **Option-drag on macOS**,
**Shift-drag elsewhere**. Ordinary output uses an unmodified drag. Copy uses the
existing browser copy handler. While an endpoint selection or selection drag is
active, rendering pauses and only the latest full repaint is retained. Clearing
the selection catches up. Reporting metadata still updates immediately; xterm
mode activation waits until selection clears because activation clears xterm's
selection. Pane/session changes discard pending presentation state. These frames
contain complete cell repaints, not incremental PTY output or clipboard controls.

If a repaint is already queued in xterm, selection initiation waits briefly for
its public `write` completion callback and selects the newly drained frame. The
original press and latest move/release are replayed locally, including short
clicks/drags released before completion. Selection intent immediately stops new
repaint submissions, so continuous output cannot delay initiation indefinitely.
Only one write and the newest pending frame are retained. The first release
freezes the captured gesture; later hover/release events remain native. A new
native press anywhere cancels obsolete replay before sibling document listeners
start. Blur or a pane/session reset cancels deferred initiation. Reset retains
any physical write gate until its completion, including while reporting metadata
is unknown; disposal prevents callbacks from reviving a dead presentation. Replay uses
xterm's selection escape if reporting changed and cannot send application input.
It does not replay clipboard actions or preserve privileged browser activation.

Pixel mouse and other keyboard protocols are not part of this change. Legacy
X10 byte mouse reports are not negotiated on the endpoint browser path.

## Automated verification actually run

`bun run precommit` and `bun run build:web` passed. Focused tests cover semantic
wire fields, modifiers, click/drag/release/wheels, split sequences, invalid
reports, pane bounds/isolation, full/patch mode changes, bridge ownership,
selection routing, latest-frame coalescing, lifecycle reset and xterm mode changes.
Existing legacy bridge, selection guard, scrolling and repaint tests also pass.

An isolated **real Herdr 0.9.0 / protocol 22** server and built Studio frontend
were exercised with a raw-mode Python child and headless Chromium on macOS:

- Child received exact expected click, drag, release and both vertical wheel
  reports from semantic input, including the original one-based VT coordinates.
- Browser clicks, drags and both wheel directions reached that child through the
  production TerminalView, WebSocket bridge and endpoint encoder.
- Option-drag produced nonempty copied text; after 800 ms of streaming output,
  copy returned the identical text and no selection gesture leaked into app input.
- Disabling application mouse reporting during selection preserved copied text.
  Escape cleared selection and resumed presentation; wheels then used the history
  RPC instead of terminal input. Window blur ended native selection dragging
  without extending the selection on later pointer movement.

Only disposable test processes were stopped; the user's Herdr sessions were not
used.

### Independent-review P1 regression round

All three source-backed findings were reproduced as failing tests before fixing
them. After the fix, `bun run precommit` passed with **1091 tests passed, one
existing live-SSH skip, zero failures**, and `bun run build:web` passed.

- An 8x3 fixture accepts Down at (8,3), then clamps Drag/Up at (9,3) to the pane
  edge. Outside initial presses cannot acquire ownership; mode changes cancel
  ownership and events never target the neighboring pane.
- Deterministic asynchronous tests cover an outstanding repaint, immediate
  selection intent, latest-frame retention, parser completion, cancellation and
  stale callbacks. The actual pinned xterm parser is also exercised.
- Keyboard/mobile half-page tests and bridge wire tests verify coordinate-less
  endpoint history while reporting is enabled and unchanged legacy Wheel bytes.
- Chromium additionally received controlled full terminal frames through the
  production WebSocket event handler while a test timer shim held zero-delay
  callbacks. A native down/move/up completed before xterm parsed B; replay then
  selected B, not prior A or pending C, despite queued mode activation. Later D
  output did not change copied text or send app input. A completed short click
  preserved down/up, button and click count; blur canceled a deferred drag.

These browser race checks use public DOM/WebSocket/timer APIs, not private xterm
parser hooks. The real Herdr smoke checks above were rerun against the fixed
build. This was scripted validation, **not manual Vim/lazygit or Safari
verification**.

### Second review round and final reset verification

The post-release hover/sibling replay and reset/write-gate failures were reproduced
before further edits. The current focused suite passes **75 tests**; precommit
passes **1095 tests, one existing live-SSH skip, zero failures**; the web build and
asset budget pass. Added regressions exercise real xterm reset with reporting on
and off, serialization across reset, and disposal before physical completion.

The final two-pane Chromium run used a copied build with an observer at the
supported `Terminal.write` callback boundary (the original delegate unchanged),
public buffer reads and held timer callbacks. Hover after release, cancellation
by a new outside press, and a sibling app drag passed. With A's queued write
observably pending, B received exactly the baseline Down/Drag/Up coordinates,
including one release, and no stale synthetic A events. The reporting-enabled
reset scenario also passed.

**The browser suite did not pass overall.** The reporting-disabled reset case
copied B where the fixture expected no selection before its explicit drain.
The write was proven pending before reset, but callback status at the later
native press was not recorded: this does not establish that a physical write
was still pending when selection began, nor prove a remaining production defect.
That historical result remains inconclusive, not retrospectively passing.

A separate focused Chromium diagnostic then recorded public write completion,
resize calls and native mouse events with timestamps. After same-terminal reset
with reporting disabled, B was still pending and A visible at native mousedown.
Selection stayed empty through mouseup; only B's completion triggered replay and
selected B. Later C preserved that copied text, the same terminal remained
connected, and no application input was emitted. Unchanged-size browser resize
calls returned without draining B; the earlier failure's cause is not established.
No production code changed for this diagnostic.

Final independent review confirmed both fixes and found no remaining issues,
with the manual verification gaps below retained.

## Manual checks still to run on Herdr 0.9.0

Use a disposable workspace with the default endpoint path enabled:

1. Start `vim -Nu NONE`, run `:set mouse=a ttymouse=sgr`, insert several lines,
   and test click placement, left-button dragging, release, and wheel directions.
   Repeat in `lazygit` using a disposable Git repository.
2. Split the tab horizontally and vertically. In each pane, click the first and
   last content cells and drag/wheel without moving the neighboring app. Repeat
   after switching the active pane and resizing.
3. Use Option-drag (macOS) or Shift-drag (other platforms) over a mouse-aware app;
   copy with Cmd+C/Ctrl+C. Repeat an ordinary selection in a shell emitting
   continuous output. Selected visible text must remain unchanged and copyable;
   clear the selection to see the latest output.
4. Exit the mouse-aware app. Wheel must browse server history instead of sending
   mouse escape text to the shell. Re-enter the app and verify routing changes
   back. Repeat with selection held during the mode change, and reconnect or
   change panes before clearing it to check for stale output.
5. Repeat selection/release-outside-window checks in Safari. Run Studio with
   `HERDR_GUI_DISABLE_ENDPOINT=1` and confirm the previous legacy terminal
   selection, copy and wheel behavior remains unchanged.
