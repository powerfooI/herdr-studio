# Security Policy

## Supported Versions

Security fixes are provided for the latest released version.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
private security advisory feature and include affected versions, reproduction
steps, and expected impact. If private advisories are unavailable, contact the
maintainer through the address listed on their GitHub profile.

## Trust Model

Roamgate is a privileged local administration tool. A connected browser can
interact with terminal sessions, run repository hooks, read session data, and
upload or delete workspace files. Anyone who can access the UI should be
treated as having the same authority as the user running Roamgate.

The server binds to `127.0.0.1` by default. In the current implementation,
listeners configured as `127.0.0.1`, `localhost`, or `::1` bypass built-in
authentication even when `ROAMGATE_PASSWORD` is set. If a VPN, SSH tunnel, or
reverse proxy forwards to that listener, its access policy is the remote
permission boundary; there is no additional Roamgate login gate. Require an
independently authenticated proxy if that boundary is insufficient.

Do not expose the service directly to the public internet. When binding to a
non-loopback address:

- Set a strong `ROAMGATE_PASSWORD`.
- Prefer `ROAMGATE_PASSWORD` over the `--password` flag so the password is not
  exposed in process arguments.
- Put the service behind HTTPS or a trusted VPN.
- Restrict network access with a firewall or reverse proxy.
- The bridge performs no browser-origin or request-host checks. Any request
  that reaches the listener (and, when required, passes authentication) has
  full authority over the GUI. Secure the access path yourself: terminate TLS
  at a trusted reverse proxy or VPN, keep the listener off untrusted networks,
  and use a strong password.
- Treat worktree hook configuration as executable code.

The built-in password protects application access but does not provide TLS,
rate limiting, multi-user authorization, or sandboxing.

Automatic updates trust the configured HTTPS release origin (or an explicitly
configured loopback test mirror) and its published manifest/checksum assets. Checksums detect corruption and bind the selected
archive, but they are not an independent publisher signature. Treat a custom
update mirror as trusted executable-code infrastructure.

`HERDR_GUI_*` remains a compatibility alias for `ROAMGATE_*`; an explicit new
value wins, including empty values. Auth-token migration preserves the legacy
secret rather than generating a replacement. Protect both copies and any backups;
see [migration and token rotation](./docs/DEPLOYMENT.md#transition-from-herdr-studio--herdr-gui).
Update requests require authentication under the same listener rules plus
`x-roamgate-update: 1`; legacy `x-herdr-gui-update: 1` is accepted for old clients.
The new header wins when both are supplied. Neither header substitutes for login.
