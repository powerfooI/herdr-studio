import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome).each([
  [1300, 1],
  [500, 1.25],
])(
  "text size preserves menu placement, selection, and terminal mouse coordinates (width %d, DPR %d)",
  async (width, deviceScale) => {
    const dir = await mkdtemp(join(tmpdir(), "ui-scale-test-"));
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const assets = new Map<string, Blob>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path === "/") {
          return new Response(
            '<head><link rel="stylesheet" href="/uiScale.browser.css"></head><body><script src="/uiScale.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "uiScale.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      const errorOutput = join(dir, "browser.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless",
          "--disable-gpu",
          `--window-size=${width},800`,
          `--force-device-scale-factor=${deviceScale}`,
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(errorOutput) },
      );
      const failures = await Promise.race([
        promise,
        child.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
          );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Browser regression checks timed out")),
            30_000,
          );
        }),
      ]);
      expect(failures).toEqual([]);
    } finally {
      clearTimeout(timer);
      if (child) {
        child.kill();
        await child.exited;
      }
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);
