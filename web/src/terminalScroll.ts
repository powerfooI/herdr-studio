export type TerminalScroll = {
  direction: "up" | "down";
  lines: number;
  source: "wheel" | "page-key" | "history";
};

export type TerminalWheelScroll = TerminalScroll & { source: "wheel" };

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** Normalizes browser wheel units into Herdr's terminal scroll request shape. */
export function terminalWheelScroll(
  deltaY: number,
  deltaMode: number,
  rows: number,
): TerminalWheelScroll | null {
  if (deltaY === 0) return null;

  const lines =
    deltaMode === DOM_DELTA_PAGE
      ? Math.max(1, rows)
      : deltaMode === DOM_DELTA_LINE
        ? Math.max(1, Math.ceil(Math.abs(deltaY)))
        : deltaMode === DOM_DELTA_PIXEL
          ? Math.max(1, Math.ceil(Math.abs(deltaY) / 40))
          : Math.max(1, Math.ceil(Math.abs(deltaY)));

  return {
    direction: deltaY < 0 ? "up" : "down",
    lines,
    source: "wheel",
  };
}

/** Full pages let Herdr route the key; half pages explicitly scroll history. */
export function terminalPageScroll(
  direction: "up" | "down",
  rows: number,
  amount: "full" | "half" = "full",
): TerminalScroll {
  const viewportLines = Math.max(1, rows - 2);
  return {
    direction,
    lines:
      amount === "half"
        ? Math.max(1, Math.floor(viewportLines / 2))
        : viewportLines,
    // The bridge retains legacy wheel semantics for half pages, but endpoint
    // sessions must distinguish these coordinate-less shortcuts from a mouse.
    source: amount === "full" ? "page-key" : "history",
  };
}
