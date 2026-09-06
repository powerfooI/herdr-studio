import { describe, expect, test } from "bun:test";
import {
  inferTerminalCanvasBackground,
  terminalAnsiForTheme,
  terminalThemeFor,
} from "./terminalThemes";

describe("terminal theme ANSI adaptation", () => {
  test("matches dark xterm chrome to the rendered canvas background", () => {
    expect(terminalThemeFor("dark", [40, 44, 52]).background).toBe(
      "rgb(40 44 52)",
    );
    expect(terminalThemeFor("light", [40, 44, 52]).background).toBe("#f6f7f9");
  });

  test("infers the dominant true-color background from blank full-frame cells", () => {
    const frame = [
      "\x1b[0;39;48;2;40;44;52m ",
      "\x1b[0;39;48;2;40;44;52m ",
      "\x1b[0;38;2;255;0;0;48;2;9;10;11mX",
      "\x1b[0;39;48;2;9;10;11m ",
    ].join("");

    expect(inferTerminalCanvasBackground(frame)).toEqual([40, 44, 52]);
  });

  test("uses the xterm default background in light mode", () => {
    const frame =
      "\x1b[0;39;48;2;40;44;52mA" + "\x1b[1;38;2;255;0;0;48;2;9;10;11mB";

    expect(terminalAnsiForTheme(frame, "light", [40, 44, 52])).toBe(
      "\x1b[0;39;49mA\x1b[1;38;2;255;0;0;48;2;9;10;11mB",
    );
  });

  test("preserves CLI-owned ANSI, indexed, and true-color foregrounds", () => {
    const frame = [
      "\x1b[31;48;2;40;44;52mred",
      "\x1b[38;5;208;48;5;17mindexed",
      "\x1b[38;2;1;2;3;48;2;4;5;6mtrue-color",
    ].join("");

    expect(terminalAnsiForTheme(frame, "light", [40, 44, 52])).toBe(
      "\x1b[31;49mred" +
        "\x1b[38;5;208;48;5;17mindexed" +
        "\x1b[38;2;1;2;3;48;2;4;5;6mtrue-color",
    );
  });

  test("leaves the core frame unchanged in dark mode", () => {
    const frame = "\x1b[0;39;48;2;40;44;52mA";

    expect(terminalAnsiForTheme(frame, "dark", [40, 44, 52])).toBe(frame);
  });
});
