/** xterm's native selection escape: Shift on non-Mac, Option on Mac. */
export function terminalMouseUsesSelection(
  mouseReporting: boolean | undefined,
  event: { shiftKey: boolean; altKey: boolean },
  applePlatform: boolean,
): boolean {
  return (
    mouseReporting !== true || (applePlatform ? event.altKey : event.shiftKey)
  );
}

/**
 * Endpoint frames are self-contained repaints, not an incremental PTY stream.
 * Retain just the newest while selecting so copied text stays the visible text.
 * Legacy streams never pass through this helper.
 */
export class TerminalEndpointPresentation {
  mouseReporting: boolean | undefined;
  selectionDrag = false;
  private appliedMouseReporting: boolean | undefined;
  private pendingFrame: string | null = null;
  private writing = false;
  private disposed = false;
  private deferredSelection: (() => void) | null = null;

  constructor(
    private hasSelection: () => boolean,
    private write: (text: string, parsed: () => void) => void,
  ) {}

  get selectionPending(): boolean {
    return this.deferredSelection !== null;
  }

  get writePending(): boolean {
    return this.writing;
  }

  /** Reserve selection immediately; replay native initiation only after parsing. */
  beginSelection(replay: () => void): boolean {
    if (this.disposed) return false;
    this.selectionDrag = true;
    if (!this.writing) return true;
    this.deferredSelection = replay;
    return false;
  }

  cancelSelection(): void {
    this.deferredSelection = null;
    this.selectionDrag = false;
    this.flush();
  }

  update(text: string, mouseReporting: boolean): void {
    if (this.disposed) return;
    this.mouseReporting = mouseReporting;
    this.pendingFrame = text;
    this.flush();
  }

  flush(): void {
    if (
      this.disposed ||
      this.writing ||
      this.selectionDrag ||
      this.hasSelection()
    )
      return;
    let prefix = "";
    if (
      this.mouseReporting !== undefined &&
      this.appliedMouseReporting !== this.mouseReporting
    ) {
      // Activation clears xterm selection, so apply only after selection ends.
      // Drag tracking suffices for pane applications; no hover reports that
      // could clear a retained browser selection after the escape is released.
      prefix = this.mouseReporting
        ? "\x1b[?1006h\x1b[?1002h"
        : "\x1b[?1002l\x1b[?1006l";
      this.appliedMouseReporting = this.mouseReporting;
    }
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    if (prefix || frame !== null) {
      this.writing = true;
      this.write(prefix + (frame ?? ""), () => {
        // reset() cannot cancel the physical xterm write. Its completion must
        // still release the gate for current intent, never restore old state.
        this.writing = false;
        if (this.disposed) return;
        const replay = this.deferredSelection;
        this.deferredSelection = null;
        if (replay) replay();
        this.flush();
      });
    }
  }

  reset(): void {
    // Invalidate presentation/replay, not the outstanding parser operation.
    this.deferredSelection = null;
    this.mouseReporting = undefined;
    this.appliedMouseReporting = undefined;
    this.pendingFrame = null;
    this.selectionDrag = false;
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
  }
}
