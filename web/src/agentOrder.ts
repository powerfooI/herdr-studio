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
