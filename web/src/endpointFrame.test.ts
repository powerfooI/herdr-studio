import { expect, test } from "bun:test";
import { Terminal } from "@xterm/xterm";
import { frameToAnsi } from "../../server/src/bridge/frame-to-ansi";
import type { FrameData } from "../../server/src/bridge/thin-client";

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
