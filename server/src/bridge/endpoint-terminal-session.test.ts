import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { BinReader, BinWriter, encodeFrame } from "./bincode";
import {
  EndpointTerminalSession,
  cropFrame,
} from "./endpoint-terminal-session";
import type { CellData, FrameData } from "./thin-client";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function cell(symbol: string, over: Partial<CellData> = {}): CellData {
  return {
    symbol,
    fg: 0,
    bg: 0,
    modifier: 0,
    skip: false,
    hyperlink: null,
    ...over,
  };
}

function writeCell(w: BinWriter, c: CellData) {
  w.string(c.symbol);
  w.varint(c.fg);
  w.varint(c.bg);
  w.varint(c.modifier);
  w.bool(c.skip);
  w.option(c.hyperlink, (v) => w.varint(v));
}

function writeFrame(w: BinWriter, frame: FrameData) {
  w.varint(frame.cells.length);
  for (const c of frame.cells) writeCell(w, c);
  w.varint(frame.width);
  w.varint(frame.height);
  w.option(frame.cursor, (cur) => {
    w.varint(cur.x);
    w.varint(cur.y);
    w.bool(cur.visible);
    w.u8(cur.shape);
  });
  w.varint(frame.hyperlinks.length);
  for (const link of frame.hyperlinks) w.string(link);
  w.bytes(Buffer.alloc(0));
}

function writePane(w: BinWriter, paneId: string, x = 0, y = 0) {
  w.string(paneId);
  w.varint(1);
  for (const rect of [
    { x, y, width: 10, height: 5 },
    { x: x + 1, y: y + 1, width: 8, height: 3 },
  ]) {
    w.varint(rect.x);
    w.varint(rect.y);
    w.varint(rect.width);
    w.varint(rect.height);
  }
  w.bool(false);
  w.bool(true); // scroll metrics present
  w.varint(0); // offset_from_bottom
  w.varint(100); // max_offset_from_bottom
  w.varint(3); // viewport_rows
  w.bool(true); // focused
  w.bool(false);
  w.bool(false);
  w.bool(false);
  w.varint(0);
  w.varint(0);
}

function surfaceFrame(revision: number, frame: FrameData): Buffer {
  const w = new BinWriter();
  w.variant(13);
  w.string("boot-1");
  w.varint(1);
  w.varint(revision);
  writeFrame(w, frame);
  w.varint(1);
  writePane(w, "w1:p1");
  w.varint(0);
  w.bool(false);
  return w.toBuffer();
}

function controlFrame(kind: string, data: string): Buffer {
  const w = new BinWriter();
  w.variant(20);
  w.string(kind);
  w.string(data);
  return w.toBuffer();
}

const WELCOME = {
  generation: 1,
  server_version: "0.9.0",
  snapshot_codec: "shell.snapshot.v1",
  surface_codec: "shell.surface.v1",
  input_codec: "shell.input.semantic.v1",
  blob_codec: "shell.blob.v1",
  methods: ["pane.focus", "pane.scroll"],
  capabilities: ["health_check"],
};

/**
 * Fake endpoint server that answers the handshake, sends a snapshot, answers
 * endpoint requests, and streams a two-pane surface.
 */
async function startSessionServer(handlers: {
  onRequest?: (method: string, params: any) => void;
  onPaneInput?: (paneId: string, reader: BinReader) => void;
}) {
  const socketPath = path.join(
    tmpdir(),
    `herdr-gui-eps-${process.pid}-${crypto.randomUUID()}.sock`,
  );
  const frame: FrameData = {
    // Tab surface 10x5; pane w1:p1 inner rect is 1,1 8x3 => "abcdefgh" rows.
    cells: Array.from({ length: 50 }, (_, i) =>
      cell(String.fromCharCode(65 + (i % 26))),
    ),
    width: 10,
    height: 5,
    cursor: { x: 2, y: 2, visible: true, shape: 1 },
    hyperlinks: [],
  };
  const server = net.createServer((socket) => {
    let input = Buffer.alloc(0);
    let greeted = false;
    socket.on("data", (chunk) => {
      input = Buffer.concat([
        input,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      ]);
      while (input.length >= 4) {
        const length = input.readUInt32LE(0);
        if (input.length < length + 4) return;
        const reader = new BinReader(input.subarray(4, length + 4));
        input = input.subarray(length + 4);
        const variant = reader.variant();
        if (!greeted) {
          greeted = true;
          reader.string(); // kind
          reader.string(); // data
          socket.write(
            encodeFrame(
              controlFrame("endpoint.welcome.v1", JSON.stringify(WELCOME)),
            ),
          );
          socket.write(
            encodeFrame(
              controlFrame(
                "shell.snapshot.v1",
                JSON.stringify({ boot_id: "boot-1", revision: 1 }),
              ),
            ),
          );
          socket.write(encodeFrame(surfaceFrame(1, frame)));
          continue;
        }
        if (variant === 15) {
          // ClientShellEndpointRequest
          reader.string(); // boot_id
          const request = JSON.parse(reader.string());
          handlers.onRequest?.(request.method, request.params);
          const w = new BinWriter();
          w.variant(18); // ClientShellEndpointResponseChunk
          w.string("boot-1");
          w.string(request.id);
          w.bool(true);
          w.bytes(Buffer.from(JSON.stringify({ id: request.id, result: {} })));
          socket.write(encodeFrame(w.toBuffer()));
        } else if (variant === 13) {
          const paneId = reader.string();
          handlers.onPaneInput?.(paneId, reader);
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

describe("EndpointTerminalSession", () => {
  test("focuses the pane and emits cropped ANSI terminal frames", async () => {
    const requests: Array<{ method: string; params: any }> = [];
    const socketPath = await startSessionServer({
      onRequest: (method, params) => requests.push({ method, params }),
    });
    const session = new EndpointTerminalSession(
      socketPath,
      "term_1",
      async (terminalId) => (terminalId === "term_1" ? "w1:p1" : null),
    );
    const frames: Array<{
      width: number;
      height: number;
      full: boolean;
      text: string;
    }> = [];
    session.on("terminal", (t) =>
      frames.push({
        width: t.width,
        height: t.height,
        full: t.full,
        text: t.bytes.toString("utf8"),
      }),
    );
    await session.connect(80, 24);

    expect(requests).toEqual([
      { method: "pane.focus", params: { pane_id: "w1:p1" } },
    ]);
    expect(frames.length).toBeGreaterThan(0);
    const first = frames[0];
    expect(first.width).toBe(8);
    expect(first.height).toBe(3);
    expect(first.full).toBe(true);
    // Cropped content: inner rect starts at (1,1) of the 10x5 grid,
    // so the first row is cells 11-18 (L..S).
    expect(first.text).toContain("LMNOPQRS");
    // Cursor was at (2,2) in tab space -> (1,1) in crop space.
    expect(first.text).toContain("\x1b[2;2H");
    session.close();
  });

  test("rejects connect when the terminal has no pane", async () => {
    const socketPath = await startSessionServer({});
    const session = new EndpointTerminalSession(
      socketPath,
      "term_x",
      async () => null,
    );
    await expect(session.connect(80, 24)).rejects.toThrow("no pane found");
  });

  test("classifies input and sends pane.scroll with absolute offsets", async () => {
    const requests: Array<{ method: string; params: any }> = [];
    const inputs: string[] = [];
    const socketPath = await startSessionServer({
      onRequest: (method, params) => requests.push({ method, params }),
      onPaneInput: (paneId, reader) => {
        const count = reader.varint();
        for (let i = 0; i < count; i++) {
          const v = reader.variant();
          if (v === 1) inputs.push(`text:${reader.string()}`);
          else if (v === 3) inputs.push(`paste:${reader.string()}`);
          else inputs.push(`key:${v}`);
        }
      },
    });
    const session = new EndpointTerminalSession(
      socketPath,
      "term_1",
      async () => "w1:p1",
    );
    await session.connect(80, 24);
    session.input(Buffer.from("hi"));
    session.scroll("up", 3);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(inputs).toContain("text:hi");
    expect(requests).toContainEqual({
      method: "pane.scroll",
      params: { pane_id: "w1:p1", offset_from_bottom: 3 },
    });
    session.close();
  });
});

describe("cropFrame", () => {
  test("crops cells and repositions the cursor", () => {
    const frame: FrameData = {
      cells: Array.from({ length: 12 }, (_, i) => cell(String(i))),
      width: 4,
      height: 3,
      cursor: { x: 2, y: 1, visible: true, shape: 0 },
      hyperlinks: ["https://example.com"],
    };
    const cropped = cropFrame(frame, { x: 1, y: 1, width: 2, height: 2 });
    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect(cropped.cells.map((c) => c.symbol)).toEqual(["5", "6", "9", "10"]);
    expect(cropped.cursor).toEqual({ x: 1, y: 0, visible: true, shape: 0 });
    expect(cropped.hyperlinks).toEqual(["https://example.com"]);
  });

  test("drops an out-of-crop cursor and clamps the rect", () => {
    const frame: FrameData = {
      cells: Array.from({ length: 4 }, () => cell("x")),
      width: 2,
      height: 2,
      cursor: { x: 0, y: 0, visible: true, shape: 0 },
      hyperlinks: [],
    };
    const cropped = cropFrame(frame, { x: 1, y: 1, width: 99, height: 99 });
    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(1);
    expect(cropped.cursor).toBeNull();
  });
});
