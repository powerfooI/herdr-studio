import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoots: string[] = [];

function currentReleasePlatform(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  throw new Error(
    `unsupported test platform: ${process.platform}-${process.arch}`,
  );
}

function createInstallerFixture(checksumName?: string) {
  const root = mkdtempSync(join(tmpdir(), "herdr-gui-installer-test-"));
  temporaryRoots.push(root);
  const assets = join(root, "assets");
  const fakeBin = join(root, "bin");
  const installDir = join(root, "install");
  const platform = currentReleasePlatform();
  const packageDir = `herdr-gui-${platform}`;
  const archiveName = `${packageDir}.tar.xz`;
  const packagePath = join(assets, packageDir);
  mkdirSync(packagePath, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  const binary = join(packagePath, "herdr-gui");
  writeFileSync(
    binary,
    '#!/bin/sh\n[ "${1:-}" = "--version" ] && { echo "herdr-gui 9.8.7"; exit 0; }\nexit 1\n',
    { mode: 0o755 },
  );
  writeFileSync(join(packagePath, "VERSION"), `herdr-gui 9.8.7 ${platform}\n`);

  const archive = join(assets, archiveName);
  const packaged = Bun.spawnSync(
    ["tar", "-C", assets, "-cJf", archive, packageDir],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stderr: "pipe",
    },
  );
  if (packaged.exitCode !== 0) {
    throw new Error(packaged.stderr.toString());
  }
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(
    `${archive}.sha256`,
    `${digest}  ${checksumName ?? archiveName}\n`,
  );

  const fakeCurl = join(fakeBin, "curl");
  writeFileSync(
    fakeCurl,
    `#!/bin/sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
cp "$FIXTURE_DIR/\${url##*/}" "$out"
`,
    { mode: 0o755 },
  );
  chmodSync(fakeCurl, 0o755);

  return { root, assets, fakeBin, installDir };
}

function runInstaller(
  fixture: ReturnType<typeof createInstallerFixture>,
  releaseBaseUrl = "http://127.0.0.1/releases",
  environment: Record<string, string | undefined> = {},
) {
  return Bun.spawnSync(["sh", join(import.meta.dir, "install-herdr-gui.sh")], {
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:${process.env.PATH ?? ""}`,
      FIXTURE_DIR: fixture.assets,
      HERDR_GUI_RELEASE_BASE_URL: releaseBaseUrl,
      HERDR_GUI_INSTALL_DIR: fixture.installDir,
      ROAMGATE_RELEASE_BASE_URL: undefined,
      ROAMGATE_INSTALL_DIR: undefined,
      ROAMGATE_VERSION: undefined,
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release installer", () => {
  test("prefers Roamgate variables, including empty VERSION for latest", () => {
    const fixture = createInstallerFixture();
    const installDir = join(fixture.root, "new-install");
    const result = runInstaller(fixture, "https://invalid.example/?rejected", {
      ROAMGATE_RELEASE_BASE_URL: "http://127.0.0.1/releases",
      ROAMGATE_INSTALL_DIR: installDir,
      ROAMGATE_VERSION: "",
      HERDR_GUI_VERSION: "invalid-version",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(installDir, "herdr-gui"))).toBe(true);
    expect(existsSync(fixture.installDir)).toBe(false);
  });

  test("rejects an explicitly empty Roamgate installation directory", () => {
    const fixture = createInstallerFixture();
    const result = runInstaller(fixture, undefined, {
      ROAMGATE_INSTALL_DIR: "",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "install directory must not be empty",
    );
    expect(existsSync(fixture.installDir)).toBe(false);
  });

  test("verifies, backs up, and installs the expected platform package", () => {
    const fixture = createInstallerFixture();
    mkdirSync(fixture.installDir, { recursive: true });
    writeFileSync(join(fixture.installDir, "herdr-gui"), "previous binary\n", {
      mode: 0o755,
    });
    const result = runInstaller(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");

    const installed = Bun.spawnSync(
      [join(fixture.installDir, "herdr-gui"), "--version"],
      { stdout: "pipe" },
    );
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout.toString().trim()).toBe("herdr-gui 9.8.7");
    expect(
      readFileSync(join(fixture.installDir, "herdr-gui.previous"), "utf8"),
    ).toBe("previous binary\n");
  });

  test("rejects filenames supplied by an untrusted checksum file", () => {
    const fixture = createInstallerFixture("../../unrelated-file");
    const result = runInstaller(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("invalid package checksum file");
  });

  test("refuses to replace a symlinked install target", () => {
    const fixture = createInstallerFixture();
    mkdirSync(fixture.installDir, { recursive: true });
    const outside = join(fixture.root, "outside-binary");
    writeFileSync(outside, "outside\n", { mode: 0o755 });
    symlinkSync(outside, join(fixture.installDir, "herdr-gui"));

    const result = runInstaller(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "install target exists but is not a regular file",
    );
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
  });

  test("rejects unauthenticated non-loopback release mirrors", () => {
    const fixture = createInstallerFixture();
    const result = runInstaller(
      fixture,
      "http://downloads.example.com/herdr-gui",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "release base URL must use HTTPS unless the mirror is loopback",
    );
  });
});
