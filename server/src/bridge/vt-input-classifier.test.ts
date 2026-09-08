import { describe, expect, test } from "bun:test";
import { BinReader } from "./bincode";
import {
  KEY,
  MOD_ALT,
  MOD_CONTROL,
  MOD_SHIFT,
  type PaneInputEvent,
  VtInputClassifier,
  encodePaneInput,
} from "./vt-input-classifier";

function feed(input: string | number[]): PaneInputEvent[] {
  const c = new VtInputClassifier();
  return c.feed(
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input),
  );
}

describe("VtInputClassifier", () => {
  test("printable text becomes one TextCommit", () => {
    expect(feed("hello 世界")).toEqual([{ type: "text", text: "hello 世界" }]);
  });

  test("enter, backspace, tab, escape keys", () => {
    expect(feed("\r")).toEqual([
      {
        type: "key",
        code: KEY.Enter,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
    expect(feed([0x7f])).toEqual([
      {
        type: "key",
        code: KEY.Backspace,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
    expect(feed("\t")).toEqual([
      {
        type: "key",
        code: KEY.Tab,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
    const c = new VtInputClassifier();
    expect(c.feed(Buffer.from([0x1b]))).toEqual([]);
    expect(c.flush()).toEqual([
      {
        type: "key",
        code: KEY.Esc,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
  });

  test("ctrl+letter maps to Char with CONTROL", () => {
    expect(feed([0x03])).toEqual([
      {
        type: "key",
        code: KEY.Char,
        char: 0x63,
        fn: undefined,
        modifiers: MOD_CONTROL,
        generatedText: undefined,
      },
    ]);
  });

  test("arrows and modified arrows", () => {
    expect(feed("\x1b[A")).toEqual([
      {
        type: "key",
        code: KEY.Up,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
    expect(feed("\x1b[1;5D")).toEqual([
      {
        type: "key",
        code: KEY.Left,
        char: undefined,
        fn: undefined,
        modifiers: MOD_CONTROL,
        generatedText: undefined,
      },
    ]);
    expect(feed("\x1b[1;2C")).toEqual([
      {
        type: "key",
        code: KEY.Right,
        char: undefined,
        fn: undefined,
        modifiers: MOD_SHIFT,
        generatedText: undefined,
      },
    ]);
  });

  test("tilde keys: delete, home, end, page up/down", () => {
    const codeAt = (input: string) => {
      const e = feed(input)[0];
      return e.type === "key" ? e.code : null;
    };
    expect(codeAt("\x1b[3~")).toBe(KEY.Delete);
    expect(codeAt("\x1b[1~")).toBe(KEY.Home);
    expect(codeAt("\x1b[4~")).toBe(KEY.End);
    expect(codeAt("\x1b[5~")).toBe(KEY.PageUp);
    expect(codeAt("\x1b[6~")).toBe(KEY.PageDown);
  });

  test("function keys via SS3 and tilde", () => {
    expect(feed("\x1bOP")[0]).toMatchObject({ code: KEY.F, fn: 1 });
    expect(feed("\x1bOQ")[0]).toMatchObject({ code: KEY.F, fn: 2 });
    expect(feed("\x1b[15~")[0]).toMatchObject({ code: KEY.F, fn: 5 });
    expect(feed("\x1b[24~")[0]).toMatchObject({ code: KEY.F, fn: 12 });
  });

  test("alt+char", () => {
    expect(feed("\x1bx")).toEqual([
      {
        type: "key",
        code: KEY.Char,
        char: 0x78,
        fn: undefined,
        modifiers: MOD_ALT,
        generatedText: undefined,
      },
    ]);
  });

  test("bracketed paste becomes one Paste event", () => {
    expect(feed("\x1b[200~pasted\r\ntext\x1b[201~")).toEqual([
      { type: "paste", text: "pasted\r\ntext" },
    ]);
  });

  test("mixed text and keys keep order", () => {
    const events = feed("ab\x1b[Acd");
    expect(events.map((e) => e.type)).toEqual(["text", "key", "text"]);
    expect(events[0]).toMatchObject({ text: "ab" });
    expect(events[2]).toMatchObject({ text: "cd" });
  });

  test("split sequences wait for completion", () => {
    const c = new VtInputClassifier();
    expect(c.feed(Buffer.from("\x1b["))).toEqual([]);
    expect(c.feed(Buffer.from("3~"))).toEqual([
      {
        type: "key",
        code: KEY.Delete,
        char: undefined,
        fn: undefined,
        modifiers: 0,
        generatedText: undefined,
      },
    ]);
  });

  test("split UTF-8 chars wait for completion", () => {
    const c = new VtInputClassifier();
    const bytes = Buffer.from("世", "utf8");
    expect(c.feed(bytes.subarray(0, 1))).toEqual([]);
    expect(c.feed(bytes.subarray(1))).toEqual([{ type: "text", text: "世" }]);
  });

  test("double ESC yields Esc then reprocesses", () => {
    const events = feed("\x1b\x1b[A");
    expect(events.map((e) => (e.type === "key" ? e.code : e.type))).toEqual([
      KEY.Esc,
      KEY.Up,
    ]);
  });
});

describe("encodePaneInput", () => {
  test("encodes the ClientShellPaneInput frame", () => {
    const buf = encodePaneInput("w1:p1", [
      { type: "text", text: "hi" },
      { type: "key", code: KEY.Enter, modifiers: 0 },
      { type: "paste", text: "p" },
      { type: "key", code: KEY.Char, char: 0x63, modifiers: MOD_CONTROL },
      { type: "key", code: KEY.F, fn: 5, modifiers: MOD_SHIFT },
    ]);
    const r = new BinReader(buf);
    expect(r.variant()).toBe(13); // ClientShellPaneInput
    expect(r.string()).toBe("w1:p1");
    expect(r.varint()).toBe(5);

    expect(r.variant()).toBe(1); // TextCommit
    expect(r.string()).toBe("hi");

    expect(r.variant()).toBe(0); // Key
    expect(r.variant()).toBe(KEY.Enter);
    expect(r.u8()).toBe(0); // modifiers
    expect(r.variant()).toBe(0); // Press
    expect(r.varint()).toBe(1); // repeat_count
    expect(r.bool()).toBe(false); // shifted_codepoint
    expect(r.bool()).toBe(false); // generated_text
    expect(r.bool()).toBe(false); // tracks_release
    expect(r.bool()).toBe(false); // physical_key_id
    expect(r.bool()).toBe(false); // windows_record

    expect(r.variant()).toBe(3); // Paste
    expect(r.string()).toBe("p");

    expect(r.variant()).toBe(0); // Key Char
    expect(r.variant()).toBe(KEY.Char);
    expect(r.varint()).toBe(0x63);
    expect(r.u8()).toBe(MOD_CONTROL);
    expect(r.variant()).toBe(0); // Press
    expect(r.varint()).toBe(1);
    expect(r.bool()).toBe(false);
    expect(r.bool()).toBe(false);
    expect(r.bool()).toBe(false);
    expect(r.bool()).toBe(false);
    expect(r.bool()).toBe(false);

    expect(r.variant()).toBe(0); // Key F
    expect(r.variant()).toBe(KEY.F);
    expect(r.varint()).toBe(5);
    expect(r.u8()).toBe(MOD_SHIFT);
  });
});
