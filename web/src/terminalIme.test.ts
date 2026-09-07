import { describe, expect, test } from "bun:test";
import {
  isTerminalImeCommittedInputType,
  TerminalImeCommitGuard,
  terminalImeEventTime,
  terminalImeFallbackText,
  TerminalImeFallbackTracker,
  TerminalImeKeyEventTracker,
  TerminalImeTextareaFallbackTracker,
  terminalImeTextareaDelta,
} from "./terminalIme";

function inputEvent(
  data: string,
  overrides: Partial<Parameters<typeof terminalImeFallbackText>[0]> = {},
): Parameters<typeof terminalImeFallbackText>[0] {
  return {
    data,
    inputType: "insertText",
    isComposing: false,
    ...overrides,
  };
}

describe("terminal IME punctuation detection", () => {
  test("accepts common full-width punctuation", () => {
    for (const text of [
      "，",
      "。",
      "？",
      "！",
      "：",
      "；",
      "（）",
      "“”",
      "、",
      "～",
      "￥",
    ]) {
      expect(terminalImeFallbackText(inputEvent(text))).toBe(text);
    }
  });

  test("leaves text, ASCII keys, paste, and active composition to xterm", () => {
    expect(terminalImeFallbackText(inputEvent("中文"))).toBeNull();
    expect(terminalImeFallbackText(inputEvent(","))).toBeNull();
    expect(
      terminalImeFallbackText(inputEvent("，", { isComposing: true })),
    ).toBeNull();
    expect(
      terminalImeFallbackText(
        inputEvent("，", { inputType: "insertFromPaste" }),
      ),
    ).toBeNull();
  });

  test("uses comparable DOM timestamps and rejects legacy epoch timestamps", () => {
    expect(terminalImeEventTime({ timeStamp: 95 }, 100)).toBe(95);
    expect(terminalImeEventTime({ timeStamp: 1_800_000_000_000 }, 100)).toBe(
      100,
    );
  });
});

describe("terminal IME key-event deduplication", () => {
  test("does not replay uppercase text xterm emitted from keypress", () => {
    const tracker = new TerminalImeKeyEventTracker();
    tracker.begin();
    tracker.recordXtermData("A");

    expect(tracker.consumeInput({ data: "A", inputType: "insertText" })).toBe(
      true,
    );
    expect(tracker.consumeInput({ data: "A", inputType: "insertText" })).toBe(
      false,
    );
  });

  test("keeps missing and composition-update input eligible for recovery", () => {
    const tracker = new TerminalImeKeyEventTracker();
    tracker.begin();
    expect(tracker.consumeInput({ data: "中", inputType: "insertText" })).toBe(
      false,
    );

    tracker.begin();
    tracker.recordXtermData("，");
    expect(
      tracker.consumeInput({
        data: "，",
        inputType: "insertCompositionText",
      }),
    ).toBe(false);
  });

  test("resets stale key data on a new key cycle or keyup", () => {
    const tracker = new TerminalImeKeyEventTracker();
    tracker.begin();
    tracker.recordXtermData("A");
    tracker.begin();
    tracker.recordXtermData("B");
    expect(tracker.consumeInput({ data: "B", inputType: "insertText" })).toBe(
      true,
    );

    tracker.begin();
    tracker.recordXtermData("C");
    tracker.end();
    expect(tracker.consumeInput({ data: "C", inputType: "insertText" })).toBe(
      false,
    );
  });
});

describe("terminal IME textarea fallback", () => {
  test("recognizes committed text without replaying composition updates", () => {
    expect(isTerminalImeCommittedInputType("insertText")).toBe(true);
    expect(isTerminalImeCommittedInputType("insertFromComposition")).toBe(true);
    expect(isTerminalImeCommittedInputType("insertCompositionText")).toBe(
      false,
    );
    expect(isTerminalImeCommittedInputType("insertFromPaste")).toBe(false);
    expect(isTerminalImeCommittedInputType("deleteContentBackward")).toBe(
      false,
    );
  });

  test("extracts append-only ASCII, Chinese, and emoji text", () => {
    expect(terminalImeTextareaDelta("", "hello")).toBe("hello");
    expect(terminalImeTextareaDelta("已有", "已有中文")).toBe("中文");
    expect(terminalImeTextareaDelta("a", "a😀")).toBe("😀");
  });

  test("leaves replacement and deletion changes to xterm", () => {
    expect(terminalImeTextareaDelta("same", "same")).toBeNull();
    expect(terminalImeTextareaDelta("abc", "axc")).toBeNull();
    expect(terminalImeTextareaDelta("abc", "ab")).toBeNull();
  });

  test("flushes a short-lived mutation synchronously", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("");
    expect(tracker.flush("中文输入")).toEqual({
      status: "handled",
      text: "中文输入",
    });
    expect(tracker.hasPending()).toBe(false);
  });

  test("keeps an unchanged keyup pending for the timer fallback", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("");
    expect(tracker.flush("")).toEqual({ status: "pending" });
    expect(tracker.hasPending()).toBe(true);
    expect(tracker.flush("稍后写入", true)).toEqual({
      status: "handled",
      text: "稍后写入",
    });
  });

  test("distinguishes xterm-handled input from an unhandled cycle", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("hello");
    expect(tracker.recordXtermData(" world")).toBe(" world");
    expect(tracker.flush("hello world")).toEqual({
      status: "handled",
      text: null,
    });
    expect(tracker.flush("hello world", true)).toEqual({
      status: "unhandled",
    });
  });

  test("subtracts text xterm already emitted", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("hello");
    expect(tracker.recordXtermData(" ")).toBe(" ");
    expect(tracker.flush("hello world")).toEqual({
      status: "handled",
      text: "world",
    });

    tracker.complete();
    tracker.begin("a");
    expect(tracker.recordXtermData("😀b")).toBe("😀b");
    expect(tracker.flush("a😀b")).toEqual({
      status: "handled",
      text: null,
    });
  });

  test("suppresses partial or delayed xterm output after a synchronous flush", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("");
    expect(tracker.flush("中文")).toEqual({
      status: "handled",
      text: "中文",
    });
    expect(tracker.recordXtermData("中")).toBeNull();
    expect(tracker.recordXtermData("文")).toBeNull();

    tracker.complete();
    tracker.begin("");
    expect(tracker.flush("abc")).toEqual({
      status: "handled",
      text: "abc",
    });
    expect(tracker.recordXtermData("abc-extra")).toBe("-extra");
    tracker.complete();
    expect(tracker.recordXtermData("abc")).toBe("abc");
  });

  test("cancels an abandoned cycle without clearing duplicate suppression", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("");
    tracker.cancelPending();
    expect(tracker.recordXtermData("a")).toBe("a");
    expect(tracker.flush("abc", true)).toEqual({ status: "unhandled" });

    tracker.begin("");
    expect(tracker.flush("中文")).toEqual({
      status: "handled",
      text: "中文",
    });
    tracker.cancelPending();
    expect(tracker.recordXtermData("中")).toBeNull();
  });

  test("keeps the earliest repeated baseline and supports cancel", () => {
    const tracker = new TerminalImeTextareaFallbackTracker();
    tracker.begin("");
    tracker.begin("中");
    expect(tracker.flush("中文")).toEqual({
      status: "handled",
      text: "中文",
    });

    tracker.begin("中文");
    tracker.cancel();
    expect(tracker.flush("中文输入", true)).toEqual({
      status: "unhandled",
    });
  });
});

describe("terminal IME punctuation fallback tracking", () => {
  test("consumes xterm output emitted immediately before the input listener", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordXtermData("，", 105)).toBe(true);
    expect(tracker.recordInput("，", 100, 106)).toBe(false);
  });

  test("does not consume output from the preceding keyboard event", () => {
    const tracker = new TerminalImeFallbackTracker();
    tracker.recordXtermData("，", 100);
    expect(tracker.recordInput("，", 104, 106)).toBe(true);
  });

  test("suppresses delayed xterm output after an immediate fallback", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("。", 100)).toBe(true);
    expect(tracker.recordXtermData("。", 102)).toBe(false);
  });

  test("keeps every rapid repeated input while suppressing delayed duplicates", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordInput("，", 104)).toBe(true);
    expect(tracker.recordXtermData("，", 106)).toBe(false);
    expect(tracker.recordXtermData("，", 108)).toBe(false);
  });

  test("does not let different rapid punctuation suppress each other", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordInput("。", 103)).toBe(true);
    expect(tracker.recordXtermData("。", 105)).toBe(false);
    expect(tracker.recordXtermData("，", 106)).toBe(false);
  });

  test("does not suppress unrelated xterm data after the duplicate window", () => {
    const tracker = new TerminalImeFallbackTracker();
    expect(tracker.recordInput("，", 100)).toBe(true);
    expect(tracker.recordXtermData("，", 130)).toBe(true);
  });

  test("preserves order when xterm drops or delays part of a rapid sequence", () => {
    const tracker = new TerminalImeFallbackTracker();
    const sent: string[] = [];
    const input = (
      text: string,
      eventAt: number,
      mode: "before" | "after" | "missing",
    ) => {
      if (mode === "before" && tracker.recordXtermData(text, eventAt + 1)) {
        sent.push(text);
      }
      if (tracker.recordInput(text, eventAt, eventAt + 2)) sent.push(text);
      if (mode === "after" && tracker.recordXtermData(text, eventAt + 3)) {
        sent.push(text);
      }
    };

    input("，", 100, "missing");
    input("。", 110, "before");
    input("？", 120, "after");
    input("！", 130, "missing");

    expect(sent.join("")).toBe("，。？！");
  });
});

describe("terminal IME commit duplication guard", () => {
  test("suppresses exactly one identical re-emission of the commit", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    expect(guard.filterXtermData("ni hao", 130)).toBe(false);
    expect(guard.filterXtermData("ni hao", 140)).toBe(true);
  });

  test("never arms when a canceled composition leaves no delta", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, null);
    expect(guard.filterXtermData("x", 110)).toBe(true);
    expect(guard.filterXtermData("x", 120)).toBe(true);
  });

  test("never arms when a canceled composition emits nothing", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "x");
    expect(guard.filterXtermData("x", 200)).toBe(true);
    expect(guard.filterXtermData("x", 220)).toBe(true);
  });

  test("lets a legitimately repeated commit re-arm through compositionend", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    guard.endComposition(200, "ni hao");
    expect(guard.filterXtermData("ni hao", 201)).toBe(true);
    expect(guard.filterXtermData("ni hao", 230)).toBe(false);
  });

  test("does not consume on different text or after the duplicate window", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    expect(guard.filterXtermData("ni", 120)).toBe(true);
    expect(guard.filterXtermData("ni hao", 450)).toBe(true);
    expect(guard.filterXtermData("ni hao", 460)).toBe(true);
  });

  test("disarms after a different emission inside the window", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    expect(guard.filterXtermData("other", 120)).toBe(true);
    expect(guard.filterXtermData("ni hao", 150)).toBe(true);
  });

  test("preserves the next physical key even when it repeats the commit", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "a");
    expect(guard.filterXtermData("a", 101)).toBe(true);
    // TerminalView's custom key handler runs before xterm can emit on keydown
    // (its later textarea capture listener would be too late).
    guard.beginIndependentInput();
    expect(guard.filterXtermData("a", 200)).toBe(true);
    expect(guard.filterXtermData("a", 201)).toBe(true);
  });

  test("preserves explicit paste and cancels capture before its first emission", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "a");
    // A paste can precede the asynchronous composition finalization.
    guard.beginIndependentInput();
    expect(guard.filterXtermData("a", 110)).toBe(true);
    expect(guard.filterXtermData("a", 120)).toBe(true);

    guard.endComposition(200, "a");
    expect(guard.filterXtermData("a", 201)).toBe(true);
    // Both native paste and the term.paste fallback use this boundary.
    guard.beginIndependentInput();
    expect(guard.filterXtermData("a", 210)).toBe(true);
  });

  test("new composition retires both capture and an unconsumed tombstone", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "a");
    guard.filterXtermData("a", 101);
    guard.filterXtermData("a", 130);
    guard.beginIndependentInput();
    expect(guard.consumeSuppressedDuplicate("a", 140)).toBe(false);
    expect(guard.filterXtermData("a", 141)).toBe(true);
    guard.endComposition(150, "a");
    expect(guard.filterXtermData("a", 151)).toBe(true);
    expect(guard.filterXtermData("a", 160)).toBe(false);
    guard.endComposition(170, null);
    expect(guard.consumeSuppressedDuplicate("a", 180)).toBe(false);
  });

  test("treats window edges as still inside the window", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 150)).toBe(true);
    expect(guard.filterXtermData("ni hao", 450)).toBe(false);
  });

  test("ignores emissions outside the capture window before arming", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "late");
    expect(guard.filterXtermData("late", 200)).toBe(true);
    expect(guard.filterXtermData("late", 210)).toBe(true);
  });

  test("tombstones a suppressed duplicate for the recovery funnels", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    expect(guard.filterXtermData("ni hao", 130)).toBe(false);
    expect(guard.consumeSuppressedDuplicate("ni", 140)).toBe(false);
    expect(guard.consumeSuppressedDuplicate("ni hao", 140)).toBe(true);
    expect(guard.consumeSuppressedDuplicate("ni hao", 150)).toBe(false);
  });

  test.each([true, false])(
    "scopes duplicate recovery to one input cycle (beforeinput=%s)",
    (hasBeforeInput) => {
      const guard = new TerminalImeCommitGuard();
      const textarea = new TerminalImeTextareaFallbackTracker();
      const sent: string[] = [];
      // Match TerminalView.onData: record the textarea emission first, even
      // when the commit guard subsequently suppresses it.
      const onData = (text: string, at: number) => {
        const remaining = textarea.recordXtermData(text);
        if (remaining && guard.filterXtermData(remaining, at)) {
          sent.push(remaining);
        }
      };
      const flush = (value: string, at: number) => {
        const result = textarea.flush(value);
        if (result.status === "handled") {
          if (
            result.text &&
            !guard.consumeSuppressedDuplicate(result.text, at)
          ) {
            sent.push(result.text);
          }
          // TerminalView retires the tombstone even for handled/null.
          guard.completeRecoveryCycle();
        }
        return result;
      };

      guard.endComposition(100, "a");
      onData("a", 101);
      if (hasBeforeInput) {
        guard.completeRecoveryCycle();
        textarea.begin("a");
      }
      // Locked xterm's input capture listener emits before our input listener.
      onData("a", 130);
      textarea.begin("a"); // input-only Safari recovery preserves the baseline
      expect(flush("aa", 131)).toEqual({
        status: "handled",
        text: hasBeforeInput ? null : "a",
      });
      expect(sent).toEqual(["a"]);
      expect(guard.consumeSuppressedDuplicate("a", 132)).toBe(false);
      textarea.complete(); // final timer
      guard.completeRecoveryCycle();

      // Independent textarea-only input must survive without a physical key.
      guard.completeRecoveryCycle(); // next beforeinput
      textarea.begin("aa");
      expect(flush("aaa", 200)).toEqual({ status: "handled", text: "a" });
      expect(sent).toEqual(["a", "a"]);
    },
  );

  test("a new beforeinput retires recovery without disabling OS replay suppression", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "a");
    guard.filterXtermData("a", 101);
    guard.completeRecoveryCycle(); // duplicate's beforeinput
    expect(guard.filterXtermData("a", 130)).toBe(false);
    guard.completeRecoveryCycle(); // next beforeinput, before any final timer
    expect(guard.consumeSuppressedDuplicate("a", 140)).toBe(false);
  });

  test("final recovery cleanup retires an unused tombstone", () => {
    const guard = new TerminalImeCommitGuard();
    const textarea = new TerminalImeTextareaFallbackTracker();
    guard.endComposition(100, "a");
    guard.filterXtermData("a", 101);
    guard.filterXtermData("a", 130);
    textarea.begin("a");
    expect(textarea.flush("a")).toEqual({ status: "pending" });
    expect(textarea.flush("a", true)).toEqual({ status: "unhandled" });
    textarea.complete();
    guard.completeRecoveryCycle();
    expect(guard.consumeSuppressedDuplicate("a", 140)).toBe(false);
  });

  test("lets the tombstone expire", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    guard.filterXtermData("ni hao", 101);
    guard.filterXtermData("ni hao", 130);
    expect(guard.consumeSuppressedDuplicate("ni hao", 500)).toBe(false);
  });

  test("dispose clears any armed duplicate suppression", () => {
    const guard = new TerminalImeCommitGuard();
    guard.endComposition(100, "ni hao");
    expect(guard.filterXtermData("ni hao", 101)).toBe(true);
    guard.filterXtermData("ni hao", 110);
    guard.dispose();
    expect(guard.filterXtermData("ni hao", 120)).toBe(true);
    expect(guard.consumeSuppressedDuplicate("ni hao", 120)).toBe(false);
  });
});
