import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { importWithReload } from "./lazyWithReload";

const RELOAD_ATTEMPTED_KEY = "herdr:lazy-chunk-reload";

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
  const module = await importWithReload(() => Promise.resolve({ ok: true }));
  expect(module).toEqual({ ok: true });
  expect(storage.has(RELOAD_ATTEMPTED_KEY)).toBe(false);
  expect(reloadCount).toBe(0);
});

test("reloads once when the import fails, then throws on a retry", async () => {
  const failure = () => Promise.reject(new Error("chunk 404"));
  const pending = importWithReload(failure);
  await Promise.resolve();
  expect(reloadCount).toBe(1);
  // The first attempt stays pending forever while the page unloads.
  await expect(
    Promise.race([pending, Promise.resolve("settled")]),
  ).resolves.toBe("settled");
  await expect(importWithReload(failure)).rejects.toThrow("chunk 404");
  expect(reloadCount).toBe(1);
});
