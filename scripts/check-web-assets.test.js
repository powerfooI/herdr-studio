import { describe, expect, test } from "bun:test";
import { initialAssetFiles } from "./check-web-assets.mjs";

describe("initial web asset budget", () => {
  test("counts transitive eager JS/CSS once, without charging lazy features", () => {
    expect(
      initialAssetFiles({
        "index.html": {
          isEntry: true,
          file: "app.js",
          imports: ["shared", "other"],
          css: ["app.css"],
          dynamicImports: ["preview"],
        },
        shared: { file: "shared.js", imports: ["other"], css: ["shared.css"] },
        other: { file: "other.js", imports: ["shared"], css: ["shared.css"] },
        preview: {
          isDynamicEntry: true,
          file: "preview.js",
          css: ["preview.css"],
        },
      }).sort(),
    ).toEqual(["app.css", "app.js", "other.js", "shared.css", "shared.js"]);
  });

  test("fails closed on missing entry points or missing eager chunks", () => {
    expect(() => initialAssetFiles({})).toThrow("no entry points");
    expect(() =>
      initialAssetFiles({
        app: { isEntry: true, file: "app.js", imports: ["missing"] },
      }),
    ).toThrow("Missing Vite manifest chunk");
  });
});
