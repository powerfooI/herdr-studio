import { expect, test } from "bun:test";
import { roamgateStorage } from "./browserStorage";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

test("fresh browser writes use Roamgate keys", () => {
  const raw = memoryStorage();
  const storage = roamgateStorage(raw);
  storage.setItem("theme", "dark");
  expect(raw.getItem("roamgate:theme")).toBe("dark");
  expect(raw.getItem("theme")).toBeNull();
});

test("legacy preferences, drafts and connection selections copy once; new empty values win", () => {
  for (const key of [
    "theme",
    "reviewAnnotations:resource",
    "herdr.connection/one/filePreview",
  ]) {
    const raw = memoryStorage({ [key]: "saved" });
    expect(roamgateStorage(raw).getItem(key)).toBe("saved");
    expect(raw.getItem(`roamgate:${key}`)).toBe("saved");
    raw.setItem(key, "stale");
    expect(roamgateStorage(raw).getItem(key)).toBe("saved");
    raw.setItem(`roamgate:${key}`, "");
    expect(roamgateStorage(raw).getItem(key)).toBe("");
    expect(raw.getItem(key)).toBe("stale");
  }
});

test("clearing migrated values does not resurrect originals on reload", () => {
  const raw = memoryStorage({ theme: "dark" });
  const storage = roamgateStorage(raw);
  expect(storage.getItem("theme")).toBe("dark");
  storage.removeItem("theme");
  expect(roamgateStorage(raw).getItem("theme")).toBeNull();
  expect(raw.getItem("theme")).toBe("dark");
  storage.setItem("theme", "light");
  expect(storage.getItem("theme")).toBe("light");
});

test("failed migration reads saved values and can retry", () => {
  const raw = memoryStorage({ theme: "dark" });
  const setItem = raw.setItem;
  raw.setItem = () => {
    throw new Error("quota exceeded");
  };
  expect(roamgateStorage(raw).getItem("theme")).toBe("dark");
  raw.setItem = setItem;
  expect(roamgateStorage(raw).getItem("theme")).toBe("dark");
  expect(raw.getItem("roamgate:theme")).toBe("dark");
});

test("enumeration keeps legacy connection migration working without duplicate keys", () => {
  const raw = memoryStorage({
    "diffViewerSelected:one": "saved",
    "roamgate:diffViewerSelected:one": "new",
  });
  const storage = roamgateStorage(raw);
  expect(storage.length).toBe(1);
  expect(storage.key(0)).toBe("diffViewerSelected:one");
  storage.clear();
  expect(storage.getItem("diffViewerSelected:one")).toBeNull();
  expect(raw.getItem("diffViewerSelected:one")).toBe("saved");
});
