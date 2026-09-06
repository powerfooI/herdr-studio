import type { ITheme, Terminal } from "@xterm/xterm";
import type { ResolvedTheme } from "./appearance";

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

export function terminalThemeFor(resolvedTheme: ResolvedTheme): ITheme {
  return resolvedTheme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

export function applyTerminalTheme(
  term: Terminal,
  resolvedTheme: ResolvedTheme,
) {
  // The ANSI stream does not distinguish Herdr's resolved default background
  // from an application's explicit RGB background. Preserve both; only xterm
  // defaults and its ANSI palette follow the app theme. No repaint/reset is needed.
  const theme = terminalThemeFor(resolvedTheme);
  term.options.theme = theme;
  if (theme.background) {
    term.element?.style.setProperty(
      "--terminal-canvas-background",
      theme.background,
    );
  }
}
