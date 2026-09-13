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

function createInstallerFixture(
  checksumName?: string,
  product: "roamgate" | "herdr-gui" = "roamgate",
) {
  const root = mkdtempSync(join(tmpdir(), "roamgate-installer-test-"));
  temporaryRoots.push(root);
  const assets = join(root, "assets");
  const fakeBin = join(root, "bin");
  const installDir = join(root, "install");
  const platform = currentReleasePlatform();
  const packageDir = `${product}-${platform}`;
  const archiveName = `${packageDir}.tar.xz`;
  const packagePath = join(assets, packageDir);
  mkdirSync(packagePath, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  const binary = join(packagePath, product);
  writeFileSync(
    binary,
    `#!/bin/sh\n[ "\${1:-}" = "--version" ] && { echo "${product} 9.8.7"; exit 0; }\nexit 1\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(packagePath, "VERSION"), `${product} 9.8.7 ${platform}\n`);

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

  return { root, assets, fakeBin, installDir, product };
}

function runInstaller(
  fixture: ReturnType<typeof createInstallerFixture>,
  releaseBaseUrl = "http://127.0.0.1/releases",
  environment: Record<string, string | undefined> = {},
) {
  return Bun.spawnSync(
    ["sh", join(import.meta.dir, `install-${fixture.product}.sh`)],
    {
      env: {
        ...process.env,
        PATH: `${fixture.fakeBin}:${process.env.PATH ?? ""}`,
        FIXTURE_DIR: fixture.assets,
        HERDR_GUI_RELEASE_BASE_URL: releaseBaseUrl,
        HERDR_GUI_INSTALL_DIR: fixture.installDir,
        HERDR_GUI_VERSION: undefined,
        ROAMGATE_RELEASE_BASE_URL: undefined,
        ROAMGATE_INSTALL_DIR: undefined,
        ROAMGATE_VERSION: undefined,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release installer", () => {
  test("retains the legacy installer without replacing Roamgate", () => {
    const fixture = createInstallerFixture(undefined, "herdr-gui");
    mkdirSync(fixture.installDir, { recursive: true });
    writeFileSync(join(fixture.installDir, "roamgate"), "keep Roamgate\n");
    writeFileSync(
      join(fixture.installDir, "herdr-gui"),
      "previous legacy binary\n",
    );
    const result = runInstaller(fixture);
    expect(result.exitCode).toBe(0);
    const installed = Bun.spawnSync([
      join(fixture.installDir, "herdr-gui"),
      "--version",
    ]);
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout.toString().trim()).toBe("herdr-gui 9.8.7");
    expect(
      readFileSync(join(fixture.installDir, "herdr-gui.previous"), "utf8"),
    ).toBe("previous legacy binary\n");
    expect(readFileSync(join(fixture.installDir, "roamgate"), "utf8")).toBe(
      "keep Roamgate\n",
    );
  });

  test("legacy checksum failure preserves the existing binary", () => {
    const fixture = createInstallerFixture(undefined, "herdr-gui");
    mkdirSync(fixture.installDir, { recursive: true });
    writeFileSync(
      join(fixture.installDir, "herdr-gui"),
      "keep legacy binary\n",
    );
    const archiveName = `herdr-gui-${currentReleasePlatform()}.tar.xz`;
    writeFileSync(
      join(fixture.assets, `${archiveName}.sha256`),
      `${"0".repeat(64)}  ${archiveName}\n`,
    );
    const result = runInstaller(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("package checksum mismatch");
    expect(readFileSync(join(fixture.installDir, "herdr-gui"), "utf8")).toBe(
      "keep legacy binary\n",
    );
    expect(existsSync(join(fixture.installDir, "herdr-gui.previous"))).toBe(
      false,
    );
  });

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
    expect(existsSync(join(installDir, "roamgate"))).toBe(true);
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
    writeFileSync(join(fixture.installDir, "roamgate"), "previous binary\n", {
      mode: 0o755,
    });
    writeFileSync(join(fixture.installDir, "herdr-gui"), "legacy GUI binary\n");
    writeFileSync(
      join(fixture.installDir, "herdr-studio"),
      "legacy Studio binary\n",
    );
    const result = runInstaller(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");

    const installed = Bun.spawnSync(
      [join(fixture.installDir, "roamgate"), "--version"],
      { stdout: "pipe" },
    );
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout.toString().trim()).toBe("roamgate 9.8.7");
    expect(
      readFileSync(join(fixture.installDir, "roamgate.previous"), "utf8"),
    ).toBe("previous binary\n");
    expect(readFileSync(join(fixture.installDir, "herdr-gui"), "utf8")).toBe(
      "legacy GUI binary\n",
    );
    expect(readFileSync(join(fixture.installDir, "herdr-studio"), "utf8")).toBe(
      "legacy Studio binary\n",
    );
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
    symlinkSync(outside, join(fixture.installDir, "roamgate"));

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
      "http://downloads.example.com/roamgate",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "release base URL must use HTTPS unless the mirror is loopback",
    );
  });
});
