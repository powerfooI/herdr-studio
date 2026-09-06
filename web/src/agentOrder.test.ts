import { describe, expect, test } from "bun:test";
import {
  moveAgentPane,
  orderAgentPanes,
  parseAgentOrder,
  serializeAgentOrder,
} from "./agentOrder";

describe("agent panel ordering", () => {
  test("parses only bounded unique pane ids", () => {
    expect(
      parseAgentOrder(
        JSON.stringify(["p2", "p1", "p2", 42, "", "x".repeat(513)]),
      ),
    ).toEqual(["p2", "p1"]);
    expect(parseAgentOrder("bad json")).toEqual([]);
    expect(parseAgentOrder("{}" as string)).toEqual([]);
    expect(JSON.parse(serializeAgentOrder(["p2", "p1"]))).toEqual(["p2", "p1"]);
  });

  test("applies stored order and appends new panes in source order", () => {
    const panes = [{ pane_id: "p1" }, { pane_id: "p2" }, { pane_id: "p3" }];
    expect(
      orderAgentPanes(panes, ["closed", "p3", "p1"]).map(
        (pane) => pane.pane_id,
      ),
    ).toEqual(["p3", "p1", "p2"]);
  });

  test("moves panes before and after a drop target", () => {
    expect(moveAgentPane(["p1", "p2", "p3"], "p3", "p1", "before")).toEqual([
      "p3",
      "p1",
      "p2",
    ]);
    expect(moveAgentPane(["p1", "p2", "p3"], "p1", "p2", "after")).toEqual([
      "p2",
      "p1",
      "p3",
    ]);
    expect(moveAgentPane(["p1", "p2"], "missing", "p1", "after")).toEqual([
      "p1",
      "p2",
    ]);
  });
});
