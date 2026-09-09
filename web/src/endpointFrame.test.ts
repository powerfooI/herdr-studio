import { expect, test } from "bun:test";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { Terminal } from "@xterm/xterm";
import { frameToAnsi } from "../../server/src/bridge/frame-to-ansi";
import type { FrameData } from "../../server/src/bridge/thin-client";

test.each(["中", "🙂", "👩‍💻", "🇨🇳", "ｶﾞ", "e\u0301"])(
  "keeps source columns and cursor after %s with production Unicode rendering",
  async (symbol) => {
    for (const cols of [5, 10]) {
      const term = new Terminal({ allowProposedApi: true, cols, rows: 3 });
      term.loadAddon(new UnicodeGraphemesAddon());
      try {
        const frame: FrameData = {
          width: 5,
          height: 2,
          cursor: { x: 4, y: 0, visible: true, shape: 1 },
          hyperlinks: [],
          cells: ["a", symbol, " ", " ", "x", symbol, " ", " ", "x", " "].map(
            (symbol) => ({
              symbol,
              fg: 0,
              bg: 0,
              modifier: 0,
              skip: false,
              hyperlink: null,
            }),
          ),
        };
        await new Promise<void>((resolve) =>
          term.write(frameToAnsi(frame), resolve),
        );
        const first = term.buffer.active.getLine(0)!;
        const second = term.buffer.active.getLine(1)!;
        expect(first.getCell(0)?.getChars()).toBe("a");
        expect(first.getCell(1)?.getChars()).toBe(symbol);
        expect(first.getCell(3)?.getChars()).toBe(" ");
        expect(first.getCell(4)?.getChars()).toBe("x");
        expect(second.getCell(0)?.getChars()).toBe(symbol);
        expect(second.getCell(2)?.getChars()).toBe(" ");
        expect(second.getCell(3)?.getChars()).toBe("x");
        expect(term.buffer.active.cursorX).toBe(4);
        expect(term.buffer.active.cursorY).toBe(0);
      } finally {
        term.dispose();
      }
    }
  },
);

test("endpoint repaints clear shortened text, blank rows, and a smaller pane", async () => {
  const term = new Terminal({ allowProposedApi: true, cols: 10, rows: 3 });
  try {
    for (const [text, width, height] of [
      ["abcdefghij".repeat(3), 10, 3],
      ["abc", 10, 3],
      ["x", 2, 1],
      ["", 2, 1],
    ] as const) {
      const frame: FrameData = {
        width,
        height,
        cursor: null,
        hyperlinks: [],
        cells: Array.from(text.padEnd(width * height), (symbol) => ({
          symbol,
          fg: 0,
          bg: 0,
          modifier: 0,
          skip: false,
          hyperlink: null,
        })),
      };
      await new Promise<void>((resolve) =>
        term.write(frameToAnsi(frame), resolve),
      );
      for (let y = 0; y < 3; y++) {
        expect(term.buffer.active.getLine(y)?.translateToString(true)).toBe(
          text.slice(y * width, (y + 1) * width),
        );
      }
    }
  } finally {
    term.dispose();
  }
});
