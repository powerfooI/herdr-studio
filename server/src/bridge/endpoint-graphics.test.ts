import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { BinReader, BinWriter } from "./bincode";
import { graphicsForPane, readEndpointGraphics } from "./endpoint-graphics";
import {
  isTerminalGraphics,
  imageStorageBytes,
  GRAPHICS_BYTE_LIMIT,
  terminalCellSizeFromParams,
} from "./terminal-graphics";

const cell = { cell_width_px: 8, cell_height_px: 16 };
function scene({
  data = Buffer.from([255, 0, 0, 255]),
  fingerprint = 9007199254740993n,
  sendAsset = true,
  placed = true,
  z = 0,
  pane = "w1:p1",
  width = 1,
  height = 1,
  format = 1,
  copies = 1,
  sourceX = 0,
  sourceY = 0,
  sourceWidth = 0,
  sourceHeight = 0,
} = {}) {
  const w = new BinWriter();
  const key = (item: number) => {
    w.variant(0);
    w.variant(0);
    w.string(pane);
    w.varint(item);
    w.varint(width);
    w.varint(height);
    w.variant(format);
    w.varint(data.length);
    w.varint(fingerprint);
  };
  w.varint(0);
  w.bool(false); // splits / popup
  w.varint(sendAsset ? copies : 0);
  for (let i = 0; sendAsset && i < copies; i++) {
    key(i + 1);
    w.bytes(data);
  }
  w.varint(placed ? copies : 0);
  for (let i = 0; placed && i < copies; i++) {
    key(i + 1);
    w.varint(1);
    for (const n of [
      3,
      4,
      2,
      2,
      sourceX,
      sourceY,
      sourceWidth || width,
      sourceHeight || height,
      4,
      8,
    ])
      w.varint(n);
    w.varint(z < 0 ? -2 * z - 1 : 2 * z);
    w.varint(0);
  }
  w.varint(0);
  return new BinReader(w.toBuffer());
}

describe("endpoint image scenes", () => {
  test.each([
    "herdr-studio-mobile-terminal.png",
    "herdr-studio-mobile-file-viewer.png",
  ])(
    "automatically fits %s as PNG and Herdr RGBA, preserving crop and replay",
    (name) => {
      const png = readFileSync(
        new URL(`../../../docs/images/${name}`, import.meta.url),
      );
      const decoded = PNG.sync.read(png);
      for (const format of [1, 2]) {
        const options = {
          width: decoded.width,
          height: decoded.height,
          format,
          data: Buffer.from(format === 1 ? decoded.data : png),
          copies: 2,
          sourceX: 100,
          sourceY: 200,
          sourceWidth: 600,
          sourceHeight: 1200,
        };
        const parsed = readEndpointGraphics(scene(options));
        const g = graphicsForPane(parsed, "w1:p1", { x: 0, y: 0 }, cell);
        expect(g.omitted).toBe(0);
        expect(g.assets).toHaveLength(2);
        expect(isTerminalGraphics(g)).toBe(true);
        expect(() => JSON.stringify(g)).not.toThrow();
        expect(
          g.assets.reduce((n, a) => n + imageStorageBytes(a), 0),
        ).toBeLessThanOrEqual(GRAPHICS_BYTE_LIMIT);
        expect(g.assets[0].height).toBeLessThan(decoded.height);
        expect(g.assets[0].width / g.assets[0].height).toBeCloseTo(
          decoded.width / decoded.height,
          2,
        );
        expect(g.placements[0].sourceX).toBeCloseTo(
          (100 / decoded.width) * g.assets[0].width,
        );
        expect(g.placements[0].sourceHeight).toBeCloseTo(
          (1200 / decoded.height) * g.assets[0].height,
        );
        expect(g.placements[0].width).toBe(1.5);
        const replay = readEndpointGraphics(
          scene({ ...options, sendAsset: false }),
          parsed,
        );
        expect([...replay.assets.values()]).toEqual([
          ...parsed.assets.values(),
        ]);
        const single = readEndpointGraphics(scene({ ...options, copies: 1 }));
        expect([...single.assets.values()][0].id).not.toBe(g.assets[0].id);
      }
    },
  );

  test("keeps u64 fingerprints exact and crops placements into pane-local cells", () => {
    const parsed = readEndpointGraphics(scene());
    const g = graphicsForPane(parsed, "w1:p1", { x: 1, y: 2 }, cell);
    expect(g.assets[0].id).toContain("9007199254740993");
    expect(g.assets[0].data).toBe("/wAA/w==");
    expect(g.placements[0]).toMatchObject({
      x: 2.5,
      y: 2.5,
      width: 1.5,
      height: 1.5,
      sourceWidth: 1,
      sourceHeight: 1,
    });
    expect(isTerminalGraphics(g)).toBe(true);
    const next = readEndpointGraphics(
      scene({ fingerprint: 9007199254740992n }),
      parsed,
    );
    expect([...next.assets.keys()][0]).not.toBe([...parsed.assets.keys()][0]);
  });
  test("retains pixels for reference-only scenes and evicts deleted/replaced images", () => {
    const first = readEndpointGraphics(scene());
    const retained = readEndpointGraphics(scene({ sendAsset: false }), first);
    expect([...retained.assets.values()]).toEqual([...first.assets.values()]);
    const changed = readEndpointGraphics(scene({ fingerprint: 3n }), retained);
    expect(changed.assets.size).toBe(1);
    expect(changed.assets.has([...first.assets.keys()][0])).toBe(false);
    const removed = readEndpointGraphics(
      scene({ sendAsset: false, placed: false }),
      changed,
    );
    expect(removed.assets.size).toBe(0);
    expect(removed.placements).toEqual([]);
  });
  test("isolates panes and reports unsupported layers or invalid image lengths", () => {
    const parsed = readEndpointGraphics(scene());
    expect(
      graphicsForPane(parsed, "w2:p1", { x: 0, y: 0 }, cell).assets,
    ).toEqual([]);
    expect(
      graphicsForPane(
        readEndpointGraphics(scene({ z: -1 })),
        "w1:p1",
        { x: 0, y: 0 },
        cell,
      ).omitted,
    ).toBe(1);
    const bad = readEndpointGraphics(scene({ data: Buffer.from([1, 2, 3]) }));
    expect(bad.assets.size).toBe(0);
    expect(graphicsForPane(bad, "w1:p1", { x: 0, y: 0 }, cell).omitted).toBe(1);
  });
  test("rejects unbounded vectors, truncated payloads, and unsafe pixel sizes", () => {
    const w = new BinWriter();
    w.varint(4097);
    expect(() => readEndpointGraphics(new BinReader(w.toBuffer()))).toThrow(
      "oversized",
    );
    expect(() =>
      readEndpointGraphics(new BinReader(Buffer.from([0, 0, 1]))),
    ).toThrow("short read");
    expect(terminalCellSizeFromParams({})).toEqual({
      cell_width_px: 0,
      cell_height_px: 0,
    });
    expect(terminalCellSizeFromParams(cell)).toEqual(cell);
    for (const value of [-1, Infinity, 1.5, 513, "8"]) {
      expect(() =>
        terminalCellSizeFromParams({
          cell_width_px: value,
          cell_height_px: 16,
        }),
      ).toThrow();
    }
  });
  test("accepts bounded asset deltas but rejects large allocations and invalid crops", () => {
    const g = graphicsForPane(
      readEndpointGraphics(scene()),
      "w1:p1",
      { x: 0, y: 0 },
      cell,
    );
    expect(isTerminalGraphics({ ...g, assets: [] })).toBe(true);
    expect(
      isTerminalGraphics({
        ...g,
        assets: [{ ...g.assets[0], width: 100000, height: 100000 }],
      }),
    ).toBe(false);
    expect(
      isTerminalGraphics({
        ...g,
        placements: [{ ...g.placements[0], sourceWidth: 2 }],
      }),
    ).toBe(false);
    expect(
      isTerminalGraphics({ ...g, assets: [{ ...g.assets[0], data: "%%%=" }] }),
    ).toBe(false);
  });
});
