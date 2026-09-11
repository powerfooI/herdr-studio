import { describe, expect, test } from "bun:test";
import { focusIfUnchanged } from "./dialogFocus";

function fixture() {
  const source = { isConnected: true } as Element;
  const body = {} as HTMLElement;
  const document = { activeElement: source, body };
  let focused = 0;
  const target = {
    ownerDocument: document,
    focus: () => {
      focused += 1;
      document.activeElement = target;
    },
  } as unknown as HTMLElement;
  return { source, body, document, target, count: () => focused };
}

describe("deferred Inspector focus", () => {
  test("waits for the lazy target, then focuses it without repeating", () => {
    const f = fixture();
    expect(focusIfUnchanged(null, f.source)).toBe(false);
    expect(f.count()).toBe(0);
    expect(focusIfUnchanged(f.target, f.source)).toBe(true);
    expect(f.document.activeElement).toBe(f.target);
    expect(focusIfUnchanged(f.target, f.source)).toBe(true);
    expect(f.count()).toBe(1);
  });

  test("consumes the request without stealing focus from another control", () => {
    const f = fixture();
    f.document.activeElement = {} as Element;
    expect(focusIfUnchanged(f.target, f.source)).toBe(true);
    expect(f.count()).toBe(0);
  });

  test("allows a removed menu opener to fall back to body, but not a user-focused control", () => {
    const f = fixture();
    const removed = { isConnected: false } as Element;
    f.document.activeElement = {} as Element;
    expect(focusIfUnchanged(f.target, removed)).toBe(true);
    expect(f.count()).toBe(0);
    f.document.activeElement = f.body;
    expect(focusIfUnchanged(f.target, removed)).toBe(true);
    expect(f.count()).toBe(1);
  });
});
