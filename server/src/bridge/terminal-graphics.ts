// Shared, browser-safe graphics contract. No file paths or external URLs.
// ponytail: 4 MiB of image bytes/decoded pixels per scene keeps updates below the
// websocket backpressure limit; add a separate asset transport for larger scenes.
export const GRAPHICS_BYTE_LIMIT = 4 * 1024 * 1024;
export const GRAPHICS_PLACEMENT_LIMIT = 256;

export interface TerminalCellSize {
  cell_width_px: number;
  cell_height_px: number;
}

export interface TerminalImage {
  id: string;
  width: number;
  height: number;
  format: "rgb" | "rgba" | "png";
  data: string;
}

export function imageStorageBytes(image: TerminalImage): number {
  const padding = image.data.endsWith("==")
    ? 2
    : image.data.endsWith("=")
      ? 1
      : 0;
  return Math.max(
    image.width * image.height * 4,
    (image.data.length * 3) / 4 - padding,
  );
}

export interface TerminalImagePlacement {
  asset: string;
  // Pane-local cell coordinates, including fractional pixel offsets.
  x: number;
  y: number;
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  z: number;
}

export interface TerminalGraphics {
  assets: TerminalImage[];
  placements: TerminalImagePlacement[];
  omitted: number;
}

export function terminalCellSizeFromParams(
  params: Record<string, unknown>,
): TerminalCellSize {
  const width = params.cell_width_px ?? 0;
  const height = params.cell_height_px ?? 0;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    width > 512 ||
    height > 512 ||
    (width === 0) !== (height === 0)
  ) {
    throw new Error("invalid terminal cell pixel size");
  }
  return { cell_width_px: width, cell_height_px: height };
}

/** Validate before allocating browser image buffers; the server uses the same budget. */
export function isTerminalGraphics(value: unknown): value is TerminalGraphics {
  if (!value || typeof value !== "object") return false;
  const g = value as TerminalGraphics;
  if (
    !Array.isArray(g.assets) ||
    !Array.isArray(g.placements) ||
    g.assets.length > GRAPHICS_PLACEMENT_LIMIT ||
    g.placements.length > GRAPHICS_PLACEMENT_LIMIT ||
    !Number.isSafeInteger(g.omitted) ||
    g.omitted < 0
  )
    return false;
  const assets = new Map<string, TerminalImage>();
  let bytes = 0;
  let encodedBytes = 0;
  for (const a of g.assets) {
    if (
      !a ||
      typeof a.id !== "string" ||
      a.id.length > 4096 ||
      assets.has(a.id) ||
      !Number.isSafeInteger(a.width) ||
      !Number.isSafeInteger(a.height) ||
      a.width <= 0 ||
      a.height <= 0 ||
      !["rgb", "rgba", "png"].includes(a.format) ||
      typeof a.data !== "string" ||
      a.data.length > Math.ceil(GRAPHICS_BYTE_LIMIT / 3) * 4 ||
      a.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)
    )
      return false;
    bytes += imageStorageBytes(a);
    encodedBytes += a.data.length;
    if (
      bytes > GRAPHICS_BYTE_LIMIT ||
      encodedBytes > Math.ceil(GRAPHICS_BYTE_LIMIT / 3) * 4
    )
      return false;
    assets.set(a.id, a);
  }
  for (const p of g.placements) {
    if (!p || typeof p.asset !== "string" || p.asset.length > 4096)
      return false;
    const a = assets.get(p.asset);
    if (
      ![
        p.x,
        p.y,
        p.width,
        p.height,
        p.sourceX,
        p.sourceY,
        p.sourceWidth,
        p.sourceHeight,
        p.z,
      ].every(Number.isFinite) ||
      Math.abs(p.x) > 65535 ||
      Math.abs(p.y) > 65535 ||
      p.width <= 0 ||
      p.height <= 0 ||
      p.width > 65535 ||
      p.height > 65535 ||
      p.sourceX < 0 ||
      p.sourceY < 0 ||
      p.sourceWidth <= 0 ||
      p.sourceHeight <= 0 ||
      (a &&
        (p.sourceX + p.sourceWidth > a.width ||
          p.sourceY + p.sourceHeight > a.height)) ||
      p.z < 0
    )
      return false;
  }
  return true;
}
