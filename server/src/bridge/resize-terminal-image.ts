import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import type { TerminalImage } from "./terminal-graphics";

// pngjs bounds non-interlaced inflation itself. Preflight interlaced data too,
// before its decoder allocates an unbounded inflate buffer.
function decodePng(data: Buffer, width: number, height: number): Buffer {
  if (data[28] === 1) {
    const chunks: Buffer[] = [];
    for (let offset = 8, count = 0; offset < data.length; count++) {
      if (count >= 4096 || offset + 12 > data.length)
        throw new Error("invalid PNG chunks");
      const end = offset + 12 + data.readUInt32BE(offset);
      if (end > data.length) throw new Error("invalid PNG chunk length");
      if (data.toString("ascii", offset + 4, offset + 8) === "IDAT") {
        chunks.push(data.subarray(offset + 8, end - 4));
      }
      offset = end;
    }
    inflateSync(Buffer.concat(chunks), {
      maxOutputLength: width * height * 8 + height * 7 + 7,
    });
  }
  return PNG.sync.read(data).data;
}

/** Produce a bounded preview without changing the original asset's identity. */
export function resizeTerminalImage(
  image: Omit<TerminalImage, "data">,
  data: Buffer,
  byteBudget: number,
): TerminalImage {
  if (Math.max(image.width * image.height * 4, data.length) <= byteBudget) {
    return {
      id: image.id,
      width: image.width,
      height: image.height,
      format: image.format,
      data: data.toString("base64"),
    };
  }
  const pixels = Math.max(1, Math.floor(byteBudget / 4));
  const scale = Math.min(1, Math.sqrt(pixels / (image.width * image.height)));
  const width = Math.min(pixels, Math.max(1, Math.floor(image.width * scale)));
  const height = Math.min(
    Math.floor(pixels / width),
    Math.max(1, Math.floor(image.height * scale)),
  );
  const source =
    image.format === "png" ? decodePng(data, image.width, image.height) : data;
  const channels = image.format === "rgb" ? 3 : 4;
  const preview = Buffer.alloc(width * height * 4);
  // Box averaging keeps small text and thin lines, unlike nearest-neighbor sampling.
  // Average premultiplied colors so transparent pixels do not add dark fringes.
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * image.height) / height);
    const bottom = Math.floor(((y + 1) * image.height) / height);
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * image.width) / width);
      const right = Math.floor(((x + 1) * image.width) / width);
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const i = (sy * image.width + sx) * channels;
          const a = channels === 4 ? source[i + 3] : 255;
          red += source[i] * a;
          green += source[i + 1] * a;
          blue += source[i + 2] * a;
          alpha += a;
        }
      }
      const i = (y * width + x) * 4;
      if (alpha) {
        preview[i] = Math.round(red / alpha);
        preview[i + 1] = Math.round(green / alpha);
        preview[i + 2] = Math.round(blue / alpha);
      }
      preview[i + 3] = Math.round(alpha / ((right - left) * (bottom - top)));
    }
  }
  return {
    id: image.id,
    width,
    height,
    format: "rgba",
    data: preview.toString("base64"),
  };
}
