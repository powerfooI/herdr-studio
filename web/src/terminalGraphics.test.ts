import { expect, test } from "bun:test";
import { imageBytes } from "./terminalGraphics";
import { TerminalResizeSync } from "./terminalResize";
import {
  imageStorageBytes,
  type TerminalImage,
} from "../../server/src/bridge/terminal-graphics";

const image: TerminalImage = {
  id: "test",
  width: 1,
  height: 1,
  format: "rgba",
  data: "/wAA/w==",
};

test("validates raw image lengths before browser allocation", () => {
  expect([...imageBytes(image)]).toEqual([255, 0, 0, 255]);
  expect([...imageBytes({ ...image, format: "rgb", data: "/wAA" })]).toEqual([
    255, 0, 0,
  ]);
  expect(() => imageBytes({ ...image, data: "/wAA" })).toThrow("length");
  expect(() => imageBytes({ ...image, width: 4096, height: 4096 })).toThrow(
    "limit",
  );
});

test("cache cost bounds encoded image bytes as well as decoded pixels", () => {
  expect(imageStorageBytes(image)).toBe(4);
  expect(
    imageStorageBytes({
      ...image,
      format: "png",
      data: Buffer.alloc(1024).toString("base64"),
    }),
  ).toBe(1024);
  expect(imageStorageBytes({ ...image, width: 100, height: 100 })).toBe(40_000);
});

test("checks PNG header dimensions before passing bytes to the browser decoder", () => {
  const png: TerminalImage = {
    ...image,
    format: "png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  };
  expect(imageBytes(png).length).toBeGreaterThan(33);
  expect(() => imageBytes({ ...png, width: 2 })).toThrow("dimensions");
  expect(() => imageBytes({ ...png, data: image.data })).toThrow("dimensions");
});

test("sends a pixel-only resize instead of deduplicating it by rows and columns", () => {
  const sent: unknown[] = [];
  const sync = new TerminalResizeSync((size) => {
    sent.push(size);
    return true;
  });
  const first = { cols: 80, rows: 24, cell_width_px: 8, cell_height_px: 16 };
  sync.markAttached(first);
  expect(sync.sendNow(first)).toBe(false);
  const retina = { ...first, cell_width_px: 16, cell_height_px: 32 };
  expect(sync.sendNow(retina)).toBe(true);
  expect(sync.sendNow(retina)).toBe(false);
  expect(sent).toEqual([retina]);
  sync.dispose();
});
