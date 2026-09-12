import { expect, test } from "bun:test";

const asset = async (path: string) =>
  Buffer.from(
    await Bun.file(new URL(`../${path}`, import.meta.url)).arrayBuffer(),
  );

test("brand icons and sharing images have the declared dimensions", async () => {
  const images: [string, number, number][] = [
    ...[32, 180, 192, 512].map((size): [string, number, number] => [
      `web/public/roamgate-icon-${size}.png`,
      size,
      size,
    ]),
    ["web/public/roamgate-mark-48.png", 48, 48],
    ["web/public/roamgate-mark-72.png", 72, 72],
    ["site/roamgate-og.png", 1200, 630],
    ["site/github-social-preview.png", 1280, 640],
  ];
  for (const [path, width, height] of images) {
    const png = await asset(path);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      width,
      height,
    ]);
  }
});

test("legacy public image URLs serve Roamgate artwork too", async () => {
  for (const [legacy, current] of [
    ["web/public/herdr-icon.png", "web/public/roamgate-icon-512.png"],
    ["site/assets/herdr-icon.png", "site/assets/roamgate-icon-96.png"],
    ["site/assets/herdr-icon-48.png", "site/assets/roamgate-icon-48.png"],
    ["site/assets/herdr-icon-72.png", "site/assets/roamgate-icon-72.png"],
    ["site/og.png", "site/roamgate-og.png"],
  ]) {
    expect((await asset(legacy)).equals(await asset(current))).toBe(true);
  }
});
