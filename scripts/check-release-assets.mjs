import { readdir } from "node:fs/promises";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseAssetNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid release version");
  return [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
  ].flatMap((platform) => [
    `roamgate-v${version}-${platform}.tar.xz`,
    `roamgate-v${version}-${platform}.tar.xz.sha256`,
    `roamgate-${platform}.tar.xz`,
    `roamgate-${platform}.tar.xz.sha256`,
    `roamgate-${platform}.update.json`,
  ]);
}

/** A release must never accidentally reopen the legacy clients' update feed. */
export function verifyReleaseAssetNames(names, version) {
  const expected = releaseAssetNames(version);
  const unexpected = names.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !names.includes(name));
  if (unexpected.length || missing.length || names.length !== expected.length) {
    throw new Error(
      `Invalid release assets; unexpected: ${unexpected.join(", ")}; missing: ${missing.join(", ")}`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyReleaseAssetNames(
    await readdir(process.argv[3] ?? "dist"),
    process.argv[2],
  );
  process.stdout.write(
    "Verified Roamgate-only release assets; no legacy update or installer aliases.\n",
  );
}
