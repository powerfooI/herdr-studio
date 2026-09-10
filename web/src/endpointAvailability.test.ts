import { expect, test } from "bun:test";
import {
  endpointMethodReason,
  parseEndpointAdvertisement,
  parseEndpointAvailability,
} from "./endpointAvailability";

test("unknown/loading is distinct from a known empty advertisement", () => {
  expect(endpointMethodReason("browser-local", null, "tab.create")).toContain(
    "loading",
  );
  const empty = parseEndpointAdvertisement({ methods: [], capabilities: [] });
  expect(empty).toEqual({ methods: [], capabilities: [] });
  expect(endpointMethodReason("browser-local", empty, "tab.create")).toBe(
    "Herdr endpoint does not advertise tab.create",
  );
  expect(
    parseEndpointAdvertisement({ methods: [42], capabilities: [] }),
  ).toBeNull();
  expect(parseEndpointAvailability({ t: null })).toEqual({ t: null });
});

test("subsets leave supported operations enabled; capabilities do not invent method support", () => {
  const subset = {
    methods: ["pane.focus", "tab.create"],
    capabilities: ["health_check", "future_feature"],
  };
  expect(
    endpointMethodReason("browser-local", subset, "tab.create"),
  ).toBeNull();
  expect(
    endpointMethodReason("browser-local", subset, "workspace.create"),
  ).toContain("workspace.create");
  expect(
    endpointMethodReason("browser-local", subset, "pane.scroll"),
  ).toContain("pane.scroll");
  expect(endpointMethodReason("shared", null, "tab.create")).toBeNull();
});
