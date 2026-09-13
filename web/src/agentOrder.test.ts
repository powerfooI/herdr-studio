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

import {
  groupOrderedAgentPanes,
  parseAgentListPreferences,
  sortAgentPanes,
} from "./agentOrder";

const agents = [
  {
    pane_id: "p1",
    workspace_id: "w1",
    agent: "Codex",
    agent_status: "working",
  },
  {
    pane_id: "p2",
    workspace_id: "w2",
    agent: "Claude",
    agent_status: "blocked",
  },
  { pane_id: "p3", workspace_id: "w1", agent: "codex", agent_status: "done" },
  {
    pane_id: "p4",
    workspace_id: "w2",
    agent: "Codex",
    agent_status: "BLOCKED",
  },
  { pane_id: "p5", workspace_id: "w1", agent: "Claude", agent_status: "idle" },
  {
    pane_id: "p6",
    workspace_id: "w1",
    agent: "Claude",
    agent_status: "new-status",
  },
];

describe("agent attention and grouping", () => {
  test("prioritizes blocked and completed agents with stable manual tie-breaking", () => {
    expect(
      sortAgentPanes(agents, ["p4", "p1", "p2"], "attention").map(
        (pane) => pane.pane_id,
      ),
    ).toEqual(["p4", "p2", "p3", "p1", "p5", "p6"]);
    expect(agents.map((pane) => pane.pane_id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    expect(
      sortAgentPanes(agents, ["p4", "p1"], "manual").map(
        (pane) => pane.pane_id,
      ),
    ).toEqual(["p4", "p1", "p2", "p3", "p5", "p6"]);
    expect(sortAgentPanes(agents, ["p4", "p1"], "workspace")).toEqual(agents);
    const updated = agents.map((pane) =>
      pane.pane_id === "p1" ? { ...pane, agent_status: "blocked" } : pane,
    );
    expect(sortAgentPanes(updated, [], "attention")[0].pane_id).toBe("p1");
  });

  test("groups statuses in attention order and preserves pane order within groups", () => {
    const groups = groupOrderedAgentPanes(agents, "status", new Map());
    expect(groups.map((group) => group.key)).toEqual([
      "blocked",
      "done",
      "working",
      "idle",
      "unknown",
    ]);
    expect(groups[0].panes.map((pane) => pane.pane_id)).toEqual(["p2", "p4"]);
  });

  test("groups by workspace identity even when names are duplicated and normalizes agent types", () => {
    const groups = groupOrderedAgentPanes(
      agents,
      "workspace",
      new Map([
        ["w1", "Project"],
        ["w2", "Project"],
      ]),
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.label)).toEqual(["Project", "Project"]);
    expect(
      groupOrderedAgentPanes(agents, "agent", new Map()).map(
        (group) => group.panes.length,
      ),
    ).toEqual([3, 3]);
    expect(groupOrderedAgentPanes(agents, "none", new Map())[0].panes).toEqual(
      agents,
    );
  });

  test("validates saved sorting and grouping preferences", () => {
    for (const raw of [null, "oops", "[]", '{"sort":"bad","grouping":"bad"}']) {
      expect(parseAgentListPreferences(raw)).toEqual({
        sort: "attention",
        grouping: "none",
      });
    }
    expect(
      parseAgentListPreferences('{"sort":"manual","grouping":"workspace"}'),
    ).toEqual({ sort: "manual", grouping: "workspace" });
  });
});
