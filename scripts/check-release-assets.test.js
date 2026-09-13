import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  releaseAssetNames,
  verifyReleaseAssetNames,
} from "./check-release-assets.mjs";

describe("Roamgate release boundary", () => {
  const names = releaseAssetNames("0.7.0");

  test("publishes exactly six Roamgate targets and no legacy discovery paths", () => {
    expect(names).toHaveLength(30);
    expect(names).toContain("roamgate-linux-x64.update.json");
    expect(names).toContain("roamgate-v0.7.0-windows-arm64.tar.xz.sha256");
    expect(() => verifyReleaseAssetNames(names, "0.7.0")).not.toThrow();
    for (const prefix of ["herdr-gui", "herdr-studio"]) {
      for (const suffix of [
        "linux-x64.update.json",
        "linux-x64.tar.xz",
        "linux-x64.tar.xz.sha256",
      ]) {
        expect(() =>
          verifyReleaseAssetNames([...names, `${prefix}-${suffix}`], "0.7.0"),
        ).toThrow("unexpected");
      }
      expect(() =>
        verifyReleaseAssetNames([...names, `install-${prefix}.sh`], "0.7.0"),
      ).toThrow("unexpected");
    }
  });

  test("rejects missing or wrong-version assets", () => {
    expect(() => verifyReleaseAssetNames(names.slice(1), "0.7.0")).toThrow(
      "missing",
    );
    expect(() => verifyReleaseAssetNames(names, "0.7.1")).toThrow("missing");
    expect(() => releaseAssetNames("../bad")).toThrow(
      "Invalid release version",
    );
  });

  test("the publish workflow enforces the boundary and installs only Roamgate", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    expect(publish).toContain(
      'node scripts/check-release-assets.mjs "${GITHUB_REF_NAME#v}"',
    );
    expect(publish).toContain("scripts/install-roamgate.sh");
    expect(publish).not.toContain("herdr-gui");
    expect(publish).toContain("--latest");
  });
});
