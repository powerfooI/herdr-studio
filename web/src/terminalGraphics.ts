import type { Terminal } from "@xterm/xterm";
import {
  GRAPHICS_BYTE_LIMIT,
  imageStorageBytes,
  isTerminalGraphics,
  type TerminalCellSize,
  type TerminalGraphics,
  type TerminalImage,
} from "../../server/src/bridge/terminal-graphics";

export function terminalCellPixels(term: Terminal): TerminalCellSize {
  const screen = term.element?.querySelector(".xterm-screen");
  const rect = screen?.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = rect ? Math.round((rect.width / term.cols) * ratio) : 0;
  const height = rect ? Math.round((rect.height / term.rows) * ratio) : 0;
  return width > 0 && height > 0 && width <= 512 && height <= 512
    ? { cell_width_px: width, cell_height_px: height }
    : { cell_width_px: 0, cell_height_px: 0 };
}

export function imageBytes(image: TerminalImage): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
  const pixels = image.width * image.height;
  if (
    pixels <= 0 ||
    pixels * 4 > GRAPHICS_BYTE_LIMIT ||
    bytes.length > GRAPHICS_BYTE_LIMIT
  )
    throw new Error("image limit");
  if (image.format === "png") {
    const view = new DataView(bytes.buffer);
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
      view.getUint32(8) !== 13 ||
      view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== image.width ||
      view.getUint32(20) !== image.height
    )
      throw new Error("invalid PNG dimensions");
  } else if (bytes.length !== pixels * (image.format === "rgb" ? 3 : 4))
    throw new Error("invalid image length");
  return bytes;
}

async function decodeImage(image: TerminalImage): Promise<ImageBitmap> {
  const bytes = imageBytes(image);
  if (image.format === "png")
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  if (image.format === "rgba") rgba.set(bytes);
  else
    for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
      rgba[j] = bytes[i];
      rgba[j + 1] = bytes[i + 1];
      rgba[j + 2] = bytes[i + 2];
      rgba[j + 3] = 255;
    }
  return createImageBitmap(new ImageData(rgba, image.width, image.height));
}

/** One bounded scene per terminal; the Herdr server remains the image/scroll authority. */
export class TerminalGraphicsLayer {
  private canvas = document.createElement("canvas");
  private notice = document.createElement("div");
  private assets = new Map<string, TerminalImage>();
  private bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  private scene: TerminalGraphics = { assets: [], placements: [], omitted: 0 };
  private generation = 0;
  private disposed = false;
  private animation: number | null = null;
  private renderSubscription;

  constructor(private term: Terminal) {
    this.canvas.className = "terminal-image-layer";
    this.canvas.setAttribute("aria-hidden", "true");
    this.notice.className = "terminal-image-notice";
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    term.element?.querySelector(".xterm-screen")?.append(this.canvas);
    term.element?.append(this.notice);
    this.renderSubscription = term.onRender(() => this.schedule());
  }

  update(update: TerminalGraphics | undefined) {
    if (this.disposed) return;
    if (update !== undefined) {
      if (!isTerminalGraphics(update)) {
        this.clear();
        this.showNotice(true);
        return;
      }
      const live = new Set(update.placements.map((p) => p.asset));
      for (const [id, bitmap] of this.bitmaps)
        if (!live.has(id)) {
          this.bitmaps.delete(id);
          void bitmap.then((b) => b?.close());
        }
      for (const id of this.assets.keys())
        if (!live.has(id)) this.assets.delete(id);
      for (const image of update.assets)
        if (live.has(image.id)) this.assets.set(image.id, image);
      let bytes = 0;
      for (const image of this.assets.values())
        bytes += imageStorageBytes(image);
      if (bytes > GRAPHICS_BYTE_LIMIT) {
        this.clear();
        this.showNotice(true);
        return;
      }
      this.scene = update;
      this.generation++;
    }
    this.schedule();
  }

  private schedule() {
    if (this.disposed || this.animation !== null) return;
    this.animation = requestAnimationFrame(() => {
      this.animation = null;
      void this.paint();
    });
  }

  private bitmap(image: TerminalImage): Promise<ImageBitmap | null> {
    const existing = this.bitmaps.get(image.id);
    if (existing) return existing;
    const pending = decodeImage(image)
      .then((bitmap) => {
        if (this.disposed || this.bitmaps.get(image.id) !== pending) {
          bitmap.close();
          return null;
        }
        return bitmap;
      })
      .catch(() => null);
    this.bitmaps.set(image.id, pending);
    return pending;
  }

  private async paint() {
    const generation = ++this.generation;
    const placements = this.scene.placements;
    const images = await Promise.all(
      placements.map((p) => {
        const image = this.assets.get(p.asset);
        return image ? this.bitmap(image) : null;
      }),
    );
    if (this.disposed || generation !== this.generation) return;
    const screen = this.term.element
      ?.querySelector(".xterm-screen")
      ?.getBoundingClientRect();
    if (!screen || screen.width <= 0 || screen.height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    // Cap the overlay too; image limits alone do not bound a huge terminal viewport.
    const scale = Math.min(
      ratio,
      Math.sqrt(GRAPHICS_BYTE_LIMIT / 4 / (screen.width * screen.height)),
    );
    const width = Math.max(1, Math.round(screen.width * scale)),
      height = Math.max(1, Math.round(screen.height * scale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = `${screen.width}px`;
    this.canvas.style.height = `${screen.height}px`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      this.showNotice(true);
      return;
    }
    ctx.clearRect(0, 0, width, height);
    let omitted = this.scene.omitted > 0;
    const cw = width / this.term.cols,
      ch = height / this.term.rows;
    const order = placements
      .map((p, i) => ({ p, image: images[i] }))
      .sort((a, b) => a.p.z - b.p.z);
    for (const { p, image } of order) {
      if (
        !image ||
        p.sourceX + p.sourceWidth > image.width ||
        p.sourceY + p.sourceHeight > image.height
      ) {
        omitted = true;
        continue;
      }
      ctx.drawImage(
        image,
        p.sourceX,
        p.sourceY,
        p.sourceWidth,
        p.sourceHeight,
        p.x * cw,
        p.y * ch,
        p.width * cw,
        p.height * ch,
      );
    }
    this.showNotice(omitted);
  }

  private showNotice(show: boolean) {
    this.notice.hidden = !show;
    if (show)
      this.notice.textContent =
        "Some terminal images could not be shown (size limit, unsupported layer, or decode error).";
  }

  clear() {
    this.generation++;
    this.scene = { assets: [], placements: [], omitted: 0 };
    this.assets.clear();
    for (const bitmap of this.bitmaps.values())
      void bitmap.then((b) => b?.close());
    this.bitmaps.clear();
    this.canvas
      .getContext("2d")
      ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.showNotice(false);
  }

  dispose() {
    this.disposed = true;
    if (this.animation !== null) cancelAnimationFrame(this.animation);
    this.renderSubscription.dispose();
    this.clear();
    this.canvas.remove();
    this.notice.remove();
  }
}
