# Installation and Deployment

This guide covers installation, runtime configuration, remote connections,
user services, and standalone builds. For a guided private-access walkthrough
with Tailscale Serve, SSH forwarding, or experimental Tailcat port forwarding,
see the [hands-on tutorial](./TUTORIAL.md#networking).

## Requirements

- A running Herdr server.
- The default Herdr sockets at `~/.config/herdr/herdr.sock` and
  `~/.config/herdr/herdr-client.sock` on Unix, or the corresponding
  `%APPDATA%\herdr\` named pipes on Windows.
- [Bun](https://bun.sh) 1.4 or newer for source builds. Standalone binaries do
  not require Bun on the target machine.

### Herdr compatibility

This source build supports verified legacy protocols 14-20, from standalone
Herdr 0.7.0 / protocol 14 through Herdr 0.8.2 / protocol 20, and **tagged Herdr
0.9.0 / protocol 22**. The [plugin installer](#herdr-plugin) separately requires
Herdr 0.7.2 or newer. Protocol 21 and unknown versions are rejected at the control
probe and binary handshake. Use a Roamgate build explicitly supporting your
server, or a separate compatible server; do not downgrade a live server.
Published binaries retain the behavior documented for their release in the
[Changelog](../CHANGELOG.md).

Herdr 0.9.0 terminals use **stable endpoint generation 1** (distinct from
terminal protocol 22). Set `HERDR_GUI_DISABLE_ENDPOINT=1` to use the legacy
direct-terminal fallback:

- Endpoint rendering crops the server-rendered tab to each pane. Unknown endpoint
  generations/codecs are rejected. Missing required `pane.focus` fails attachment
  without silent fallback; optional advertised methods gate creation and history
  scrolling with a reason when unavailable. Input, mouse, paste, resize, and
  rendering can remain usable without optional history support. The explicitly
  enabled legacy fallback uses takeover and can disconnect another owner.
- Terminal-program OSC 52 writes follow Herdr's **foreground-recipient**
  behavior: Roamgate sends only to the browser with input in the last 30 seconds
  matching the receiving endpoint session, never to passive viewers. Herdr
  sends no producing-pane or input identity: a delayed/background write from
  pane A after B becomes foreground can reach B's recent input owner. This is
  not source-PTY isolation or a guarantee of the original initiating browser.
  Detach, session replacement, and connection disposal invalidate ownership.
  Clipboard reads remain disabled; browser permission failures retain the
  existing copy-retry UI. Ordinary browser selection copy and paste are unchanged.
  OSC 52 remains unavailable on the **0.9.0 legacy fallback** because only shell
  endpoints receive it. Legacy servers retain their existing clipboard relay.
- Workspace/tab navigation is browser-local per connection, surviving reconnect
  but not reload or runtime replacement. Same-tab pane focus, topology changes,
  and terminal sizes remain shared; sizing follows Herdr's last-interacting
  client. See [navigation behavior](../FEATURES.md#workspace-tab-and-pane-navigation).
  Tab/workspace creation preserves `terminal.new_cwd` (`follow`, `home`, `current`,
  or a fixed path), with explicit cwd taking precedence. Because same-tab focus
  is shared, `follow` does not isolate the browser's source pane. Open the source
  terminal tab before creating; unavailable sources fail explicitly. See
  [creation contracts](./ARCHITECTURE.md#browser-navigation-and-creation) for
  bootstrap and timeout handling.
- Legacy servers and `HERDR_GUI_DISABLE_ENDPOINT=1` retain **Shared navigation**:
  public JSON focus can move other clients. The connection menu shows the mode,
  using the bridge's actual backend selection, not browser version guesses.
  Enhanced Kitty keyboard / modifyOtherKeys parity and pixel mouse are not
  supported. Legacy keyboard-mode messages are decoded, not applied in-browser.
- Closing a workspace does not implicitly close its linked group. If Herdr
  requires group closure, Roamgate leaves it intact and directs you to the CLI:
  `herdr --session <name> workspace close <workspace_id> --group`. Review all
  linked workspaces first; this explicitly closes the entire group.

For endpoint negotiation, input, and reconnect contracts, see
[Architecture](./ARCHITECTURE.md#terminal-endpoints).

## Transition from Herdr Studio / herdr-gui

**Roamgate is a breaking distribution change, not an in-place update offered to
old clients.** Its releases publish only `roamgate-*` archives, checksums, and
update manifests, plus `install-roamgate.sh`. Starting with Roamgate 0.7.0,
the old default update and latest-installer URLs no longer work.
Old clients may report an update-check error: removing a manifest alone would
not stop their archive-based fallback, so neither legacy resource is published.
Existing processes keep running. Historical tagged releases are not modified.
Users remaining on old clients do not receive new fixes through that channel.
Custom mirrors and manually pinned historical downloads are outside this cutoff.

To switch an existing installation deliberately:

1. Back up the old executable, service definition, and configuration before
   switching. Preserve file permissions and authentication material. Include
   `~/.config/herdr-gui/` and, on Windows, `%APPDATA%\\herdr-gui\\` if present.
2. Install Roamgate using the instructions below. It installs a separate
   `roamgate` executable; it does not overwrite `herdr-gui`, start a service,
   create a legacy command alias, or move configuration.
3. For an unmodified built-in managed service, run `roamgate service install`
   explicitly to switch its executable. The service identity and environment
   file are reused, preventing a second managed service; expect a brief
   interruption. For custom definitions or supervisor wrappers, update the
   executable path manually instead: reinstalling can replace custom launch
   arguments. For an unmanaged process, stop the old process before starting
   Roamgate on its port.
4. Check `roamgate --version`, service status, login, and saved connections.
   To roll back, stop Roamgate and restore the previous executable/service
   definition. Keep the configuration backup: restoring it also discards
   settings changed after the backup. Do not run both versions against the same
   writable configuration concurrently.

Configuration paths, the `herdr.studio` plugin ID, service identities, and browser
storage remain unchanged in this distribution cutover. Environment aliases
remain supported. Updating the plugin checkout is an explicit switch, not a
path provided to an already-running old binary by its updater. Release-only plugin
installs download only Roamgate assets; unreleased checkouts require a source
build. Historical versions keep their original asset contracts.

### Repository and website addresses

The repository is [powerfooI/roamgate](https://github.com/powerfooI/roamgate).
GitHub redirects the former `powerfooI/herdr-studio` repository's Git and
release URLs, allowing already-published binaries and installers to keep their
original download addresses. Existing tags and release assets are not replaced;
new builds use the current repository address. Do not reuse the old repository
name, because doing so removes GitHub's redirects.

The website and tutorial are at <https://powerfooI.github.io/roamgate/>.
GitHub Pages does not redirect the old `/herdr-studio/` project-site path;
update bookmarks and external website links to `/roamgate/`.

### Install historical Herdr Studio

The original [install-herdr-gui.sh](../scripts/install-herdr-gui.sh) remains
in the repository and installs only `herdr-gui`, never Roamgate. Its default
Latest download no longer works: select a historical version explicitly. The
retained source script is not included in Roamgate releases and does not restore
the old update channel.

For example, install the historical 0.6.2 release with its pinned installer:

```bash
curl -fsSL \
  https://github.com/powerfooI/roamgate/releases/download/v0.6.2/install-herdr-gui.sh \
  | HERDR_GUI_VERSION=0.6.2 sh
```

This installs the old `herdr-gui` command, not `roamgate`. Historical versions
do not receive future fixes through the retired update channel.

## Install a release

Roamgate releases are available starting with 0.7.0. Historical 0.6.2 releases
do not contain Roamgate assets. To run an unreleased checkout, use the
[source build instructions](#build-a-standalone-executable) or the
[source plugin path](#herdr-plugin) instead.

Roamgate releases target Linux, macOS, and Windows on x86-64 and arm64.
On Linux and macOS, the installer verifies the release checksum and installs
the standalone binary to `~/.local/bin/roamgate`:

```bash
curl -fsSL \
  https://github.com/powerfooI/roamgate/releases/latest/download/install-roamgate.sh \
  | sh
```

Make sure `~/.local/bin` is in `PATH`, then run:

```bash
roamgate --version
roamgate
```

Open the URL printed by the process. Run the installer again to update.

Windows releases provide x64 and ARM64 archives containing `roamgate.exe`.
Download the matching `roamgate-windows-<arch>.tar.xz` and `.sha256` files from
the [latest release](https://github.com/powerfooI/roamgate/releases/latest),
verify the checksum with `Get-FileHash`, and extract the archive with Windows
11's built-in `tar.exe`. Releases predating native ARM64 support contain only
the x64 archive; prefer the native ARM64 package when it is available.

To install into a system directory, set `HERDR_GUI_INSTALL_DIR`:

```bash
curl -fsSL \
  https://github.com/powerfooI/roamgate/releases/latest/download/install-roamgate.sh \
  | sudo env HERDR_GUI_INSTALL_DIR=/usr/local/bin sh
```

Set `ROAMGATE_VERSION` to a published Roamgate version instead of `latest`
(replace `X.Y.Z` below; pre-Roamgate releases require their historical installer):

```bash
curl -fsSL \
  https://github.com/powerfooI/roamgate/releases/latest/download/install-roamgate.sh \
  | ROAMGATE_VERSION=X.Y.Z sh
```

`HERDR_GUI_RELEASE_BASE_URL` selects a compatible flat release mirror. Mirrors
must use HTTPS, except for loopback testing, and their URLs cannot contain
credentials, query strings, or fragments. The installer and in-app updater
preserve a replaced executable as `roamgate.previous` for manual recovery.

## Herdr plugin

Herdr 0.7.2 or newer can install Roamgate as a plugin. The shim requires
[Bun](https://bun.sh). Choose the installation path for your checkout:

**Unreleased checkout:** clone the repository to a directory you will keep,
compile explicitly, then link that local directory:

```bash
git clone https://github.com/powerfooI/roamgate.git
cd roamgate
bun scripts/studio-plugin.ts build-source
herdr plugin link .
```

`build-source` installs the root, web, and server dependencies and runs
`bun run build`. Only link after it succeeds. Linking does not run the manifest's
release download step; actions use the resulting `server/roamgate` executable
(`roamgate.exe` on Windows). Keep the checkout in place and rerun `build-source`
after updating it. Building and linking do not start the Roamgate service.

**Published Roamgate release:** replace `X.Y.Z` with a published Roamgate tag:

```bash
herdr plugin install powerfooI/roamgate --ref vX.Y.Z
```

Remote installation runs the manifest's `build` command, which downloads and
checksum-verifies only the Roamgate binary matching that checkout's version.
It does not compile on download failure or fall back to legacy assets.
Historical 0.6.2 assets cannot satisfy a Roamgate checkout; an unpublished
version cannot be installed through this release-only path.

Plugin actions manage the same user service described in
[Run as a user service](#run-as-a-user-service):

```bash
herdr plugin action invoke herdr.studio.start      # install and start the service
herdr plugin action invoke herdr.studio.url        # print the login URL
herdr plugin action invoke herdr.studio.status
herdr plugin action invoke herdr.studio.restart
herdr plugin action invoke herdr.studio.uninstall  # remove the service
```

Plugin actions run asynchronously; their output is recorded in the plugin
command log (`herdr plugin log list --plugin herdr.studio`). For an
interactive view, open the plugin's popup pane in the Herdr TUI:

```bash
herdr plugin pane open --plugin herdr.studio --entrypoint panel
```

The panel shows service status, the login URL, and the version, with
single-key start, restart, and uninstall controls. It opens as a
session-modal popup by default; pass `--placement split` (or `tab`, `zoomed`,
`overlay`) to open it as a regular pane that other Herdr clients can see.

## Basic runtime configuration

Flags override environment variables, which override defaults. Run
`roamgate --help` for the complete list.

Every `HERDR_GUI_*` setting below also accepts the corresponding `ROAMGATE_*`
name. The new name takes precedence when both are set, including an explicitly
empty value. This applies to runtime settings, connection registry paths, and
the installer's `VERSION`, `INSTALL_DIR`, and `RELEASE_BASE_URL` settings.
An empty installer `VERSION` selects the latest release; an empty `INSTALL_DIR`
is rejected. Herdr's own `HERDR_*` connection settings are unchanged.
Existing configuration paths and service identities are retained;
setting a new environment variable does not move or merge user data.

| Flag | Environment variable | Default |
| --- | --- | --- |
| `--host <addr>` | `HOST` | `127.0.0.1` |
| `--port <n>` | `PORT` | `8787` |
| `--password <pw>` | `HERDR_GUI_PASSWORD` | Generated token for non-loopback binds |
| `--socket-path <path>` | `HERDR_SOCKET_PATH` | Default Herdr control socket or named pipe |
| `--client-socket-path <path>` | `HERDR_CLIENT_SOCKET_PATH` | Default Herdr render socket or named pipe |
| `--ssh-host <user@host>` | `HERDR_SSH_HOST` | Disabled; supported on Linux and macOS |
| `--session <name>` | `HERDR_SESSION` | Named Herdr session, if set |
| `--public-dir <path>` | `PUBLIC_DIR` | Embedded assets |
| `--log-level <level>` | `HERDR_GUI_LOG_LEVEL` | `info` |
| `--open` | `OPEN_BROWSER=1` | Disabled |

Additional runtime settings:

| Environment variable | Purpose |
| --- | --- |
| `HERDR_GUI_UPDATE_BASE_URL` | Override the latest-release asset directory |
| `HERDR_GUI_DISABLE_UPDATE_CHECK=1` | Disable update checks |
| `HERDR_GUI_RESTART_SUPERVISOR=0\|1` | Declare or override external supervisor detection |
| `HERDR_GUI_DISABLE_ENDPOINT=1` | Use the legacy terminal fallback; see compatibility limits above |

A custom update mirror must use the same flat asset layout as GitHub Releases
and provide each platform archive, its `.sha256` file, and the corresponding
`roamgate-<platform>.update.json` metadata file with `name: "roamgate"`.
Roamgate rejects legacy manifests and does not fall back to reading archive
metadata when its manifest is missing. HTTPS is required except for
loopback test mirrors. URLs containing credentials, query strings, or fragments
are rejected.

Common examples:

```bash
# Local use without authentication
roamgate

# Listen on all interfaces with a generated token
roamgate --host 0.0.0.0 --port 8787

# Use a fixed password and the login page
roamgate --host 0.0.0.0 --port 8787 --password 's3cr3t'
```

Read [SECURITY.md](../SECURITY.md) before using a non-loopback bind.

## Logging

Runtime logs use one line per event with an ISO timestamp, severity, scope, and
bounded key/value context. The default `info` level records startup, connection
readiness and recovery, degraded states, and fatal failures without routine RPC,
Herdr event, terminal frame, or successful auto-sync traffic.

Use `debug` temporarily when diagnosing request or lifecycle behavior:

```bash
roamgate --log-level debug
# or in herdr-gui.env
HERDR_GUI_LOG_LEVEL=debug
```

For a managed service, restart after changing `herdr-gui.env`. Debug context can
include workspace paths and connection or terminal identifiers, so return to
`info` after collecting the required diagnostics. Runtime logs print browser
and LAN URLs without authentication tokens; generated tokens remain in the
protected token file described below.

## Multiple and remote Herdr connections

Use the connection selector beside the application title to add, test, connect,
disconnect, edit, and remove Herdr servers. Profiles are shared by authenticated
browsers, while each browser independently selects the connection it displays.
Local profiles attach to existing sockets and never start Herdr. When the first
profile is created, the default local server remains available as a writable
`Local` profile.

![Connection selector showing local and SSH profiles](./screenshots/multi-connection-selector.png)

The selector is keyboard accessible. Focus its trigger and open it with Enter,
Space, Arrow Up, or Arrow Down; navigate with the arrow, Home, and End keys.
There is currently no global next/previous-connection shortcut.

SSH profiles require an already-running remote Herdr server and accept only an
OpenSSH alias or `user@host`. Leave the remote control and render socket paths
empty to resolve the default sockets under the remote home directory. Configure
ports, jump hosts, identities, and other transport details in `~/.ssh/config`.
Roamgate follows normal OpenSSH host-key and agent or Keychain policies; it
does not store passwords, private keys, passphrases, or arbitrary SSH options.

```text
Destination: workbox
Control socket: (empty - auto)
Render socket:  (empty - auto)
```

SSH profiles and `--ssh-host` currently require Roamgate to run on Linux or
macOS because the stream-local transport cannot expose a forwarded Unix socket
as a local Windows named pipe. Windows supports native local Herdr profiles.

Profiles are stored atomically in `~/.config/herdr-gui/connections.json`
(overridable with `HERDR_GUI_CONNECTIONS_PATH`), with directory mode `0700` and
file mode `0600` on Unix. Registry/direct-parent symlinks are rejected. Version-1
local registries migrate to version 2 on the first successful mutation. Invalid
registries are preserved with mutations disabled: repair the durable file before
retrying. A failed durable rollback retires routing and disables further profile
changes rather than allowing disk and memory to disagree.

`auto_connect` controls profile startup; browser selection is independent.
Disconnecting or removing a profile stops only its bridge runtime/tunnel, not
Herdr or its workspaces. SSH profiles retry transient transport failures, but
not authentication, host-key, or permanent protocol errors. Confirm host keys
and authentication as the service user before connecting; service SSH cannot
prompt interactively. There is no automatic idle cleanup or aggregate runtime
resource budget, so disconnect unused profiles when conserving resources.
See [connection isolation](./ARCHITECTURE.md#connection-isolation) and
[SSH transport](./ARCHITECTURE.md#ssh-transport).

Explicit CLI/environment socket or SSH settings remain authoritative as a
read-only `legacy-default` process profile; edit those settings to change that
connection. Browser preferences from the old single-connection setup migrate
once into the first real profile without overwriting existing values.

The legacy command-line connection is also available:

```bash
roamgate --ssh-host user@host
```

It forwards both control and terminal-render sockets. Image paste, workspace
file operations, Git operations, and repository worktree hooks then run on the
remote host. Explicit `--socket-path` and `--client-socket-path` values override
the automatically selected tunnel paths.

## Run as a user service

The standalone binary can install and manage a platform-native user service:

```bash
roamgate service install
roamgate service status
roamgate service restart
roamgate service reload
roamgate service uninstall
```

| Command | Behavior |
| --- | --- |
| `service install` | Create or update the service definition and start it |
| `service install --force` | Replace a definition not generated by Roamgate |
| `service status` | Show native service-manager status |
| `service restart` | Restart after changing `herdr-gui.env` |
| `service reload` | Reload the platform definition, then restart |
| `service uninstall` | Stop and remove the service while preserving configuration and tokens |

Verify the running service with:

```bash
curl -fsS http://127.0.0.1:8787/healthz
```

Linux uses a systemd user service with `Restart=always`; macOS uses a launchd
LaunchAgent with `KeepAlive`; Windows registers a current-user Task Scheduler
job that starts at login, runs with normal privileges, and restarts on failure.

A new service listens on `0.0.0.0:8787`, creates a persistent login token, and
prints tokenized localhost and LAN URLs during installation. Configuration is
stored in `~/.config/herdr-gui/herdr-gui.env` on Unix or
`%APPDATA%\herdr-gui\herdr-gui.env` on Windows and is preserved on reinstall or
uninstall. Edit that file for `HOST`, `PORT`, an optional fixed password, and
Herdr connection settings, then run `roamgate service restart`.

The random token is stored in `~/.config/herdr-gui/auth-token` on Unix and
`%APPDATA%\herdr-gui\auth-token` on Windows. Visiting a printed `?token=...` URL
sets an HttpOnly session cookie and removes the token from the address bar. To
rotate the token, stop the service, delete the token file, and restart.

On Windows, approve the Task Scheduler or firewall prompt if one appears. Allow
Private networks only, or set `HOST=127.0.0.1` before installation for
local-only access. On Linux, enable linger with
`sudo loginctl enable-linger "$USER"` if the service must survive logout.

Templates under `deploy/` remain available for manual customization. A custom
systemd wrapper should replace `ExecStart` while leaving systemd as the restart
owner:

```ini
[Service]
ExecStart=
ExecStart=/absolute/path/service-wrapper -- %h/.local/bin/roamgate --host 0.0.0.0
```

The updater saves the replaced executable as `roamgate.previous`, atomically
installs the verified binary, and exits. It never starts a replacement process.
A subsequent `service install` preserves a custom `ExecStart` from a managed
unit when it still invokes the same Roamgate binary.

## Build a standalone executable

The build embeds the frontend and Bun runtime in a self-contained executable.
From a local checkout, install dependencies and compile with the shared source
build command:

```bash
bun scripts/studio-plugin.ts build-source
# server/roamgate (server/roamgate.exe on Windows)
```

With dependencies already installed, `bun run build` rebuilds directly.

The executable serves the frontend, WebSocket bridge, and HTTP APIs and connects
to the configured Herdr sockets. The target machine does not need Bun.

Cross-compile or package supported targets with:

```bash
bun run build:linux-x64
bun run build:linux-arm64
bun run build:darwin-x64
bun run build:darwin-arm64
bun run build:windows-x64
bun run build:windows-arm64
bun run build:all

bun run package:linux-x64
bun run package:linux-arm64
bun run package:darwin-x64
bun run package:darwin-arm64
bun run package:windows-x64
bun run package:windows-arm64
```

Bun downloads the target runtime automatically. Use the glibc Linux x86-64
build for Ubuntu, Debian, Fedora, and CentOS; the musl build is not supported on
these hosts because Bun's musl binary still dynamically links `libstdc++` and
`libgcc_s`.

Run or clean a local build with:

```bash
./server/roamgate
bun run clean
```

## Troubleshooting

### Roamgate cannot connect to Herdr

Confirm that Herdr is running and that its control socket exists:

```bash
ls ~/.config/herdr/herdr.sock
roamgate --socket-path /path/to/herdr.sock
```

### Another device cannot open Roamgate

Listen on all interfaces, use the tokenized URL printed at startup, and confirm
that both devices are on the same network and the firewall allows the port:

```bash
roamgate --host 0.0.0.0 --port 8781
```

### `--ssh-host` still connects locally

Do not also set `--socket-path`, `--client-socket-path`, `HERDR_SOCKET_PATH`, or
`HERDR_CLIENT_SOCKET_PATH`; explicit socket paths override automatic SSH
tunnels.

### Open the browser automatically

Pass `--open` or set `OPEN_BROWSER=1`:

```bash
roamgate --open
```

For release preparation and platform packaging requirements, see
[AGENTS.md](../AGENTS.md).
