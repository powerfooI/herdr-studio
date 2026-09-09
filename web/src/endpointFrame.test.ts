import { expect, test } from "bun:test";
import { Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { frameToAnsi } from "../../server/src/bridge/frame-to-ansi";
import type { FrameData } from "../../server/src/bridge/thin-client";

test("wide-character padding does not add spaces or wrap mixed text into the next row", async () => {
  const term = new Terminal({ allowProposedApi: true, cols: 10, rows: 3 });
  term.loadAddon(new UnicodeGraphemesAddon());
  try {
    const symbols = [
      "中",
      " ",
      "文",
      " ",
      "A",
      "B",
      " ",
      "X",
      "🙂",
      " ",
      "e\u0301",
      "中",
      " ",
      " ",
      "文",
      " ",
      "E",
      "N",
      "D",
      " ",
    ];
    const frame: FrameData = {
      width: 10,
      height: 2,
      cursor: null,
      hyperlinks: [],
      cells: symbols.map((symbol) => ({
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
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "中文AB X🙂",
    );
    expect(term.buffer.active.getLine(1)?.translateToString(true)).toBe(
      "e\u0301中 文END",
    );
    expect(term.buffer.active.getLine(2)?.translateToString(true)).toBe("");
  } finally {
    term.dispose();
  }
});

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
