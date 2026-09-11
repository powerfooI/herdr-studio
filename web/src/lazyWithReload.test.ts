import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { importWithReload } from "./lazyWithReload";

const COMPONENT_KEY = "diff-content-view";
const RELOAD_ATTEMPTED_KEY = `herdr:lazy-chunk-reload:${COMPONENT_KEY}`;

let storage: Map<string, string>;
let reloadCount = 0;

beforeEach(() => {
  storage = new Map();
  reloadCount = 0;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload: mock(() => void (reloadCount += 1)) } },
  });
});

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { window?: unknown }).window;
});

test("returns the module and clears the reload marker on success", async () => {
  storage.set(RELOAD_ATTEMPTED_KEY, "1");
  storage.set("herdr:lazy-chunk-reload:terminal-view", "1");
  const module = await importWithReload(COMPONENT_KEY, () =>
    Promise.resolve({ ok: true }),
  );
  expect(module).toEqual({ ok: true });
  expect(storage.has(RELOAD_ATTEMPTED_KEY)).toBe(false);
  expect(storage.get("herdr:lazy-chunk-reload:terminal-view")).toBe("1");
  expect(reloadCount).toBe(0);
});

test("reloads once when the import fails, then throws on a retry", async () => {
  const failure = () => Promise.reject(new Error("chunk 404"));
  const pending = importWithReload(COMPONENT_KEY, failure);
  await Promise.resolve();
  expect(reloadCount).toBe(1);
  // The first attempt stays pending forever while the page unloads.
  await expect(
    Promise.race([pending, Promise.resolve("settled")]),
  ).resolves.toBe("settled");
  await expect(importWithReload(COMPONENT_KEY, failure)).rejects.toThrow(
    "chunk 404",
  );
  expect(reloadCount).toBe(1);
});

test("a successful terminal import does not reset a failing diff's reload guard", async () => {
  const error = new Error("diff chunk 404");
  const failure = () => Promise.reject(error);
  void importWithReload(COMPONENT_KEY, failure);
  await Promise.resolve();
  expect(reloadCount).toBe(1);

  // TerminalView loads first after a reload; Changes is then opened again.
  for (let retry = 0; retry < 2; retry++) {
    await importWithReload("terminal-view", () =>
      Promise.resolve({ ok: true }),
    );
    expect(storage.get(RELOAD_ATTEMPTED_KEY)).toBe("1");
    await expect(importWithReload(COMPONENT_KEY, failure)).rejects.toBe(error);
  }
  expect(reloadCount).toBe(1);
});

test("each lazy component has its own reload attempt", async () => {
  const error = new Error("chunk 404");
  const failure = () => Promise.reject(error);
  for (const key of [COMPONENT_KEY, "terminal-view"]) {
    void importWithReload(key, failure);
    await Promise.resolve();
  }
  expect(reloadCount).toBe(2);
  for (const key of [COMPONENT_KEY, "terminal-view"]) {
    await expect(importWithReload(key, failure)).rejects.toBe(error);
  }
  expect(reloadCount).toBe(2);
});
