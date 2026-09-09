import type { BinReader } from "./bincode";
import { readFrameData } from "./thin-client";
import { resizeTerminalImage } from "./resize-terminal-image";

// Match the endpoint packet ceiling; large source images are never sent to browsers.
const SOURCE_BYTE_LIMIT = 32 * 1024 * 1024;
import {
  GRAPHICS_BYTE_LIMIT,
  GRAPHICS_PLACEMENT_LIMIT,
  imageStorageBytes,
  type TerminalGraphics,
  type TerminalImage,
  type TerminalCellSize,
} from "./terminal-graphics";

type AssetKey = Omit<TerminalImage, "data"> & {
  paneId: string | null;
  length: bigint;
};
type Placement = {
  key: AssetKey;
  x: number;
  y: number;
  cols: number;
  rows: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  xOffset: number;
  yOffset: number;
  z: number;
};
export interface EndpointGraphics {
  assets: Map<string, TerminalImage>;
  placements: Placement[];
}

function count(r: BinReader): number {
  const n = r.varint();
  if (!Number.isSafeInteger(n) || n < 0 || n > 4096)
    throw new Error("oversized graphics vector");
  return n;
}
function rect(r: BinReader) {
  for (let i = 0; i < 4; i++) r.varint();
}
function readKey(r: BinReader): AssetKey {
  const source = r.variant();
  let target = 0;
  let owner: string;
  let item: string | number;
  if (source === 0) {
    target = r.variant();
    if (target > 1) throw new Error("unknown graphics target");
    owner = r.string();
    item = r.varint();
  } else if (source === 1) {
    owner = r.string();
    item = r.string();
  } else throw new Error("unknown graphics source");
  const width = r.varint(),
    height = r.varint(),
    formatId = r.variant();
  const format = (["rgb", "rgba", "png"] as const)[formatId];
  if (!format) throw new Error("unknown graphics format");
  const length = r.varintBigInt(),
    fingerprint = r.varintBigInt();
  const id = JSON.stringify([
    source,
    target,
    owner,
    item,
    width,
    height,
    format,
    length.toString(),
    fingerprint.toString(),
  ]);
  return {
    id,
    paneId: target === 0 ? owner : null,
    width,
    height,
    format,
    length,
  };
}
function validImage(key: AssetKey, data: Buffer): boolean {
  if (
    !Number.isSafeInteger(key.width) ||
    !Number.isSafeInteger(key.height) ||
    key.width <= 0 ||
    key.height <= 0 ||
    key.width * key.height * 4 > SOURCE_BYTE_LIMIT ||
    data.length > SOURCE_BYTE_LIMIT ||
    BigInt(data.length) !== key.length
  )
    return false;
  if (key.format !== "png")
    return (
      data.length === key.width * key.height * (key.format === "rgb" ? 3 : 4)
    );
  // Check PNG dimensions before the browser decoder can allocate pixels.
  return (
    data.length >= 33 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.readUInt32BE(8) === 13 &&
    data.toString("ascii", 12, 16) === "IHDR" &&
    data.readUInt32BE(16) === key.width &&
    data.readUInt32BE(20) === key.height
  );
}

/** Consume the frozen surface tail, retaining only bounded live image assets. */
export function readEndpointGraphics(
  r: BinReader,
  previous?: EndpointGraphics,
): EndpointGraphics {
  for (let i = count(r); i > 0; i--) {
    r.variant();
    r.varint();
    rect(r);
    rect(r);
    for (let j = count(r); j > 0; j--) r.bool();
  }
  if (r.bool()) {
    r.string();
    r.string();
    for (let i = 0; i < 2; i++)
      r.option(() => {
        r.variant();
        r.varint();
      });
    readFrameData(r);
    r.bool();
    r.bool();
    r.varint();
    r.varint();
  }
  const incoming = new Map<string, { image: AssetKey; data: Buffer }>();
  let incomingBytes = 0;
  for (let i = count(r); i > 0; i--) {
    const key = readKey(r),
      data = r.bytes();
    const cost = Math.max(key.width * key.height * 4, data.length);
    if (
      validImage(key, data) &&
      incomingBytes + cost <= SOURCE_BYTE_LIMIT &&
      incoming.size < GRAPHICS_PLACEMENT_LIMIT
    ) {
      incoming.set(key.id, { image: key, data });
      incomingBytes += cost;
    }
  }
  const placements: Placement[] = [];
  for (let i = count(r); i > 0; i--) {
    const key = readKey(r);
    r.varint(); // logical placement ID
    const x = r.varint(),
      y = r.varint(),
      cols = r.varint(),
      rows = r.varint();
    const sourceX = r.varint(),
      sourceY = r.varint(),
      sourceWidth = r.varint(),
      sourceHeight = r.varint();
    const xOffset = r.varint(),
      yOffset = r.varint(),
      zigzag = r.varint();
    r.varint(); // scrollback offset; the source rectangle is already clipped
    placements.push({
      key,
      x,
      y,
      cols,
      rows,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      xOffset,
      yOffset,
      z: zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2,
    });
  }
  const live = new Set(placements.map((p) => p.key.id));
  for (let i = count(r); i > 0; i--) live.add(readKey(r).id);
  const candidates = new Map<
    string,
    { image: Omit<TerminalImage, "data">; data?: Buffer; cost: number }
  >();
  let total = 0;
  for (const id of live) {
    if (candidates.size >= GRAPHICS_PLACEMENT_LIMIT) break;
    const source = incoming.get(id);
    const cached = previous?.assets.get(id);
    if (source) {
      const cost = Math.max(
        source.image.width * source.image.height * 4,
        source.data.length,
      );
      candidates.set(id, { ...source, cost });
      total += cost;
    } else if (cached) {
      const cost = imageStorageBytes(cached);
      candidates.set(id, { image: cached, cost });
      total += cost;
    }
  }
  const assets = new Map<string, TerminalImage>();
  // Share the existing scene budget, reserving at least one pixel per image.
  const available = GRAPHICS_BYTE_LIMIT - candidates.size * 4;
  for (const [id, { image, data, cost }] of candidates) {
    const budget =
      total <= GRAPHICS_BYTE_LIMIT
        ? cost
        : 4 + Math.floor((available * cost) / total);
    try {
      let sourceData = data;
      if (!sourceData) {
        const cached = previous?.assets.get(id);
        if (!cached) continue;
        if (cost <= budget) {
          assets.set(id, cached);
          continue;
        }
        sourceData = Buffer.from(cached.data, "base64");
      }
      const a = resizeTerminalImage(image, sourceData, budget);
      // A changed preview must invalidate both the websocket delta and bitmap cache.
      a.id = `${id}:${a.width}x${a.height}:${a.format}:${Bun.hash(a.data).toString(16)}`;
      assets.set(id, a);
    } catch {
      // Bad/unsupported PNG data is omitted, without taking down terminal text.
    }
  }
  // ponytail: retain previews, not full originals. Quality can only increase after
  // Herdr resends an asset; add a separate bounded source cache if zoom needs it.
  return { assets, placements };
}

export function graphicsForPane(
  scene: EndpointGraphics | undefined,
  paneId: string,
  origin: { x: number; y: number },
  cell: TerminalCellSize,
): TerminalGraphics {
  const result: TerminalGraphics = { assets: [], placements: [], omitted: 0 };
  if (!scene) return result;
  const used = new Set<string>();
  for (const p of scene.placements) {
    if (p.key.paneId !== paneId) continue;
    const a = scene.assets.get(p.key.id);
    const sw = p.sourceWidth || p.key.width,
      sh = p.sourceHeight || p.key.height;
    const dx = p.xOffset / cell.cell_width_px,
      dy = p.yOffset / cell.cell_height_px;
    if (
      !a ||
      p.z < 0 ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      p.cols <= dx ||
      p.rows <= dy ||
      p.sourceX + sw > p.key.width ||
      p.sourceY + sh > p.key.height ||
      p.cols > 65535 ||
      p.rows > 65535 ||
      result.placements.length >= GRAPHICS_PLACEMENT_LIMIT
    ) {
      result.omitted++;
      continue;
    }
    const sourceX = (p.sourceX / p.key.width) * a.width;
    const sourceY = (p.sourceY / p.key.height) * a.height;
    result.placements.push({
      asset: a.id,
      x: p.x - origin.x + dx,
      y: p.y - origin.y + dy,
      width: p.cols - dx,
      height: p.rows - dy,
      sourceX,
      sourceY,
      sourceWidth: Math.min(a.width - sourceX, (sw / p.key.width) * a.width),
      sourceHeight: Math.min(
        a.height - sourceY,
        (sh / p.key.height) * a.height,
      ),
      z: p.z,
    });
    if (!used.has(a.id)) {
      used.add(a.id);
      result.assets.push(a);
    }
  }
  return result;
}
