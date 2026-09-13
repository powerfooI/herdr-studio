import { expect, test } from "bun:test";

test("renamed systemd template runs Roamgate and uses the Roamgate environment file", async () => {
  const unit = await Bun.file(
    new URL("../deploy/systemd/roamgate.service", import.meta.url),
  ).text();
  expect(unit).toContain("Description=Roamgate");
  expect(unit).toContain("ExecStart=%h/.local/bin/roamgate");
  expect(unit).toContain("EnvironmentFile=-%h/.config/roamgate/roamgate.env");
});

test("launchd template executes the installed Roamgate binary with Roamgate identities and state paths", async () => {
  const plist = await Bun.file(
    new URL("../deploy/launchd/dev.roamgate.plist", import.meta.url),
  ).text();
  const installer = await Bun.file(
    new URL("./install-roamgate.sh", import.meta.url),
  ).text();
  expect(installer).toContain('target="$install_dir/roamgate"');
  expect(installer).toContain("HERDR_GUI_INSTALL_DIR:-$HOME/.local/bin");
  expect(plist).toContain('exec "$HOME/.local/bin/roamgate"');
  expect(plist).not.toContain('exec "$HOME/.local/bin/herdr-gui"');
  expect(plist).toContain("<string>dev.roamgate</string>");
  expect(plist).toContain("$HOME/.config/roamgate/roamgate.env");
  expect(plist).not.toContain("RESTART_SUPERVISOR");
  expect(plist).toContain("__HOME__/Library/Logs/roamgate.stdout.log");
  expect(plist).toContain("__HOME__/Library/Logs/roamgate.stderr.log");
});
