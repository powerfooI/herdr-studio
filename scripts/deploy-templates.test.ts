import { expect, test } from "bun:test";

test("launchd template executes the installed Roamgate binary and retains service state paths", async () => {
  const plist = await Bun.file(
    new URL("../deploy/launchd/dev.herdr.herdr-gui.plist", import.meta.url),
  ).text();
  const installer = await Bun.file(
    new URL("./install-roamgate.sh", import.meta.url),
  ).text();
  expect(installer).toContain('target="$install_dir/roamgate"');
  expect(installer).toContain("HERDR_GUI_INSTALL_DIR:-$HOME/.local/bin");
  expect(plist).toContain('exec "$HOME/.local/bin/roamgate"');
  expect(plist).not.toContain('exec "$HOME/.local/bin/herdr-gui"');
  expect(plist).toContain("<string>dev.herdr.herdr-gui</string>");
  expect(plist).toContain("$HOME/.config/herdr-gui/herdr-gui.env");
  expect(plist).toContain("<key>HERDR_GUI_RESTART_SUPERVISOR</key>");
  expect(plist).toContain("__HOME__/Library/Logs/herdr-gui.stdout.log");
  expect(plist).toContain("__HOME__/Library/Logs/herdr-gui.stderr.log");
});
