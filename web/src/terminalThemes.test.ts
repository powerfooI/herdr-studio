import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/xterm";
import { applyTerminalTheme, terminalThemeFor } from "./terminalThemes";

describe("terminal themes", () => {
  test("changes defaults and the ANSI palette without changing dark defaults", () => {
    expect(terminalThemeFor("dark").background).toBe("#0b0d12");
    expect(terminalThemeFor("dark").red).toBeUndefined();
    expect(terminalThemeFor("light").background).toBe("#f6f7f9");
    expect(terminalThemeFor("light").red).toBe("#cf222e");
  });

  test("preserves explicit backgrounds when Herdr elides repeated SGR", async () => {
    const term = new Terminal({ allowProposedApi: true, cols: 120, rows: 3 });
    try {
      const frame =
        "\x1b[0;39;48;2;40;44;52mA" +
        " ".repeat(100) +
        "\x1b[0;38;2;255;255;255;48;2;80;0;0m X";
      await new Promise<void>((resolve) => term.write(frame, resolve));
      for (const theme of ["light", "dark"] as const) {
        applyTerminalTheme(term, theme);
        const line = term.buffer.active.getLine(0)!;
        expect(line.getCell(100)?.getBgColor()).toBe(0x282c34);
        expect(line.getCell(101)?.getBgColor()).toBe(0x500000);
        expect(line.getCell(102)?.getChars()).toBe("X");
        expect(term.options.theme?.background).toBe(
          terminalThemeFor(theme).background,
        );
      }
    } finally {
      term.dispose();
    }
  });

  test("leaves RGB components and indexed colors to xterm's parser", async () => {
    const term = new Terminal({ allowProposedApi: true });
    try {
      for (const theme of ["light", "dark"] as const) {
        applyTerminalTheme(term, theme);
        await new Promise<void>((resolve) =>
          term.write(
            "\x1b[H\x1b[0;38;2;48;2;200;48;2;40;44;52mX" +
              "\x1b[38;5;208;48;5;17mY",
            resolve,
          ),
        );
        const line = term.buffer.active.getLine(0)!;
        expect(line.getCell(0)?.getFgColor()).toBe(0x3002c8);
        expect(line.getCell(0)?.getBgColor()).toBe(0x282c34);
        expect(line.getCell(1)?.getFgColor()).toBe(208);
        expect(line.getCell(1)?.getBgColor()).toBe(17);
      }
    } finally {
      term.dispose();
    }
  });
});
