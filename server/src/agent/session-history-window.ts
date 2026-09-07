// Shared by the server projection and the web history merger, so it must stay
// free of Node or browser imports.
type WindowedEntry = { role: string };

// The window counts conversation entries only (user/assistant messages and
// errors). Tool calls and tool results ride along with the conversation
// entries that survive the cut, so tool-heavy turns cannot evict user
// messages from the visible history.
export function historyWindowEntries<T extends WindowedEntry>(
  entries: readonly T[],
  limit: number,
): T[] {
  let remaining = Math.max(1, Math.floor(limit));
  let start = entries.length;
  while (start > 0 && remaining > 0) {
    start -= 1;
    if (entries[start]?.role !== "tool") remaining -= 1;
  }
  return entries.slice(start);
}
