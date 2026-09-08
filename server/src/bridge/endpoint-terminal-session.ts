import { EventEmitter } from "node:events";
import { EndpointClient, type EndpointSurface } from "./endpoint-client";
import { frameToAnsi } from "./frame-to-ansi";
import type { FrameData } from "./thin-client";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";
import { VtInputClassifier } from "./vt-input-classifier";

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
  private escFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private paneId: string | null = null;
  private lastScroll: {
    offsetFromBottom: number;
    maxOffsetFromBottom: number;
  } | null = null;
  private closed = false;
  private seq = 0;
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
    this.client.on("error", (e) => this.emit("error", e));
    this.client.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
    this.client.on("welcome", (w) =>
      this.emit("welcome", {
        version: w.serverVersion,
        encoding: 1,
        error: null,
      }),
    );
  }

  get isClosed() {
    return this.closed;
  }

  connect(cols: number, rows: number): Promise<void> {
    const ready = (async () => {
      await this.client.connect(cols, rows);
      const paneId = await this.lookupPaneId(this.terminalId);
      if (!paneId) {
        throw new Error(
          `no pane found for terminal ${this.terminalId} (endpoint path)`,
        );
      }
      this.paneId = paneId;
      // Focus scopes this shell's surface to the pane's tab; per-client
      // focus in Herdr 0.9.0 keeps this from moving other clients.
      await this.client.callEndpoint("pane.focus", { pane_id: paneId });
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
    if (!pane) return;
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
      bytes,
    });
  }

  resize(cols: number, rows: number) {
    this.client.resize(cols, rows);
  }

  input(data: Buffer) {
    if (!this.paneId) return;
    const events = this.classifier.feed(data);
    this.client.sendPaneInput(this.paneId, events);
    if (this.escFlushTimer) clearTimeout(this.escFlushTimer);
    this.escFlushTimer = setTimeout(() => {
      this.escFlushTimer = null;
      if (!this.paneId || this.closed) return;
      const flushed = this.classifier.flush();
      this.client.sendPaneInput(this.paneId, flushed);
    }, ESC_FLUSH_MS);
  }

  // Extra ThinClient scroll params (column/row/source) are accepted by the
  // bridge but unused here: endpoint scrolls by absolute offset.
  scroll(direction: "up" | "down", lines: number) {
    if (!this.paneId || !this.lastScroll) return;
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
    this.client
      .callEndpoint("pane.scroll", {
        pane_id: this.paneId,
        offset_from_bottom: offset,
      })
      .catch((e) =>
        this.logger.debug("endpoint pane.scroll failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
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
