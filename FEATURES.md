# Herdr Studio Features

Herdr Studio is a browser and PWA client for a running
[Herdr](https://herdr.dev) server. It keeps Herdr's workspace, tab, pane, and
agent model, while adding repository tools, session inspection, mobile controls,
and operational features around it.

For installation and deployment, see
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). For a task-based introduction, see
the [hands-on tutorial](./docs/TUTORIAL.md).

## Workspace, Tab, and Pane Navigation

- Browse all Herdr workspaces and their recognized agents from one sidebar.
- Create, rename, focus, pin, and close workspaces.
- On Herdr 0.9.0 endpoints, each browser remembers its workspace, tab and pane
  selection per connection; workspace/tab navigation does not move other
  browsers or native clients.
  Reconnect preserves live selections; closing or moving a selected pane picks
  a remaining pane in the selected tab, then a remaining tab/workspace if needed.
  Reload starts from Herdr's current selection. The connection menu labels
  **Local navigation** versus the legacy **Shared navigation** fallback.
  Create/close/move operations and terminal sizes remain shared. Herdr's
  same-tab pane focus remains shared, including the pane supplying `follow` cwd.
  Creating tabs/workspaces preserves Herdr's cwd policy and requires the source
  terminal tab to be open and connected; unavailable sources show an error.
  An empty session can create its first workspace directly from Studio.
- Group linked Git worktrees under their parent repository workspace. Groups can
  be collapsed, while individual workspaces or worktrees can be pinned to the
  top. Pin and collapse preferences are stored in the current browser.
- Create, rename, switch, and close tabs in the focused workspace.
- Split the active pane right or down, resize pane boundaries with the pointer,
  focus neighboring panes, zoom a pane, and close panes.
- Use the searchable command menu (`Cmd/Ctrl+K`) for workspace, worktree, file,
  tab, pane, and agent actions. Entering a workspace-relative or absolute file
  path opens that file directly.

### Recent Pane Switcher

`Ctrl+Tab` opens a most-recently-used switcher that can jump between panes in
other tabs and workspaces. It keeps the 12 most recently focused live panes and
also includes panes in the current layout. Each entry shows its workspace, tab
or working directory, and Agent icon/status when available.

- Press `Ctrl+Tab` to start on the previously used pane.
- Keep holding `Ctrl` and press `Tab` to move forward.
- Use `Ctrl+Shift+Tab` to move backward.
- `Up` and `Down` also move through the list.
- Release `Ctrl` or press `Enter` to switch.
- Press `Esc` to cancel.

Closed panes are removed from the history automatically.

## Full Browser Terminal

- Render Herdr's server-side terminal stream at the browser's current rows and
  columns, including split-pane layouts.
- Send normal terminal input, modified Enter sequences, and common macOS
  line-editing shortcuts.
- Scroll terminal history with a mouse wheel, trackpad, touch gesture,
  `Page Up`/`Page Down`, or half-page `Alt/Option+Page Up`/`Page Down`.
  Endpoint history scrolling requires the server's advertised support; unavailable
  controls explain why. Explicit history shortcuts remain history actions even
  in mouse-aware apps.
- On Herdr 0.9.0 endpoints, clicks, drags, and wheels control mouse-aware terminal
  apps using pane-local cells. To select browser text instead, use Option-drag
  on macOS or Shift-drag elsewhere; ordinary output needs no modifier. Selection
  pauses visible endpoint output until cleared, then catches up to the latest
  repaint. Drag beyond the top or bottom of a pane to scroll while selecting;
  copying includes the rows that have scrolled offscreen. Releasing the mouse or
  losing window focus stops scrolling. If terminal output changes during the
  drag, finish the current selection before scrolling further. Pixel mouse is
  not supported.
- Paste multiline text through terminal paste handling.
- Paste a clipboard image to upload it on the Herdr host and insert the resulting
  path into the terminal. This also works through `--ssh-host`.
- Relay OSC 52 clipboard writes from local or remote terminal applications.
  On Herdr 0.9.0 endpoints, delivery follows the foreground recipient, not
  proven originating-pane ownership; see [clipboard compatibility](docs/DEPLOYMENT.md#herdr-compatibility).
- `Cmd/Ctrl`-click HTTP(S) links to open them safely in a new tab.
- `Cmd/Ctrl`-click workspace-relative or absolute file paths in terminal output
  to preview text, Markdown, or images without leaving the terminal.
- Preserve IME composition and rapid CJK punctuation input.

## Workspace Inspector

Files, Changes, and Agent History share one checkout-scoped Inspector. Open it
with the TabBar Inspector button or `Cmd+Shift+B`; workspace/agent context menus
can open a specific view. The header identifies the repository, branch/worktree,
and checkout path so similarly named files in sibling worktrees stay distinct.

- Dock right or bottom, resize, or expand while the terminal stays mounted.
  Header controls restore or close it; Esc dismisses transient UI, not the Inspector.
- Switching terminal tabs keeps it open. Switching workspaces follows the target
  checkout and restores its saved view, file selection, and layout. Closing
  returns to the originating tab if it still exists, otherwise the active tab.
- Wide layouts show navigation and content together; narrow layouts drill into
  a file/diff, with overlay or full-screen resource views on smaller screens.
  Drag the internal separator or use Left/Right and Home/End; double-click resets
  its width. Files and Changes save independent checkout-scoped widths.
- Browse Files from an agent starts at its cwd only when inside the checkout.
  Terminal file links use their pane's workspace, not a later focused workspace.
  Changes cover the checkout, not edits proven to belong to that agent.
- Closed worktrees must be visibly opened before browsing. Missing/prunable
  worktrees offer lifecycle cleanup rather than another checkout's files.
  Successful removal clears only that checkout's resource state.

File Preview is read-only; the Inspector does not create synthetic terminal tabs
or merge changes across worktrees. See [resource ownership](docs/ARCHITECTURE.md#workspace-resource-ownership)
for cache and routing boundaries.

## Agent Awareness and Session Inspection

Herdr reports recognized agents and their state, and Herdr Studio projects that
information across the workspace tree, pane switcher, command menu, and Agent
panel.

- See Agent identity and status such as working, blocked, done, or idle.
- Focus an Agent's pane from the sidebar, command menu, recent pane switcher, or
  a browser task-completion notification.
- Open Agent History in the Workspace Inspector with independent User, Agent,
  and Tool filters. User/Agent start enabled; Tool starts hidden. The recent
  window retains 200 conversation entries without counting associated tools;
  exports stay complete. See [History synchronization](docs/HISTORY.md).
- Use the History minimap to jump between messages; inspect tool details on demand.
- Keep agents nested under their workspace, or choose **Agents: Separate** at the
  bottom of the Workspaces panel for a dedicated panel. The separate panel
  defaults to **Attention first**: blocked, done, working, idle, then unknown.
  Use the Sort and Group icons beside **Agents** to choose an order or grouping.
  Choose workspace order or manual order; manual order with no grouping supports
  drag-to-reorder. Group by status, workspace, or agent type and collapse groups.
  Sorting and grouping are remembered in the browser; manual ordering is saved
  per connection.
- Agent rows show the tab name before the pane ID in both nested and separate
  views. Blank labels and numbered defaults such as `2` or `Tab 2` are omitted.
- Inspect turn count, token usage, update time, session ID, session file, and
  other session details.
- Open Session Inspector in Timeline, ATIF, or raw transcript mode, with search
  for ATIF and raw content.
- Export the original session file or the normalized ATIF trajectory.

Session inspection currently supports Codex, Claude, Kimi, Grok Build, and Pi.
It requires a readable session record; for agents that rely on Herdr integration,
the UI shows the integration command when session metadata is unavailable.
Session paths reported by Herdr are read from the remote host when `--ssh-host`
is active, and Pi session IDs support remote lookup. Other ID/directory fallback
searches, including Grok Build discovery, remain local and may not resolve a
remote session unless its transcript is also locally accessible.

## Git Worktree Lifecycle

Herdr Studio adds a repository-scoped lifecycle view around Herdr workspaces:

- Create a linked worktree from the latest fetched `origin/main` without
  modifying the source workspace's current branch or dirty files.
- Discover and open existing linked worktrees.
- View all repository checkouts, their paths, open/closed state, branch status,
  and uncommitted-change counts.
- Focus open worktrees, run `git pull`, and enable automatic branch updates per
  checkout.
- Remove linked worktrees with confirmation, hook execution, process cleanup,
  and recovery that preserves residual files when safe removal is not possible.
- Manage the lifecycle from a workspace context menu or from the command menu by
  searching for `worktree lifecycle`.

### Paseo Worktree Hooks

Herdr Studio understands the repository-local
[Paseo worktree hook](https://paseo.sh/docs/worktrees) format in `paseo.json`.
Add commands under `worktree`:

```json
{
  "worktree": {
    "setup": "bun install",
    "opened": "./scripts/worktree-opened.sh",
    "teardown": "./scripts/worktree-teardown.sh",
    "removed": "./scripts/worktree-removed.sh"
  }
}
```

| Paseo hook | When Herdr Studio runs it | Working directory |
| --- | --- | --- |
| `setup` | After a new linked worktree has been created and opened | New worktree |
| `opened` | After an existing linked worktree has been opened | Opened worktree |
| `teardown` | Before a linked worktree is removed | Worktree being removed |
| `removed` | After removal finishes | Source checkout |

For `setup`, `opened`, and `teardown`, Herdr Studio first looks for `paseo.json` in
the target checkout and falls back to the source checkout only when the target
has no `paseo.json`. The first existing file wins. After removal, the target no
longer exists, so `removed` normally uses the source checkout's configuration.

Commands run through `sh -c`. The following variables are available:

| Variable | Value |
| --- | --- |
| `PASEO_HOOK` | `setup`, `opened`, `teardown`, or `removed` |
| `PASEO_CHECKOUT_PATH` | Target worktree path, including the former path for `removed` |
| `PASEO_SOURCE_CHECKOUT_PATH` | Parent/source checkout path when known |
| `HERDR_GUI_HOOK_EVENT` | `worktree.created`, `worktree.opened`, `worktree.before_remove`, or `worktree.removed` |
| `HERDR_GUI_HOOK_CHECKOUT_PATH` | Same target path exposed under a `HERDR_GUI_`-prefixed alias |
| `HERDR_GUI_HOOK_SOURCE_CHECKOUT_PATH` | Same source path exposed under a `HERDR_GUI_`-prefixed alias |

Operation notices show the hook outcome and bounded diagnostic output; failures
can include the exit code, stderr, or an error. A failed `teardown` hook stops
removal so the repository can clean up or disable the hook before retrying.
Other hooks are not transactional: a failed `setup` or `opened` hook does not
undo the create/open operation, and a failed `removed` hook cannot restore an
already removed worktree.

Hooks are enabled by default for every repository. They can be disabled per
repository from **Worktree hooks** or **Worktree Lifecycle**; the dialogs also
show which `paseo.json` and commands were detected.

With `--ssh-host`, configuration is read and commands are executed on the remote
host. Hooks are trusted repository code and are not sandboxed; review a
repository's `paseo.json` before creating, opening, or removing its worktrees.

### Automatic Branch Updates

Automatic branch updates periodically fetch `origin/main` and merge it into an
enabled workspace's current branch. The default interval is 10 minutes, and the
current interval and last result are visible in the UI.

For safety, Herdr Studio skips a run when the checkout is dirty or on a detached
HEAD. It verifies that the branch, HEAD, and worktree did not change while the
fetch was running. A conflicting merge is aborted automatically. Updates run
only while the workspace is open in the current Herdr Studio connection.

Use **Menu → Automatic branch updates**, a workspace context menu, or Worktree
Lifecycle to manage saved per-checkout settings.

## File Explorer and Preview

- Browse a cached, expandable workspace file tree and optionally include hidden
  files.
- Search files that have been loaded into the tree.
- See Git status badges on changed files and directories; Git-ignored files
  are dimmed.
- Preview text with line numbers, syntax highlighting, and `Cmd/Ctrl+F` search.
- Render Markdown with a Raw/Rendered toggle, including Mermaid code fences
  rendered as diagrams.
- Render `.mmd`/`.mermaid` Mermaid sources as diagrams with a Raw/Rendered
  toggle.
- Follow relative file links in Markdown previews within the current Inspector.
  Links resolve from the document's directory; leading `/` resolves from the
  workspace root. Heading fragments scroll within the destination document.
  External links continue to open in a new browser tab.
- Preview common images, PDFs, and workspace-local Markdown images; unsupported
  binary files remain download-only.
- Drag files onto the workspace root or a directory to upload them.
- Download files directly or directories as workspace-scoped `.tar.gz`
  archives.
- Copy absolute paths and delete files or directories with confirmation.
- Open the file action menu with right-click on desktop or long-press on touch
  devices.

File operations and previews work for both local and SSH-backed workspaces.

## Review Annotations

- Click or drag across diff line numbers or a source-file annotation gutter
  to comment on one or more lines. Release to open the comment editor;
  captured context includes the file, line range, and content snapshot.
- Select text in rendered Markdown to annotate the exact passage with its
  nearest heading path.
- Edit, delete, and reorder comments in one checkout-scoped review panel.
- Copy the compiled feedback or pre-fill it in a selected Agent pane. Terminal
  delivery never submits the message; review it in the Agent input and press
  Enter manually.
- Drafts persist in the current browser until delivered or cleared. Refreshed
  files and diffs re-anchor matching content automatically and mark unresolved
  anchors as stale without dropping their captured quote.

## Diff Viewer

- Browse changed files as a directory tree with staged, unstaged, untracked,
  conflicted, and branch-diff badges plus added/deleted line counts.
- Switch between **Working tree**, the current branch **Against main**, and
  **Last step**, which retains the latest completed agent activity snapshot,
  including commits and untracked files. It is not proof of agent ownership.
- View all changed files in repository order. Large, truncated, and
  `linguist-generated=true` diffs start collapsed and render on expansion.
- Use side-by-side or unified diffs on desktop; mobile uses a unified layout.
- Toggle wrapping independently on desktop and mobile.
- Search the rendered diff with `Cmd/Ctrl+F`, Enter/Shift+Enter navigation, or
  the previous/next controls.
- Syntax-highlight textual diffs and preview changed image files.
- Jump from a diff section to the corresponding File Explorer preview.
- Act on working-tree files from a context menu (right-click, long-press, or
  the keyboard context-menu key): open the file, copy its relative or absolute
  path, and run status-matched Git actions — stage, unstage, mark resolved,
  discard unstaged changes, or delete untracked files, with confirmation for
  destructive actions.
- Run repository-wide actions from the **More Git actions** (`…`) menu beside
  Refresh: Stage All, Unstage All, Discard All Unstaged, and Delete All
  Untracked, each showing the affected-file count.

The selected scope, view mode, wrapping preference, and recent selection are
preserved per checkout in the browser. Git actions recheck file status and content
before mutation, rejecting stale menus rather than destroying newer work.

## Mobile and PWA

- Responsive workspace, terminal, File Explorer, and Diff Viewer layouts with
  mobile-safe viewport and keyboard handling.
- A floating terminal panel with two rows of configurable key actions.
- A direct `2×8` shortcut editor: empty slots retain their position in the
  editor but are compacted out of the runtime panel.
- Up to four optional terminal side buttons.
- Shortcut actions for control keys, arrows, Enter variants, and full/half-page
  terminal scrolling.
- A Paste shortcut that sends clipboard text to the pane and uploads clipboard
  images, pasting the uploaded path like the desktop paste flow.
- A mobile pane switcher for tabs containing multiple panes, and a Tabs sheet
  for creating, switching, and closing tabs when the tab strip is hidden.
- A composer for native IME, dictation, multiline editing, and image insertion.
  Insert adds the draft without executing; Send adds exactly one Enter. Drafts
  stay in memory per connection/pane and closing their pane, tab, or workspace
  requires confirmation before discarding them.
- A bundled glyph-only Nerd Font fallback for common terminal icons.
- Installable as a standalone PWA from iOS/iPadOS Safari, macOS Safari, Chrome,
  or Edge. PWA mode removes browser chrome but still requires a reachable
  `herdr-gui` server process; it does not provide offline access.
- Reload the current browser or standalone PWA from **Menu → Reload page**.

Mobile shortcut layouts and appearance preferences are stored in the current
browser and do not change Herdr server configuration.

## Remote, Multi-Client, and Operations

- Manage multiple local or SSH-backed Herdr profiles through the connection
  selector, with shared profiles but independent browser selection. Disconnecting
  a profile does not stop Herdr or its workspaces. See
  [connection setup](docs/DEPLOYMENT.md#multiple-and-remote-herdr-connections).
- Connect to a remote Herdr with `--ssh-host`; Herdr Studio automatically forwards
  both the control and terminal-render Unix sockets over SSH on Linux/macOS.
  Windows supports native local profiles, not this SSH forwarding transport.
- Apply file operations, image paste, Git operations, and Paseo hooks on the
  same remote host, with remote session inspection subject to the metadata
  resolution limits described above.
- Connect multiple browsers to one bridge and receive pushed Herdr events in
  each client.
- Pause or resume the current browser connection, see the connected-client
  count, or pause the other clients.
- Enable browser task-completion notifications that return directly to the
  relevant pane.
- Choose light/dark themes (or follow the system color scheme) and persistent accent colors.
- Pick a terminal color theme per appearance mode from built-in presets
  (Solarized, Dracula, One Dark, Nord, Tokyo Night, Catppuccin, GitHub, and
  more) via Menu → Appearance → Terminal theme, or create custom themes with
  your own base and ANSI colors; themes apply live to every terminal and are
  stored per browser.
- Scale the interface from 80% to 150% via Menu → Appearance → Text size,
  useful on mobile where browser zoom shortcuts are unavailable.
- Install and manage a systemd or launchd user service from the CLI.
- Check for Herdr Studio releases and perform a checksum-verified, one-click binary
  update when running a standalone binary under a supported supervisor.
- Use `/health` or `/healthz` for service probes.

Loopback binds bypass built-in authentication even when a password is configured.
Non-loopback binds use a generated login token unless a fixed password is configured. The built-in authentication
does not provide TLS, rate limiting, multi-user authorization, or sandboxing;
see [SECURITY.md](./SECURITY.md) before exposing the service.

## Keyboard Shortcut Reference

The in-app reference is available on desktop from **Menu → Keyboard shortcuts** (the mobile sheet omits it).

### Global

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+K` | Open or close the command menu |
| `Alt/Option+1` … `Alt/Option+9` while the command menu is open | Run the corresponding numbered visible action |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Open and navigate the recent Pane switcher |
| `Cmd+B` | Toggle the desktop sidebar |
| `Cmd+Shift+B` | Toggle the Workspace Inspector's last compatible view |
| `Cmd+T` | Create a tab in the focused workspace |
| `Cmd+W` | Close the active pane; close the tab if only one pane remains |
| `Cmd+Option+Left` / `Cmd+Option+Right` | Switch tabs, wrapping at either end |
| `Cmd+Ctrl+Left` / `Cmd+Ctrl+Right` / `Cmd+Ctrl+Up` / `Cmd+Ctrl+Down` | Focus the neighboring pane |
| `Cmd+D` | Split the active pane right |
| `Cmd+Shift+D` | Split the active pane down |
| `Ctrl+1` … `Ctrl+9` | Switch to a numbered tab in the focused workspace |
| `Ctrl+Shift+W` | Open Workspaces |
| `Cmd/Ctrl+Shift+E` | Toggle File Explorer |
| `Ctrl+Shift+G` | Open Diff Viewer |
| `Esc` | Dismiss the current menu, dialog, notification, or update banner |

A host browser can reserve shortcuts such as `Cmd+T`, `Cmd+W`, and `Cmd+D`;
they are most reliable in an installed PWA or another standalone/webview host.

### Terminal

| Shortcut | Action |
| --- | --- |
| `Page Up` / `Page Down` | Scroll terminal history by one page |
| `Alt/Option+Page Up` / `Alt/Option+Page Down` | Scroll terminal history by half a page |
| `Option+Drag` on macOS, `Shift+Drag` elsewhere | Select browser text in a mouse-aware endpoint app |
| `Shift+Enter` | Send a multiline Enter sequence |
| `Alt+Enter` | Send an Alt-modified Enter sequence |
| `Cmd+Left` / `Cmd+Up` | Move to the beginning of the current input line |
| `Cmd+Right` / `Cmd+Down` | Move to the end of the current input line |
| `Cmd+Backspace` | Delete to the beginning of the current input line |
| `Cmd+V` on Apple, `Ctrl+V` elsewhere | Paste text or images |
| `Cmd/Ctrl+Click` an HTTP(S) link | Open the link |
| `Cmd/Ctrl+Click` a file path | Preview the workspace file |
| `Cmd/Ctrl+Shift+H` | Toggle Agent message history for the active terminal |

### Preview and Diff

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+F` | Search the visible raw file preview or Diff Viewer |
| `Enter` / `Shift+Enter` in Diff search | Move to the next/previous match |
