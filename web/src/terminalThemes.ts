import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "./appearance";

export type TerminalRgb = readonly [red: number, green: number, blue: number];

// Dark keeps the historical palette exactly: only background, foreground,
// cursor, and selection are overridden; ANSI colors stay at xterm defaults.
const DARK_TERMINAL_THEME: ITheme = {
  background: "#0b0d12",
  foreground: "#c9cdd6",
  cursor: "#c9cdd6",
  overviewRulerBorder: "rgba(0,0,0,0)",
  selectionBackground: "rgba(110,168,255,0.3)",
};

// Light mode needs the full 16-color ANSI palette: the dark-oriented default
// palette (bright blues, greens, yellows) is unreadable on a light background.
const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#f6f7f9",
  foreground: "#2b3245",
  cursor: "#2b3245",
  overviewRulerBorder: "rgba(0,0,0,0)",
  selectionBackground: "rgba(46,125,233,0.25)",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#7d4e00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightBlue: "#0550ae",
  brightMagenta: "#6639ba",
  brightCyan: "#0a6b74",
  brightWhite: "#8c959f",
};

function terminalRgbCss(rgb: TerminalRgb): string {
  return `rgb(${rgb.join(" ")})`;
}

export function terminalThemeFor(
  resolvedTheme: ResolvedTheme,
  canvasBackground: TerminalRgb | null = null,
): ITheme {
  if (resolvedTheme === "light") return LIGHT_TERMINAL_THEME;
  return canvasBackground
    ? { ...DARK_TERMINAL_THEME, background: terminalRgbCss(canvasBackground) }
    : DARK_TERMINAL_THEME;
}

const SGR_WITH_CELL_RE = /\x1b\[([0-9;:]*)m([^\x1b]?)/g;
const SGR_RE = /\x1b\[([0-9;:]*)m/g;

function trueColorBackground(params: string): TerminalRgb | null {
  const values = params.split(";").map(Number);
  for (let index = 0; index <= values.length - 5; index += 1) {
    if (values[index] !== 48 || values[index + 1] !== 2) continue;
    const red = values[index + 2];
    const green = values[index + 3];
    const blue = values[index + 4];
    if (
      Number.isInteger(red) &&
      Number.isInteger(green) &&
      Number.isInteger(blue) &&
      red >= 0 &&
      red <= 255 &&
      green >= 0 &&
      green <= 255 &&
      blue >= 0 &&
      blue <= 255
    ) {
      return [red, green, blue];
    }
  }
  return null;
}

function rgbKey(rgb: TerminalRgb): string {
  return rgb.join(",");
}

/**
 * Herdr's TerminalAnsi renderer paints every cell with the resolved core theme
 * background instead of emitting ANSI default-background (49). Infer that
 * canvas color from blank cells in a full frame so a browser can substitute
 * its own light background without recoloring application-owned backgrounds.
 */
export function inferTerminalCanvasBackground(
  fullFrame: string,
): TerminalRgb | null {
  const counts = new Map<string, { count: number; rgb: TerminalRgb }>();
  for (const match of fullFrame.matchAll(SGR_WITH_CELL_RE)) {
    if (match[2] !== " ") continue;
    const rgb = trueColorBackground(match[1] ?? "");
    if (!rgb) continue;
    const key = rgbKey(rgb);
    const current = counts.get(key);
    counts.set(key, { count: (current?.count ?? 0) + 1, rgb });
  }
  let best: { count: number; rgb: TerminalRgb } | null = null;
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best?.rgb ?? null;
}

/** Replace only Herdr's inferred canvas background; true-color output stays intact. */
export function terminalAnsiForTheme(
  text: string,
  resolvedTheme: ResolvedTheme,
  canvasBackground: TerminalRgb | null,
): string {
  if (resolvedTheme !== "light" || !canvasBackground) return text;
  const expected = rgbKey(canvasBackground);
  return text.replace(SGR_RE, (sequence, params: string) => {
    const values = params.split(";");
    for (let index = 0; index <= values.length - 5; index += 1) {
      if (values[index] !== "48" || values[index + 1] !== "2") continue;
      if (values.slice(index + 2, index + 5).join(",") !== expected) continue;
      values.splice(index, 5, "49");
      return `\x1b[${values.join(";")}m`;
    }
    return sequence;
  });
}
