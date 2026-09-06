// "Copy recent lines" reads server-side terminal text through Herdr's
// `pane.read` control API. The `recent_unwrapped` source joins soft-wrapped
// rows back into logical lines, which the browser terminal cannot do on its
// own: Herdr's server-rendered ANSI frames paint rows at absolute positions,
// so xterm never marks any line as wrapped and selection copies keep every
// visual row boundary as a newline.

export const TERMINAL_COPY_RECENT_LINES = 200;

export function terminalCopyRecentRequest(
  paneId: string,
  lines: number = TERMINAL_COPY_RECENT_LINES,
) {
  return {
    method: "pane.read" as const,
    params: {
      pane_id: paneId,
      source: "recent_unwrapped" as const,
      format: "text" as const,
      lines,
    },
  };
}

/** Extracts the text payload from a `pane.read` response envelope. */
export function terminalCopyRecentText(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const envelope = result as Record<string, unknown>;
  if (envelope.type !== "pane_read") return null;
  const read = envelope.read;
  if (!read || typeof read !== "object" || Array.isArray(read)) return null;
  const text = (read as Record<string, unknown>).text;
  return typeof text === "string" ? text : null;
}
