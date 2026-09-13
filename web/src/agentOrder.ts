export const AGENT_ORDER_STORAGE_KEY = "agentOrder.v1";

const MAX_AGENT_ORDER_ENTRIES = 512;
const MAX_PANE_ID_LENGTH = 512;

export function parseAgentOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const paneIds: string[] = [];
    for (const candidate of value) {
      if (
        typeof candidate !== "string" ||
        candidate.length === 0 ||
        candidate.length > MAX_PANE_ID_LENGTH ||
        seen.has(candidate)
      ) {
        continue;
      }
      seen.add(candidate);
      paneIds.push(candidate);
      if (paneIds.length >= MAX_AGENT_ORDER_ENTRIES) break;
    }
    return paneIds;
  } catch {
    return [];
  }
}

export function serializeAgentOrder(paneIds: readonly string[]): string {
  return JSON.stringify(paneIds.slice(0, MAX_AGENT_ORDER_ENTRIES));
}

export function orderAgentPanes<T extends { pane_id: string }>(
  panes: readonly T[],
  preferredPaneIds: readonly string[],
): T[] {
  const panesById = new Map(panes.map((pane) => [pane.pane_id, pane]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const paneId of preferredPaneIds) {
    const pane = panesById.get(paneId);
    if (!pane || seen.has(paneId)) continue;
    ordered.push(pane);
    seen.add(paneId);
  }
  for (const pane of panes) {
    if (seen.has(pane.pane_id)) continue;
    ordered.push(pane);
    seen.add(pane.pane_id);
  }
  return ordered;
}

export function moveAgentPane(
  paneIds: readonly string[],
  draggedPaneId: string,
  targetPaneId: string,
  position: "before" | "after",
): string[] {
  if (draggedPaneId === targetPaneId) return [...paneIds];
  if (!paneIds.includes(draggedPaneId) || !paneIds.includes(targetPaneId)) {
    return [...paneIds];
  }
  const next = paneIds.filter((paneId) => paneId !== draggedPaneId);
  const targetIndex = next.indexOf(targetPaneId);
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, draggedPaneId);
  return next;
}

export const AGENT_LIST_PREFERENCES_STORAGE_KEY = "agentListPreferences.v1";
export type AgentSort = "attention" | "manual" | "workspace";
export type AgentGrouping = "none" | "status" | "workspace" | "agent";
export type AgentListPreferences = { sort: AgentSort; grouping: AgentGrouping };

export function parseAgentListPreferences(
  raw: string | null,
): AgentListPreferences {
  let value: Partial<AgentListPreferences> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed && typeof parsed === "object") value = parsed;
  } catch {
    // Use attention-first defaults for missing or malformed preferences.
  }
  return {
    sort:
      value.sort === "manual" || value.sort === "workspace"
        ? value.sort
        : "attention",
    grouping:
      value.grouping === "status" ||
      value.grouping === "workspace" ||
      value.grouping === "agent"
        ? value.grouping
        : "none",
  };
}

const ATTENTION_STATUSES = [
  "blocked",
  "done",
  "working",
  "idle",
  "unknown",
] as const;

export function agentAttentionPriority(status: string): number {
  const index = ATTENTION_STATUSES.indexOf(
    status.toLowerCase() as (typeof ATTENTION_STATUSES)[number],
  );
  return index < 0 ? ATTENTION_STATUSES.length - 1 : index;
}

export function sortAgentPanes<
  T extends { pane_id: string; agent_status: string },
>(
  panes: readonly T[],
  preferredPaneIds: readonly string[],
  sort: AgentSort,
): T[] {
  if (sort === "workspace") return [...panes];
  const ordered = orderAgentPanes(panes, preferredPaneIds);
  return sort === "attention"
    ? ordered.sort(
        (left, right) =>
          agentAttentionPriority(left.agent_status) -
          agentAttentionPriority(right.agent_status),
      )
    : ordered;
}

export function groupOrderedAgentPanes<
  T extends { workspace_id: string; agent?: string; agent_status: string },
>(
  panes: readonly T[],
  grouping: AgentGrouping,
  workspaceLabels: ReadonlyMap<string, string>,
): { key: string; label: string; panes: T[] }[] {
  const groups = new Map<string, { key: string; label: string; panes: T[] }>();
  for (const pane of panes) {
    const status =
      ATTENTION_STATUSES[agentAttentionPriority(pane.agent_status)];
    const key =
      grouping === "workspace"
        ? pane.workspace_id
        : grouping === "agent"
          ? pane.agent?.trim().toLowerCase() || "unknown"
          : grouping === "status"
            ? status
            : "all";
    const label =
      grouping === "workspace"
        ? (workspaceLabels.get(key) ?? key)
        : grouping === "agent"
          ? pane.agent?.trim() || "Unknown agent"
          : grouping === "status"
            ? {
                blocked: "Blocked",
                done: "Done",
                idle: "Idle",
                working: "Working",
                unknown: "Unknown",
              }[status]
            : "All agents";
    const group = groups.get(key);
    if (group) group.panes.push(pane);
    else groups.set(key, { key, label, panes: [pane] });
  }
  const result = [...groups.values()];
  if (grouping === "status")
    result.sort(
      (left, right) =>
        agentAttentionPriority(left.key) - agentAttentionPriority(right.key),
    );
  return result;
}
