import { expect, test } from "bun:test";
import { crc32, deflateSync } from "node:zlib";
import { resizeTerminalImage } from "./resize-terminal-image";

test("resizes Adam7 PNGs and bounds interlaced inflation before decoding", () => {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const png = (pixels: Buffer) =>
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", Buffer.from("00000002000000020806000001", "hex")),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  // A 2x2 Adam7 image has one pixel in pass 1, one in pass 6, two in pass 7.
  const data = png(
    Buffer.from([
      0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255,
    ]),
  );
  const key = { id: "interlaced", width: 2, height: 2, format: "png" as const };
  const preview = resizeTerminalImage(key, data, 4);
  expect([...Buffer.from(preview.data, "base64")]).toEqual([255, 0, 0, 255]);
  expect(() =>
    resizeTerminalImage(key, png(Buffer.alloc(1024 * 1024)), 4),
  ).toThrow();
});

test("box averages transparent RGBA without dark fringes", () => {
  const image = resizeTerminalImage(
    { id: "sample", width: 2, height: 2, format: "rgba" },
    Buffer.from([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    4,
  );
  expect([image.width, image.height, image.format]).toEqual([1, 1, "rgba"]);
  expect([...Buffer.from(image.data, "base64")]).toEqual([255, 0, 0, 64]);
});

test("averages RGB and fits very narrow sources without exceeding the budget", () => {
  const image = resizeTerminalImage(
    { id: "rgb", width: 2, height: 1, format: "rgb" },
    Buffer.from([255, 0, 0, 0, 0, 255]),
    4,
  );
  expect([...Buffer.from(image.data, "base64")]).toEqual([128, 0, 128, 255]);
  for (const [width, height] of [
    [1, 100],
    [100, 1],
  ]) {
    const narrow = resizeTerminalImage(
      { id: "narrow", width, height, format: "rgba" },
      Buffer.alloc(width * height * 4, 255),
      16,
    );
    expect(narrow.width * narrow.height * 4).toBeLessThanOrEqual(16);
    expect(
      Buffer.from(narrow.data, "base64").every((value) => value === 255),
    ).toBe(true);
  }
});
