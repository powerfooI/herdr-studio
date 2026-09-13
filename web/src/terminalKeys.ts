import { matchesShortcut, type ShortcutBindings } from "./shortcutBindings";
type TerminalKeyEvent = Pick<
  KeyboardEvent,
  | "type"
  | "key"
  | "code"
  | "keyCode"
  | "shiftKey"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "isComposing"
>;

function isCompositionEvent(event: TerminalKeyEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** Configured terminal actions emit the same protocol bytes as the built-ins. */
export function terminalShortcutSequence(
  event: TerminalKeyEvent,
  bindings: ShortcutBindings,
): string | null {
  if (event.type !== "keydown" || isCompositionEvent(event)) return null;
  const sequences = {
    "terminal.multiline": "\x1b[13;2u",
    "terminal.altEnter": "\x1b[13;3u",
    "terminal.lineStart": "\x01",
    "terminal.lineEnd": "\x05",
    "terminal.deleteToStart": "\x15",
  } as const;
  for (const id of Object.keys(sequences) as (keyof typeof sequences)[]) {
    if (matchesShortcut(event, id, bindings)) return sequences[id];
  }
  return null;
}
