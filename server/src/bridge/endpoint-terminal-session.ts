import { EventEmitter } from "node:events";
import { EndpointClient, type EndpointSurface } from "./endpoint-client";
import { EndpointCreationDeadline } from "./endpoint-creation";
import { frameToAnsi } from "./frame-to-ansi";
import type { FrameData } from "./thin-client";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";
import { MOUSE_KIND, VtInputClassifier } from "./vt-input-classifier";

const ESC_FLUSH_MS = 25;
const FIRST_SURFACE_WAIT_MS = 10_000;

/**
 * Terminal stream over the stable endpoint protocol (Herdr >= 0.9.0).
 *
 * The endpoint shell renders the focused tab, so this session focuses the
 * pane (which focuses its tab for this shell connection only) and crops the
 * tab surface down to the pane's content rect before re-encoding to ANSI.
 *
 * Members intentionally mirror the ThinClient surface the terminal bridge
 * uses (isClosed/connecting/resize/input/scroll/close/events) so the bridge
 * can hold either backend in one field.
 */
export class EndpointTerminalSession extends EventEmitter {
  private client: EndpointClient;
  private classifier = new VtInputClassifier();
  private pressedMouseButtons = new Set<number>();
  private escFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private paneId: string | null = null;
  private lastScroll: {
    offsetFromBottom: number;
    maxOffsetFromBottom: number;
  } | null = null;
  private closed = false;
  private seq = 0;
  private paneSize = { cols: 0, rows: 0 };
  private surfaceSize = { cols: 0, rows: 0 };
  private fitAttempts = 0;
  private commandChain: Promise<unknown> = Promise.resolve();
  connecting: Promise<void> | null = null;

  constructor(
    socketPath: string,
    private terminalId: string,
    private lookupPaneId: (terminalId: string) => Promise<string | null>,
    private logger: Logger = silentLogger,
  ) {
    super();
    this.client = new EndpointClient(socketPath);
    this.client.on("surface", (s) => this.onSurface(s));
    this.client.on("clipboard", (clipboard) => {
      if (!this.closed && this.paneId) this.emit("clipboard", clipboard);
    });
    this.client.on("error", (e) => this.emit("error", e));
    this.client.on("close", () => {
      this.pressedMouseButtons.clear();
      this.closed = true;
      this.emit("close");
    });
    this.client.on("welcome", (w) => {
      this.emit("welcome", {
        version: w.serverVersion,
        encoding: 1,
        error: null,
      });
    });
  }

  get isClosed() {
    return this.closed;
  }

  get negotiation() {
    return this.client.negotiation;
  }

  connect(cols: number, rows: number): Promise<void> {
    this.paneSize = { cols, rows };
    this.surfaceSize = { cols, rows };
    this.fitAttempts = 4;
    const ready = (async () => {
      await this.client.connect(cols, rows);
      this.client.assertMethod("pane.focus");
      const paneId = await this.lookupPaneId(this.terminalId);
      if (!paneId) {
        throw new Error(
          `no pane found for terminal ${this.terminalId} (endpoint path)`,
        );
      }
      this.paneId = paneId;
      // Focus scopes this shell's surface to the pane's tab; per-client
      // focus in Herdr 0.9.0 keeps this from moving other clients.
      await this.enqueueCommand(() =>
        this.client.callEndpoint("pane.focus", { pane_id: paneId }),
      );
      // A surface may have arrived before the lookup resolved; process it
      // now if it already contains the pane.
      const current = this.client.currentSurface;
      if (current && this.hasPane(current, paneId)) {
        this.onSurface(current);
      }
      await this.waitForSurface(paneId);
    })();
    this.connecting = ready
      .catch((e) => {
        this.close();
        throw e;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private enqueueCommand<T>(run: () => Promise<T>): Promise<T> {
    const bounded = async () => {
      if (this.closed) throw new Error("Endpoint terminal is closed");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  "Endpoint command timed out; check Herdr before retrying. Creation may have succeeded.",
                ),
              );
              this.close();
            }, 10_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const task = this.commandChain.then(bounded, bounded);
    this.commandChain = task.catch(() => undefined);
    return task;
  }

  /** Reuse the attached shell/clipboard lane; never refocus it for creation. */
  create(
    method: "tab.create" | "workspace.create",
    params: Record<string, unknown>,
    sourcePaneId: string,
    validateSource: () => Promise<void>,
    deadline = new EndpointCreationDeadline(),
  ): Promise<unknown> {
    return deadline.wait(
      this.enqueueCommand(async () => {
        deadline.assertBeforeDispatch();
        const ready = () =>
          !this.closed &&
          !this.connecting &&
          this.paneId === sourcePaneId &&
          this.hasPane(this.latestSurface(), sourcePaneId);
        if (!ready())
          throw new Error(
            "Source terminal is not ready. Open its tab and retry creation.",
          );
        for (const requiredMethod of ["pane.focus", method]) {
          this.client.assertMethod(requiredMethod);
        }
        await validateSource();
        if (!ready())
          throw new Error(
            "Source terminal changed before creation. Open its tab and retry.",
          );
        return deadline.dispatch(() =>
          this.client.callEndpoint(method, { ...params, focus: false }),
        );
      }),
      () => this.close(),
    );
  }

  private waitForSurface(paneId: string): Promise<void> {
    if (this.hasPane(this.latestSurface(), paneId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`timed out waiting for endpoint surface of ${paneId}`),
        );
      }, FIRST_SURFACE_WAIT_MS);
      const onSurface = (s: EndpointSurface) => {
        if (this.hasPane(s, paneId)) {
          cleanup();
          resolve();
        }
      };
      const onClose = () => {
        cleanup();
        reject(new Error("endpoint connection closed before first surface"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.client.off("surface", onSurface);
        this.client.off("close", onClose);
      };
      this.client.on("surface", onSurface);
      this.client.on("close", onClose);
    });
  }

  private latestSurface(): EndpointSurface | null {
    return this.client.currentSurface;
  }

  private hasPane(surface: EndpointSurface | null, paneId: string): boolean {
    return surface?.panes.some((p) => p.paneId === paneId) ?? false;
  }

  private onSurface(surface: EndpointSurface) {
    if (!this.paneId) return; // connect() replays once the lookup resolves
    const pane = surface.panes.find((p) => p.paneId === this.paneId);
    if (!pane?.mouseReporting) this.pressedMouseButtons.clear();
    if (!pane) return;
    this.fitSurface(surface);
    this.lastScroll = pane.scroll
      ? {
          offsetFromBottom: pane.scroll.offsetFromBottom,
          maxOffsetFromBottom: pane.scroll.maxOffsetFromBottom,
        }
      : null;
    const cropped = cropFrame(surface.frame, pane.innerRect);
    const bytes = Buffer.from(frameToAnsi(cropped), "utf8");
    this.seq += 1;
    this.emit("terminal", {
      seq: this.seq,
      width: cropped.width,
      height: cropped.height,
      full: true,
      mouseReporting: pane.mouseReporting,
      bytes,
    });
  }

  resize(cols: number, rows: number) {
    this.paneSize = { cols, rows };
    this.fitAttempts = 4;
    const surface = this.latestSurface();
    // A same-size resize must still repaint for newly attached viewers.
    this.surfaceSize = surface ? this.sizeForPane(surface) : { cols, rows };
    this.client.resize(this.surfaceSize.cols, this.surfaceSize.rows);
  }

  private sizeForPane(surface: EndpointSurface) {
    const pane = surface.panes.find((p) => p.paneId === this.paneId);
    if (!pane || pane.rect.width < 1 || pane.rect.height < 1)
      return this.surfaceSize;
    // Endpoint dimensions describe the complete tab, unlike legacy direct
    // terminal attachments. Include pane decorations before undoing the split.
    const scale = (
      wanted: number,
      outer: number,
      inner: number,
      total: number,
    ) =>
      Math.max(
        1,
        Math.min(
          65_535,
          Math.round(((wanted + outer - inner) * total) / outer),
        ),
      );
    return {
      cols: scale(
        this.paneSize.cols,
        pane.rect.width,
        pane.innerRect.width,
        surface.frame.width,
      ),
      rows: scale(
        this.paneSize.rows,
        pane.rect.height,
        pane.innerRect.height,
        surface.frame.height,
      ),
    };
  }

  private fitSurface(surface: EndpointSurface) {
    if (
      this.fitAttempts === 0 ||
      surface.frame.width !== this.surfaceSize.cols ||
      surface.frame.height !== this.surfaceSize.rows
    )
      return;
    const next = this.sizeForPane(surface);
    if (
      next.cols === this.surfaceSize.cols &&
      next.rows === this.surfaceSize.rows
    ) {
      this.fitAttempts = 0;
      return;
    }
    // Split rounding can require a follow-up. Bound convergence and only use
    // frames matching the last request, never resize again for stale patches.
    this.fitAttempts -= 1;
    this.surfaceSize = next;
    this.client.resize(next.cols, next.rows);
  }

  input(data: Buffer) {
    if (!this.paneId || this.closed) return;
    const pane = this.latestSurface()?.panes.find(
      (p) => p.paneId === this.paneId,
    );
    const events = this.classifier.feed(data).filter((event) => {
      if (event.type !== "mouse") return true;
      if (
        !pane?.mouseReporting ||
        pane.innerRect.width < 1 ||
        pane.innerRect.height < 1
      ) {
        this.pressedMouseButtons.clear();
        return false;
      }
      const inside =
        event.column < pane.innerRect.width &&
        event.row < pane.innerRect.height;
      if (event.kind === MOUSE_KIND.Down) {
        this.pressedMouseButtons.delete(event.button!);
        if (inside) this.pressedMouseButtons.add(event.button!);
        return inside;
      }
      if (event.kind === MOUSE_KIND.Drag || event.kind === MOUSE_KIND.Up) {
        if (!this.pressedMouseButtons.has(event.button!)) return false;
        // The browser canvas can exceed the crop. A gesture that began inside
        // still owns its release when it crosses into that blank canvas area.
        event.column = Math.min(event.column, pane.innerRect.width - 1);
        event.row = Math.min(event.row, pane.innerRect.height - 1);
        if (event.kind === MOUSE_KIND.Up)
          this.pressedMouseButtons.delete(event.button!);
        return true;
      }
      return inside;
    });
    this.client.sendPaneInput(this.paneId, events);
    if (this.escFlushTimer) clearTimeout(this.escFlushTimer);
    this.escFlushTimer = setTimeout(() => {
      this.escFlushTimer = null;
      if (!this.paneId || this.closed) return;
      const flushed = this.classifier.flush();
      this.client.sendPaneInput(this.paneId, flushed);
    }, ESC_FLUSH_MS);
  }

  scroll(
    direction: "up" | "down",
    lines: number,
    column?: number | null,
    row?: number | null,
    source: "wheel" | "page-key" = "wheel",
  ) {
    if (!this.paneId || !Number.isFinite(lines) || lines <= 0) return;
    lines = Math.max(1, Math.min(65535, Math.floor(lines)));
    const pane = this.latestSurface()?.panes.find(
      (p) => p.paneId === this.paneId,
    );
    // Touch scrolling uses the same bridge RPC as wheels. A page key remains
    // an explicit history action, as it was before endpoint mouse support.
    if (source === "wheel" && pane?.mouseReporting) {
      if (
        !Number.isInteger(column) ||
        !Number.isInteger(row) ||
        column! < 0 ||
        row! < 0 ||
        column! >= pane.innerRect.width ||
        row! >= pane.innerRect.height
      )
        return;
      this.client.sendPaneInput(this.paneId, [
        {
          type: "mouse",
          kind:
            direction === "up" ? MOUSE_KIND.ScrollUp : MOUSE_KIND.ScrollDown,
          column: column!,
          row: row!,
          modifiers: 0,
          lines,
        },
      ]);
      return;
    }
    this.client.assertMethod("pane.scroll");
    if (!this.lastScroll) return;
    const delta = direction === "up" ? lines : -lines;
    const offset = Math.max(
      0,
      Math.min(
        this.lastScroll.maxOffsetFromBottom,
        this.lastScroll.offsetFromBottom + delta,
      ),
    );
    if (offset === this.lastScroll.offsetFromBottom) return;
    this.lastScroll.offsetFromBottom = offset;
    const paneId = this.paneId;
    this.enqueueCommand(() =>
      this.client.callEndpoint("pane.scroll", {
        pane_id: paneId,
        offset_from_bottom: offset,
      }),
    ).catch((e) =>
      this.logger.debug("endpoint pane.scroll failed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pressedMouseButtons.clear();
    if (this.escFlushTimer) clearTimeout(this.escFlushTimer);
    this.client.close();
  }
}

/** Crop one pane's content rect out of the tab surface. */
export function cropFrame(
  frame: FrameData,
  rect: { x: number; y: number; width: number; height: number },
): FrameData {
  const width = Math.max(0, Math.min(rect.width, frame.width - rect.x));
  const height = Math.max(0, Math.min(rect.height, frame.height - rect.y));
  const cells = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells[y * width + x] =
        frame.cells[(rect.y + y) * frame.width + rect.x + x];
    }
  }
  let cursor = frame.cursor;
  if (cursor) {
    const x = cursor.x - rect.x;
    const y = cursor.y - rect.y;
    cursor =
      x >= 0 && x < width && y >= 0 && y < height ? { ...cursor, x, y } : null;
  }
  return { cells, width, height, cursor, hyperlinks: frame.hyperlinks };
}
