import type { IBufferRange, Terminal } from "@xterm/xterm";
import type { TerminalPresentationFrame } from "./terminalEndpointPresentation";

export interface TerminalHistoryViewport {
  revision: number;
  top: number;
  total: number;
  cols: number;
  rows: number;
}

type Point = { row: number; col: number };
type CapturedRow = string[];

/** Absolute selection coordinates and immutable copies of every visited row. */
export class TerminalHistoryRange {
  private captured = new Map<number, CapturedRow>();
  readonly anchor: Point;
  cursor: Point;

  constructor(range: IBufferRange, top: number, backwards: boolean) {
    const start = { row: top + range.start.y, col: range.start.x };
    const end = { row: top + range.end.y, col: range.end.x };
    this.anchor = backwards ? end : start;
    this.cursor = backwards ? start : end;
  }

  capture(top: number, rows: CapturedRow[]): void {
    rows.forEach((row, index) => {
      // Revisiting a row cannot change text already selected by the user.
      if (!this.captured.has(top + index)) this.captured.set(top + index, row);
    });
  }

  get ordered(): [Point, Point] {
    const a = this.anchor,
      b = this.cursor;
    return a.row < b.row || (a.row === b.row && a.col <= b.col)
      ? [a, b]
      : [b, a];
  }

  get text(): string {
    const [start, end] = this.ordered;
    const lines: string[] = [];
    for (let row = start.row; row <= end.row; row++) {
      // xterm end coordinates are exclusive; column zero ends the preceding row.
      if (row === end.row && end.col === 0) break;
      const cells = this.captured.get(row);
      if (!cells) return ""; // Never copy a range with an unseen gap.
      let left = row === start.row ? start.col : 0;
      let right = row === end.row ? end.col : cells.length;
      // A wide glyph belongs to the selection if either half is selected.
      if (left > 0 && cells[left] === "") left--;
      if (right < cells.length && cells[right] === "") right++;
      lines.push(cells.slice(left, right).join("").replace(/ +$/, ""));
    }
    return lines.join("\n");
  }

  visible(top: number, rows: number, cols: number) {
    const [start, end] = this.ordered;
    const first = Math.max(top * cols, start.row * cols + start.col);
    const last = Math.min((top + rows) * cols, end.row * cols + end.col);
    return {
      row: Math.floor(first / cols) - top,
      col: first % cols,
      length: Math.max(0, last - first),
    };
  }
}

/**
 * xterm sees full endpoint repaints, so it cannot scroll native history itself.
 * Promote an ordinary xterm drag only at the pane edge. Read each newly exposed
 * viewport before requesting the next, preserving the entire range for copying.
 */
export class TerminalHistorySelection {
  private range: TerminalHistoryRange | null = null;
  private viewport: TerminalHistoryViewport | null = null;
  private dragging = false;
  private pointer: { x: number; y: number } | null = null;
  private pending: "up" | "down" | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private request = 0;
  releasingNative = false;

  constructor(
    private term: Terminal,
    private options: {
      frame: () => TerminalPresentationFrame | null;
      scroll: (direction: "up" | "down", lines: number) => Promise<unknown>;
      changed: (message: string) => void;
    },
  ) {}

  get active() {
    return this.range !== null;
  }
  get text() {
    return this.range?.text;
  }

  private bounds() {
    return this.term.element
      ?.querySelector(".xterm-screen")
      ?.getBoundingClientRect();
  }

  private edge(): "up" | "down" | null {
    const rect = this.bounds();
    if (!rect || !this.pointer) return null;
    if (this.pointer.y < rect.top + 4) return "up";
    if (this.pointer.y >= rect.bottom - 4) return "down";
    return null;
  }

  move(e: MouseEvent, selecting: boolean): boolean {
    if (this.releasingNative) return false;
    if (!(e.buttons & 1)) {
      this.finish();
      return false;
    }
    if (!selecting && !this.dragging) return false;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (!this.range) {
      const edge = this.edge();
      const history = this.options.frame()?.history;
      const selection = this.term.getSelectionPosition();
      if (
        !edge ||
        !history ||
        !selection ||
        history.total <= history.rows ||
        history.cols !== this.term.cols ||
        history.rows !== this.term.rows
      )
        return false;
      const base = this.term.buffer.active.viewportY;
      this.range = new TerminalHistoryRange(
        {
          start: { x: selection.start.x, y: selection.start.y - base },
          end: { x: selection.end.x, y: selection.end.y - base },
        },
        history.top,
        edge === "up",
      );
      this.viewport = history;
      this.capture();
      // Retire xterm's document drag timer before taking over absolute rows.
      this.releasingNative = true;
      try {
        this.term.element?.ownerDocument.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, button: 0, buttons: 0 }),
        );
      } finally {
        this.releasingNative = false;
      }
      this.dragging = true;
    }
    if (!this.dragging) return false;
    this.extend();
    this.schedule();
    return true;
  }

  private capture() {
    if (!this.range || !this.viewport) return;
    const buffer = this.term.buffer.active;
    const rows: CapturedRow[] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      rows.push(
        Array.from({ length: this.term.cols }, (_, x) => {
          const cell = line?.getCell(x);
          return cell?.getWidth() === 0 ? "" : cell?.getChars() || " ";
        }),
      );
    }
    this.range.capture(this.viewport.top, rows);
  }

  private extend() {
    const rect = this.bounds();
    if (!this.range || !this.viewport || !rect || !this.pointer) return;
    const row = Math.max(
      0,
      Math.min(
        this.term.rows - 1,
        Math.floor(
          (this.pointer.y - rect.top) / (rect.height / this.term.rows),
        ),
      ),
    );
    const edge = this.edge();
    const col =
      edge === "up"
        ? 0
        : edge === "down"
          ? this.term.cols
          : Math.max(
              0,
              Math.min(
                this.term.cols,
                Math.round(
                  (this.pointer.x - rect.left) / (rect.width / this.term.cols),
                ),
              ),
            );
    this.range.cursor = { row: this.viewport.top + row, col };
    this.highlight();
  }

  private highlight() {
    if (!this.range || !this.viewport) return;
    const range = this.range.visible(
      this.viewport.top,
      this.term.rows,
      this.term.cols,
    );
    this.term.select(
      range.col,
      this.term.buffer.active.viewportY + range.row,
      range.length,
    );
  }

  private schedule() {
    if (
      this.timer ||
      this.pending ||
      !this.dragging ||
      this.stopped ||
      !this.edge()
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const rect = this.bounds();
      const y = this.pointer?.y ?? 0;
      const distance = rect ? Math.max(rect.top - y, y - rect.bottom, 0) : 0;
      const lines = rect
        ? Math.min(12, 1 + Math.ceil(distance / (rect.height / this.term.rows)))
        : 3;
      this.scroll(this.edge(), lines);
    }, 100);
  }

  private scroll(direction: "up" | "down" | null, requestedLines = 3) {
    const viewport = this.viewport;
    if (
      !direction ||
      !viewport ||
      this.pending ||
      this.stopped ||
      !this.dragging
    )
      return;
    if (
      direction === "up"
        ? viewport.top <= 0
        : viewport.top + viewport.rows >= viewport.total
    )
      return;
    // Overlap successive viewports (or use adjacent rows in a one-row pane).
    // Never skip uncaptured rows.
    const lines = Math.min(
      Math.max(1, requestedLines),
      Math.max(1, viewport.rows - 1),
    );
    this.pending = direction;
    const request = ++this.request;
    this.timeout = setTimeout(
      () => this.stop("Scrolling paused. Finish this selection and try again."),
      3000,
    );
    this.options.scroll(direction, lines).catch(() => {
      if (request === this.request && this.pending)
        this.stop(
          "Unable to scroll this selection. Finish selecting and try again.",
        );
    });
  }

  wheel(direction: "up" | "down", lines: number): boolean {
    if (!this.active || !this.dragging) return false;
    this.scroll(direction, lines);
    return true;
  }

  accepts(frame: TerminalPresentationFrame): boolean {
    if (!this.pending || !this.viewport || !this.range) return false;
    const next = frame.history;
    if (
      !next ||
      next.cols !== this.viewport.cols ||
      next.rows !== this.viewport.rows ||
      next.revision !== this.viewport.revision ||
      next.total !== this.viewport.total
    ) {
      this.stop(
        "Terminal output changed. Finish this selection before scrolling further.",
      );
      return false;
    }
    const delta = next.top - this.viewport.top;
    return (
      Math.abs(delta) <= next.rows &&
      (this.pending === "up" ? delta < 0 : delta > 0)
    );
  }

  presented(frame: TerminalPresentationFrame): void {
    if (!this.range || !frame.history) return;
    this.viewport = frame.history;
    this.pending = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.capture();
    if (this.dragging) this.extend();
    else this.highlight();
    this.schedule();
  }

  private stop(message: string) {
    this.stopped = true;
    this.cancelTimers();
    this.options.changed(message);
  }

  private cancelTimers() {
    this.request++;
    if (this.timer) clearTimeout(this.timer);
    if (this.timeout) clearTimeout(this.timeout);
    this.timer = this.timeout = null;
    this.pending = null;
  }

  finish() {
    this.dragging = false;
    this.cancelTimers();
  }
  reset() {
    this.finish();
    this.range = null;
    this.viewport = null;
    this.pointer = null;
    this.stopped = false;
  }
}
