import { describe, expect, test } from "bun:test";
import {
  TERMINAL_COPY_RECENT_LINES,
  terminalCopyRecentRequest,
  terminalCopyRecentText,
} from "./terminalCopyRecent";

describe("terminalCopyRecentRequest", () => {
  test("reads recent unwrapped text for the pane", () => {
    expect(terminalCopyRecentRequest("w1:p1")).toEqual({
      method: "pane.read",
      params: {
        pane_id: "w1:p1",
        source: "recent_unwrapped",
        format: "text",
        lines: TERMINAL_COPY_RECENT_LINES,
      },
    });
  });

  test("accepts an explicit line count", () => {
    expect(terminalCopyRecentRequest("w1:p1", 50).params.lines).toBe(50);
  });
});

describe("terminalCopyRecentText", () => {
  test("returns the text from a pane_read envelope", () => {
    const result = {
      type: "pane_read",
      read: {
        pane_id: "w1:p1",
        workspace_id: "ws1",
        tab_id: "t1",
        source: "recent_unwrapped",
        format: "text",
        text: "joined\nlines\n",
        revision: 0,
        truncated: false,
      },
    };
    expect(terminalCopyRecentText(result)).toBe("joined\nlines\n");
  });

  test("accepts an empty terminal payload", () => {
    expect(
      terminalCopyRecentText({ type: "pane_read", read: { text: "" } }),
    ).toBe("");
  });

  test("rejects malformed responses", () => {
    expect(terminalCopyRecentText(null)).toBeNull();
    expect(terminalCopyRecentText(undefined)).toBeNull();
    expect(terminalCopyRecentText("pane_read")).toBeNull();
    expect(terminalCopyRecentText([])).toBeNull();
    expect(terminalCopyRecentText({ type: "pane_list", panes: [] })).toBeNull();
    expect(terminalCopyRecentText({ type: "pane_read" })).toBeNull();
    expect(
      terminalCopyRecentText({ type: "pane_read", read: null }),
    ).toBeNull();
    expect(terminalCopyRecentText({ type: "pane_read", read: [] })).toBeNull();
    expect(
      terminalCopyRecentText({ type: "pane_read", read: { text: 42 } }),
    ).toBeNull();
  });
});
