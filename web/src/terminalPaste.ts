// Quick pastes should finish before the loading overlay becomes visible.
const PASTE_LOADING_DELAY_MS = 200;

/** One runner per terminal effect; dispose it when that effect tears down. */
export function createTerminalPasteRunner(
  isCurrent: () => boolean,
  setLoading: (loading: boolean) => void,
) {
  let pending = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (disposed || !isCurrent()) {
        throw new Error("paste cancelled");
      }
      pending += 1;
      // Concurrent pastes share the first operation's delay, not a new one.
      if (pending === 1) {
        timer = setTimeout(() => {
          timer = null;
          if (!disposed && isCurrent()) setLoading(true);
        }, PASTE_LOADING_DELAY_MS);
      }
      try {
        const result = await operation();
        if (disposed || !isCurrent()) {
          throw new Error("paste cancelled");
        }
        return result;
      } finally {
        pending -= 1;
        if (pending === 0) {
          cancelTimer();
          if (!disposed && isCurrent()) setLoading(false);
        }
      }
    },
    dispose() {
      disposed = true;
      cancelTimer();
      // Reset even after the connection expires; old completions must not
      // hide a newer effect's loading overlay on the same connection.
      setLoading(false);
    },
  };
}

type TerminalPasteInputEvent = Pick<InputEvent, "inputType" | "isComposing">;

export type TerminalPasteTextareaSnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Recovers text inserted by WebKit's native paste path from xterm's helper
 * textarea. Selection-aware prefix/suffix matching avoids replaying text that
 * merely survived a replacement paste.
 */
export function terminalPasteInputText(
  input: TerminalPasteInputEvent,
  before: TerminalPasteTextareaSnapshot,
  textareaValue: string,
): string | null {
  if (input.isComposing || input.inputType !== "insertFromPaste") return null;
  if (
    before.selectionStart < 0 ||
    before.selectionEnd < before.selectionStart ||
    before.selectionEnd > before.value.length
  ) {
    return null;
  }
  if (
    before.selectionStart === before.selectionEnd &&
    textareaValue === before.value
  ) {
    return null;
  }

  const prefix = before.value.slice(0, before.selectionStart);
  const suffix = before.value.slice(before.selectionEnd);
  if (!textareaValue.startsWith(prefix) || !textareaValue.endsWith(suffix)) {
    return null;
  }
  const insertedEnd = textareaValue.length - suffix.length;
  if (insertedEnd < prefix.length) return null;
  return textareaValue.slice(prefix.length, insertedEnd) || null;
}

export function prepareTerminalPasteText(text: string) {
  // Match xterm's paste normalization while letting Herdr apply bracketed
  // paste from the authoritative PTY mode instead of the browser's stale copy.
  return text.replace(/\r?\n/g, "\r");
}

export function terminalPasteRequest(paneId: string, text: string) {
  return {
    method: "pane.send_input" as const,
    params: {
      pane_id: paneId,
      text: prepareTerminalPasteText(text),
      keys: [] as string[],
    },
  };
}
