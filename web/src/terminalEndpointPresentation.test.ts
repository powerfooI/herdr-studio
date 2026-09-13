import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/xterm";
import {
  TerminalEndpointPresentation,
  terminalMouseUsesSelection,
} from "./terminalEndpointPresentation";

describe("endpoint selection presentation", () => {
  test.each([false, true])(
    "drops oversized frames after resize, including selection-held frames (%s)",
    (held) => {
      let selected = held;
      let viewport = { cols: held ? 11 : 10, rows: held ? 4 : 3 };
      const writes: string[] = [];
      const presentation = new TerminalEndpointPresentation(
        () => selected,
        (text, parsed) => {
          writes.push(text);
          parsed();
        },
        () => viewport,
      );
      presentation.update("oversized", true, { cols: 11, rows: 4 });
      viewport = { cols: 10, rows: 3 };
      selected = false;
      presentation.flush();
      expect(writes.every((text) => !text.includes("oversized"))).toBe(true);
      presentation.update("clipped", true, viewport);
      expect(writes.join("")).toContain("\x1b[?1006h\x1b[?1002h");
      expect(writes[writes.length - 1]).toContain("clipped");
    },
  );

  test("selection cannot begin while an endpoint frame is still queued for parsing", async () => {
    let selected = false;
    let visible = "A";
    let drain: (() => void) | undefined;
    const presentation = new TerminalEndpointPresentation(
      () => selected,
      (text, parsed) => {
        drain = () => {
          visible = text;
          parsed();
        };
      },
    );
    presentation.update("B", true);
    let copied = "";
    expect(
      presentation.beginSelection(() => {
        selected = true;
        copied = visible;
      }),
    ).toBe(false);
    presentation.update("C", false);
    presentation.update("D", true);
    expect(selected).toBe(false); // native selection has not begun on A
    expect(visible).toBe("A");
    await Promise.resolve();
    drain!();
    expect(selected).toBe(true);
    expect(copied).toBe("\x1b[?1006h\x1b[?1002hB");
    presentation.flush();
    expect(visible).toBe(copied);
    selected = false;
    presentation.selectionDrag = false;
    presentation.flush();
    drain!();
    expect(visible).toBe("D");
  });
  test("coalesces full output during selection and applies only newest mode/frame on clear", () => {
    let selected = false;
    let visible = "";
    const writes: string[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => selected,
      (text, parsed) => {
        visible = text;
        writes.push(text);
        parsed();
      },
    );
    presentation.update("original selected text", false);
    selected = true;
    const copiedText = visible;
    presentation.update("new output", true);
    presentation.update("newest output", false);
    presentation.update("latest output", true);
    expect(presentation.mouseReporting).toBe(true); // metadata is immediate
    expect(visible).toBe(copiedText); // copy still sees precisely the selected output
    expect(writes).toHaveLength(1);
    selected = false;
    presentation.flush();
    expect(writes).toHaveLength(2);
    expect(visible).toBe("\x1b[?1006h\x1b[?1002hlatest output");
    presentation.flush();
    expect(writes).toHaveLength(2);
    presentation.update("next output", true);
    expect(visible).toBe("next output"); // do not reassert modes and clear selection
  });

  test("selection drag pauses before a range exists; application drag does not", () => {
    const writes: string[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (text, parsed) => {
        writes.push(text);
        parsed();
      },
    );
    presentation.selectionDrag = true;
    presentation.update("first", false);
    presentation.update("last", false);
    expect(writes).toEqual([]);
    presentation.selectionDrag = false; // mouseup/lost release/window blur
    presentation.flush();
    expect(writes).toEqual(["\x1b[?1002l\x1b[?1006llast"]);
    presentation.update("app output", true);
    expect(writes[writes.length - 1]).toContain("app output");
  });

  test("reset drops pending output, mode and drag across pane/session changes or teardown", () => {
    const writes: string[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (text, parsed) => {
        writes.push(text);
        parsed();
      },
    );
    presentation.selectionDrag = true;
    presentation.update("old pane", true);
    presentation.reset();
    presentation.flush();
    expect(writes).toEqual([]);
    expect(presentation.mouseReporting).toBeUndefined();
    expect(presentation.selectionDrag).toBe(false);
    presentation.update("new pane", false);
    expect(writes).toEqual(["\x1b[?1002l\x1b[?1006lnew pane"]);
  });

  test.each(["reset", "blur"])(
    "%s cancels deferred initiation and late callbacks cannot replay it",
    async (reason) => {
      let drain!: () => void;
      let replayed = 0;
      const presentation = new TerminalEndpointPresentation(
        () => false,
        (_text, parsed) => {
          drain = parsed;
        },
      );
      presentation.update("old", true);
      expect(
        presentation.beginSelection(() => {
          replayed++;
        }),
      ).toBe(false);
      if (reason === "reset") presentation.reset();
      else presentation.cancelSelection();
      await Promise.resolve();
      drain();
      expect(replayed).toBe(0);
      expect(presentation.selectionPending).toBe(false);
      expect(presentation.selectionDrag).toBe(false);
    },
  );

  test.each([false, true])(
    "reset retains the physical write gate for a new selection (reporting=%s)",
    async (reporting) => {
      const terminal = new Terminal({
        allowProposedApi: true,
        cols: 10,
        rows: 3,
      });
      let selected = false;
      let copied = "";
      const presentation = new TerminalEndpointPresentation(
        () => selected,
        (text, parsed) => terminal.write(text, parsed),
      );
      try {
        await new Promise<void>((resolve) => terminal.write("A", resolve));
        presentation.update("\x1b[HB", reporting);
        presentation.reset(); // same xterm is retained on close/reconnect
        expect(presentation.mouseReporting).toBeUndefined();
        expect(
          presentation.beginSelection(() => {
            selected = true;
            copied = terminal.buffer.active.getLine(0)!.translateToString(true);
          }),
        ).toBe(false);
        await Bun.sleep(30);
        expect(copied).toBe("B");
        expect(selected).toBe(true);
        presentation.update("\x1b[HC", false);
        await Bun.sleep(30);
        expect(terminal.buffer.active.getLine(0)!.translateToString(true)).toBe(
          "B",
        );
      } finally {
        presentation.reset();
        terminal.dispose();
      }
    },
  );

  test("reset cannot submit a second physical write before the first callback", () => {
    const callbacks: Array<() => void> = [];
    const writes: string[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (text, parsed) => {
        writes.push(text);
        callbacks.push(parsed);
      },
    );
    presentation.update("B", true);
    presentation.reset();
    presentation.update("C", false);
    expect(writes).toHaveLength(1);
    callbacks[0]();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("C");
    callbacks[1]();
  });

  test("disposal prevents a late physical completion from reviving writes or replay", () => {
    const callbacks: Array<() => void> = [];
    const writes: string[] = [];
    let replayed = false;
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (text, parsed) => {
        writes.push(text);
        callbacks.push(parsed);
      },
    );
    presentation.update("B", true);
    presentation.reset();
    expect(presentation.writePending).toBe(true);
    expect(
      presentation.beginSelection(() => {
        replayed = true;
      }),
    ).toBe(false);
    presentation.update("C", false);
    presentation.dispose();
    callbacks[0]();
    presentation.update("D", true);
    presentation.flush();
    expect(replayed).toBe(false);
    expect(writes).toHaveLength(1);
    expect(presentation.selectionPending).toBe(false);
    expect(presentation.mouseReporting).toBeUndefined();
  });

  test("native selection escape is platform-correct; ordinary/legacy output stays selectable", () => {
    const plain = { shiftKey: false, altKey: false };
    for (const apple of [false, true]) {
      expect(terminalMouseUsesSelection(false, plain, apple)).toBe(true);
      expect(terminalMouseUsesSelection(undefined, plain, apple)).toBe(true);
      expect(terminalMouseUsesSelection(true, plain, apple)).toBe(false);
      expect(
        terminalMouseUsesSelection(true, { ...plain, shiftKey: true }, apple),
      ).toBe(!apple);
      expect(
        terminalMouseUsesSelection(true, { ...plain, altKey: true }, apple),
      ).toBe(apple);
    }
  });

  test("selection initiation awaits the real xterm parser before later output is retained", async () => {
    const terminal = new Terminal({
      allowProposedApi: true,
      cols: 10,
      rows: 3,
    });
    let selected = false;
    let copied = "";
    const presentation = new TerminalEndpointPresentation(
      () => selected,
      (text, parsed) => terminal.write(text, parsed),
    );
    try {
      await new Promise<void>((resolve) => terminal.write("A", resolve));
      presentation.update("\x1b[HB", true);
      expect(
        presentation.beginSelection(() => {
          selected = true;
          copied = terminal.buffer.active.getLine(0)!.translateToString(true);
        }),
      ).toBe(false);
      expect(selected).toBe(false);
      await Bun.sleep(30);
      expect(copied).toBe("B");
      expect(terminal.modes.mouseTrackingMode).toBe("drag");
      presentation.update("\x1b[HC", false);
      await Bun.sleep(30);
      expect(terminal.buffer.active.getLine(0)!.translateToString(true)).toBe(
        "B",
      );
      selected = false;
      presentation.selectionDrag = false;
      presentation.flush();
      await Bun.sleep(30);
      expect(terminal.buffer.active.getLine(0)!.translateToString(true)).toBe(
        "C",
      );
      expect(terminal.modes.mouseTrackingMode).toBe("none");
    } finally {
      presentation.reset();
      terminal.dispose();
    }
  });

  test("the pinned xterm negotiates cell drag reports and returns to selection mode", async () => {
    const terminal = new Terminal({
      allowProposedApi: true,
      cols: 10,
      rows: 3,
    });
    const writes: Promise<void>[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (text, parsed) => {
        writes.push(
          new Promise<void>((resolve) =>
            terminal.write(text, () => {
              parsed();
              resolve();
            }),
          ),
        );
      },
    );
    try {
      presentation.update("hello", true);
      await Promise.all(writes);
      expect(terminal.modes.mouseTrackingMode).toBe("drag");
      presentation.update("hello", false);
      await Promise.all(writes);
      expect(terminal.modes.mouseTrackingMode).toBe("none");
    } finally {
      terminal.dispose();
    }
  });
});

describe("endpoint history selection repaints", () => {
  test("admits requested history frames, restores highlighting after parsing, and freezes output", () => {
    let selecting = false;
    let allow = false;
    const writes: string[] = [];
    const shown: number[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => selecting,
      (text, parsed) => {
        writes.push(text);
        parsed();
      },
      () => ({ cols: 10, rows: 3 }),
      {
        accepts: (frame) => allow && frame.history?.revision === 2,
        presented: (frame) => {
          if (selecting) shown.push(frame.history!.top);
          allow = false;
        },
        reset: () => {},
      },
    );
    const history = { revision: 2, top: 0, total: 30, cols: 10, rows: 3 };
    presentation.update("initial", false, { cols: 10, rows: 3 }, history);
    selecting = true;
    presentation.selectionDrag = true;
    presentation.update(
      "unsolicited",
      false,
      { cols: 10, rows: 3 },
      { ...history, top: 2 },
    );
    expect(writes).toHaveLength(1);
    allow = true;
    presentation.flush();
    expect(shown).toEqual([2]);
    expect(presentation.displayedFrame?.history?.top).toBe(2);
    presentation.update(
      "new output",
      false,
      { cols: 10, rows: 3 },
      { ...history, revision: 4 },
    );
    expect(writes).toHaveLength(2);
    selecting = false;
    presentation.selectionDrag = false;
    presentation.flush();
    expect(writes[writes.length - 1]).toBe("new output");
  });

  test("reset during parsing cannot restore stale history coordinates", () => {
    let parsed!: () => void;
    const shown: unknown[] = [];
    const presentation = new TerminalEndpointPresentation(
      () => false,
      (_text, done) => {
        parsed = done;
      },
      undefined,
      {
        accepts: () => false,
        presented: (frame) => shown.push(frame),
        reset: () => {},
      },
    );
    presentation.update(
      "old terminal",
      false,
      { cols: 10, rows: 3 },
      { revision: 2, top: 10, total: 30, cols: 10, rows: 3 },
    );
    presentation.reset();
    parsed();
    expect(presentation.displayedFrame).toBeNull();
    expect(shown).toEqual([]);
  });
});
