import type { Pane, PaneLayout, Tab, Workspace } from "./types";

/** Browser-memory selection, partitioned by the store's connection/runtime lease. */
export interface BrowserNavigation {
  /** Explicit navigation/adoption invalidates pending results, including ABA. */
  revision: number;
  workspaceId: string | null;
  tabIds: Record<string, string>;
  paneIds: Record<string, string>;
}

export function emptyBrowserNavigation(): BrowserNavigation {
  return { revision: 0, workspaceId: null, tabIds: {}, paneIds: {} };
}

export function selectBrowserTarget(
  navigation: BrowserNavigation,
  workspaceId: string,
  tabId?: string,
  paneId?: string,
): BrowserNavigation {
  return {
    revision: navigation.revision + 1,
    workspaceId,
    tabIds: tabId
      ? { ...navigation.tabIds, [workspaceId]: tabId }
      : navigation.tabIds,
    paneIds:
      tabId && paneId
        ? { ...navigation.paneIds, [tabId]: paneId }
        : navigation.paneIds,
  };
}

/** Adopt shared focus only at first observation; later snapshots cannot navigate. */
export function projectBrowserNavigation(
  navigation: BrowserNavigation,
  workspaces: Workspace[],
  tabs: Tab[],
  panes: Pane[],
): {
  browserNavigation: BrowserNavigation;
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  selectedPaneId: string | null;
} {
  const workspaceId =
    workspaces.find((w) => w.workspace_id === navigation.workspaceId)
      ?.workspace_id ??
    (navigation.workspaceId === null
      ? workspaces.find((w) => w.focused)?.workspace_id
      : undefined) ??
    workspaces[0]?.workspace_id ??
    null;
  const tabIds: Record<string, string> = {};
  const paneIds: Record<string, string> = {};
  for (const workspace of workspaces) {
    const candidates = tabs.filter(
      (tab) => tab.workspace_id === workspace.workspace_id,
    );
    const remembered = navigation.tabIds[workspace.workspace_id];
    const tab =
      candidates.find((tab) => tab.tab_id === remembered) ??
      (!remembered
        ? candidates.find((tab) => tab.tab_id === workspace.active_tab_id)
        : undefined) ??
      candidates[0];
    if (tab) tabIds[workspace.workspace_id] = tab.tab_id;
  }
  for (const tab of tabs) {
    const candidates = panes.filter(
      (pane) =>
        pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id,
    );
    const remembered = navigation.paneIds[tab.tab_id];
    const pane =
      candidates.find((pane) => pane.pane_id === remembered) ??
      (!remembered ? candidates.find((pane) => pane.focused) : undefined) ??
      candidates[0];
    if (pane) paneIds[tab.tab_id] = pane.pane_id;
  }
  const selectedTabId = workspaceId ? tabIds[workspaceId] : undefined;
  const selectedPaneId = selectedTabId
    ? (paneIds[selectedTabId] ?? null)
    : null;
  const previousTabId = navigation.workspaceId
    ? navigation.tabIds[navigation.workspaceId]
    : undefined;
  const previousPaneId = previousTabId
    ? (navigation.paneIds[previousTabId] ?? null)
    : null;
  const selectionChanged =
    workspaceId !== navigation.workspaceId ||
    selectedTabId !== previousTabId ||
    selectedPaneId !== previousPaneId;
  return {
    browserNavigation: {
      revision: navigation.revision + (selectionChanged ? 1 : 0),
      workspaceId,
      tabIds,
      paneIds,
    },
    workspaces: workspaces.map((w) => ({
      ...w,
      focused: w.workspace_id === workspaceId,
      active_tab_id: tabIds[w.workspace_id],
    })),
    tabs: tabs.map((t) => ({ ...t, focused: t.tab_id === selectedTabId })),
    panes: panes.map((p) => ({ ...p, focused: p.pane_id === selectedPaneId })),
    selectedPaneId,
  };
}

export function projectBrowserLayout(
  layout: PaneLayout | null,
  paneId: string | null,
): PaneLayout | null {
  if (
    !layout ||
    !paneId ||
    !layout.panes.some((pane) => pane.pane_id === paneId)
  )
    return layout;
  return {
    ...layout,
    focused_pane_id: paneId,
    panes: layout.panes.map((pane) => ({
      ...pane,
      focused: pane.pane_id === paneId,
    })),
  };
}

/** Directional navigation uses visible pane geometry, never a shared focus RPC. */
export function browserPaneInDirection(
  layout: PaneLayout | null,
  paneId: string,
  direction: "left" | "right" | "up" | "down",
): string | null {
  const source = layout?.panes.find((pane) => pane.pane_id === paneId);
  if (!source || !layout) return null;
  const horizontal = direction === "left" || direction === "right";
  const reverse = direction === "left" || direction === "up";
  const a = source.rect;
  const start = horizontal ? a.x : a.y;
  const end = start + (horizontal ? a.width : a.height);
  const crossStart = horizontal ? a.y : a.x;
  const crossEnd = crossStart + (horizontal ? a.height : a.width);
  // Same edge/overlap/center ordering as tagged Herdr 0.9 layout::find_in_direction.
  return (
    layout.panes
      .filter((pane) => pane.pane_id !== paneId)
      .map((pane) => {
        const b = pane.rect;
        const bStart = horizontal ? b.x : b.y;
        const bEnd = bStart + (horizontal ? b.width : b.height);
        const bCrossStart = horizontal ? b.y : b.x;
        const bCrossEnd = bCrossStart + (horizontal ? b.height : b.width);
        return {
          pane,
          distance: reverse ? start - bEnd : bStart - end,
          overlap:
            Math.min(crossEnd, bCrossEnd) - Math.max(crossStart, bCrossStart),
          center: Math.abs(crossStart + crossEnd - bCrossStart - bCrossEnd),
        };
      })
      .filter((candidate) => candidate.distance >= 0 && candidate.overlap > 0)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          b.overlap - a.overlap ||
          a.center - b.center,
      )[0]?.pane.pane_id ?? null
  );
}
