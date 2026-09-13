import { describe, expect, test } from "bun:test";
import { TerminalHistoryRange } from "./terminalHistorySelection";

const rows = (...text: string[]) =>
  text.map((line) => Array.from(line.padEnd(12)));

describe("selection across terminal history viewports", () => {
  test("copies all traversed rows, including rows outside the final viewport", () => {
    const range = new TerminalHistoryRange(
      { start: { x: 2, y: 0 }, end: { x: 5, y: 2 } },
      20,
      false,
    );
    range.capture(20, rows("A first", "second", "third"));
    range.capture(22, rows("CHANGED", "fourth", "fifth"));
    range.capture(24, rows("fifth", "sixth"));
    range.cursor = { row: 25, col: 3 };
    expect(range.text).toBe("first\nsecond\nthird\nfourth\nfifth\nsix");
    expect(range.visible(23, 3, 12)).toEqual({ row: 0, col: 0, length: 27 });
  });

  test("reverse drags and changing direction retain the original anchor", () => {
    const range = new TerminalHistoryRange(
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
      12,
      true,
    );
    range.capture(12, rows("twelve", "thirteen", "fourteen"));
    range.capture(10, rows("ten", "eleven"));
    range.cursor = { row: 10, col: 1 };
    expect(range.text).toBe("en\neleven\ntwelve\nthirteen\nfou");
    range.cursor = { row: 13, col: 2 };
    expect(range.text).toBe("irteen\nfou");
  });

  test("does not invent or silently omit skipped rows", () => {
    const range = new TerminalHistoryRange(
      { start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
      0,
      false,
    );
    range.capture(0, rows("first"));
    range.capture(2, rows("third"));
    range.cursor = { row: 2, col: 5 };
    expect(range.text).toBe("");
  });

  test("preserves blank lines and indentation without copying cell padding", () => {
    const range = new TerminalHistoryRange(
      { start: { x: 0, y: 0 }, end: { x: 0, y: 3 } },
      0,
      false,
    );
    range.capture(0, rows("  first", "", "  last", "excluded"));
    expect(range.text).toBe("  first\n\n  last");
  });

  test("wide cells, combining characters, and exclusive end coordinates", () => {
    const range = new TerminalHistoryRange(
      { start: { x: 2, y: 0 }, end: { x: 5, y: 0 } },
      0,
      false,
    );
    range.capture(0, [["A", "\u754c", "", "e\u0301", "\ud83d\ude00", "", "Z"]]);
    expect(range.text).toBe("\u754ce\u0301\ud83d\ude00");
  });
});
