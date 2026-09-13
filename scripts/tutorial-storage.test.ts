import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../site/tutorial.js", import.meta.url),
  "utf8",
);
const legacyKey = "herdr-studio-tutorial-checklist-v1";
const currentKey = "roamgate-tutorial-checklist-v1";

function render(values: Map<string, string>, failWrite = false) {
  const check = {
    checked: false,
    disabled: true,
    closest: () => null,
    addEventListener: () => undefined,
  };
  const article = {
    querySelectorAll: (selector: string) =>
      selector === 'input[type="checkbox"]' ? [check] : [],
  };
  runInNewContext(source, {
    document: {
      querySelector: (selector: string) =>
        selector === ".tutorial-prose" ? article : null,
      querySelectorAll: () => [],
    },
    window: { addEventListener: () => undefined },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrite) throw new Error("quota");
        values.set(key, value);
      },
    },
  });
  return check.checked;
}

test("tutorial copies legacy progress once and preserves the original", () => {
  const values = new Map([[legacyKey, "[true]"]]);
  expect(render(values)).toBeTrue();
  expect(values.get(currentKey)).toBe("[true]");
  values.set(currentKey, "[false]");
  expect(render(values)).toBeFalse();
  expect(values.get(legacyKey)).toBe("[true]");
});

test("tutorial reads legacy progress despite write failure and retries later", () => {
  const values = new Map([[legacyKey, "[true]"]]);
  expect(render(values, true)).toBeTrue();
  expect(values.has(currentKey)).toBeFalse();
  expect(render(values)).toBeTrue();
  expect(values.get(currentKey)).toBe("[true]");
});
