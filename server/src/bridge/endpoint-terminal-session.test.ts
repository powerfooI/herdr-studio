import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as net from "node:net";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { BinReader, BinWriter, encodeFrame } from "./bincode";
import {
  EndpointTerminalSession,
  cropFrame,
} from "./endpoint-terminal-session";
import type { CellData, FrameData } from "./thin-client";
import type { ServerWebSocket } from "bun";
import { createTerminalBridge } from "./terminal-bridge";
import { silentLogger } from "../utils/logger";

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

type TestPane = { paneId: string; x: number; mouseReporting: boolean };
const DEFAULT_PANES: TestPane[] = [
  { paneId: "w1:p1", x: 0, mouseReporting: false },
];

function writePane(
  w: BinWriter,
  paneId: string,
  x = 0,
  y = 0,
  mouseReporting = false,
) {
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
  w.bool(mouseReporting);
  w.bool(false);
  w.bool(false);
  w.varint(0);
  w.varint(0);
}

function surfaceFrame(
  revision: number,
  frame: FrameData,
  panes = DEFAULT_PANES,
): Buffer {
  const w = new BinWriter();
  w.variant(13);
  w.string("boot-1");
  w.varint(1);
  w.varint(revision);
  writeFrame(w, frame);
  w.varint(panes.length);
  for (const pane of panes)
    writePane(w, pane.paneId, pane.x, 0, pane.mouseReporting);
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
  panes?: TestPane[];
  onConnection?: (sendSurface: (panes: TestPane[]) => void) => void;
  onClipboardConnection?: (send: (data: string) => void) => void;
}) {
  const socketPath = path.join(
    tmpdir(),
    `herdr-gui-eps-${process.pid}-${crypto.randomUUID()}.sock`,
  );
  const frame: FrameData = {
    // Tab surface 10x5; pane w1:p1 inner rect is 1,1 8x3 => "abcdefgh" rows.
    cells: Array.from({ length: handlers.panes ? 100 : 50 }, (_, i) =>
      cell(String.fromCharCode(65 + (i % 26))),
    ),
    width: handlers.panes ? 20 : 10,
    height: 5,
    cursor: { x: 2, y: 2, visible: true, shape: 1 },
    hyperlinks: [],
  };
  const server = net.createServer((socket) => {
    handlers.onClipboardConnection?.((data) => {
      const w = new BinWriter();
      w.variant(5);
      w.string(data);
      socket.write(encodeFrame(w.toBuffer()));
    });
    let input = Buffer.alloc(0);
    let greeted = false;
    let revision = 1;
    handlers.onConnection?.((panes) =>
      socket.write(encodeFrame(surfaceFrame(++revision, frame, panes))),
    );
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
          socket.write(encodeFrame(surfaceFrame(1, frame, handlers.panes)));
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
        expect(paneId).toBe("w1:p1");
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

test("endpoint mouse stays pane-local and mode changes route application input versus history", async () => {
  const panes: TestPane[] = [
    { paneId: "w1:p1", x: 0, mouseReporting: false },
    { paneId: "w1:p2", x: 10, mouseReporting: true },
  ];
  const inputs: Array<{
    paneId: string;
    kind: number;
    column: number;
    row: number;
  }> = [];
  const requests: Array<{ method: string; params: unknown }> = [];
  const senders: Array<(panes: TestPane[]) => void> = [];
  const socketPath = await startSessionServer({
    panes,
    onConnection: (send) => senders.push(send),
    onRequest: (method, params) => requests.push({ method, params }),
    onPaneInput: (paneId, reader) => {
      const count = reader.varint();
      for (let i = 0; i < count; i++) {
        expect(reader.variant()).toBe(2);
        const kind = reader.variant();
        if (kind <= 2) reader.variant();
        expect(reader.variant()).toBe(0);
        const column = reader.varint();
        const row = reader.varint();
        expect(reader.bool()).toBe(false);
        reader.u8();
        reader.varint();
        inputs.push({ paneId, kind, column, row });
      }
    },
  });
  const left = new EndpointTerminalSession(
    socketPath,
    "term-left",
    async () => "w1:p1",
  );
  const right = new EndpointTerminalSession(
    socketPath,
    "term-right",
    async () => "w1:p2",
  );
  const modes: boolean[] = [];
  right.on("terminal", (frame) => modes.push(frame.mouseReporting));
  try {
    await left.connect(20, 5);
    await right.connect(20, 5);
    const clickDragWheel = Buffer.from(
      "\x1b[<0;2;3M\x1b[<32;3;2M\x1b[<0;3;2m\x1b[<64;8;3M",
    );
    left.input(clickDragWheel); // no mouse reporting in this pane
    right.input(clickDragWheel);
    right.input(Buffer.from("\x1b[<0;9;1M\x1b[<0;1;4M")); // outside 8x3 crop
    right.scroll("down", 3, 1, 2);
    left.scroll("up", 3, 1, 2);
    await Bun.sleep(40);
    expect(inputs).toEqual([
      { paneId: "w1:p2", kind: 0, column: 1, row: 2 },
      { paneId: "w1:p2", kind: 2, column: 2, row: 1 },
      { paneId: "w1:p2", kind: 1, column: 2, row: 1 },
      { paneId: "w1:p2", kind: 4, column: 7, row: 2 },
      { paneId: "w1:p2", kind: 5, column: 1, row: 2 },
    ]);
    expect(requests).toContainEqual({
      method: "pane.scroll",
      params: { pane_id: "w1:p1", offset_from_bottom: 3 },
    });
    // Disable reporting mid-report; no stale mouse is delivered after the mode change.
    right.input(Buffer.from("\x1b[<0;"));
    const disabled = panes.map((pane) => ({ ...pane, mouseReporting: false }));
    for (const send of senders) send(disabled);
    await Bun.sleep(40);
    right.input(Buffer.from("2;3M"));
    right.scroll("up", 4, 1, 2);
    right.scroll("up", Number.NaN);
    await Bun.sleep(40);
    expect(inputs).toHaveLength(5);
    expect(modes).toContain(true);
    expect(modes.at(-1)).toBe(false);
    expect(requests).toContainEqual({
      method: "pane.scroll",
      params: { pane_id: "w1:p2", offset_from_bottom: 4 },
    });
    for (const send of senders) send(panes);
    await Bun.sleep(40);
    right.input(Buffer.from("\x1b[<0;1;1M"));
    left.input(Buffer.from("\x1b[<0;1;1M"));
    await Bun.sleep(40);
    expect(inputs.at(-1)).toEqual({
      paneId: "w1:p2",
      kind: 0,
      column: 0,
      row: 0,
    });
    expect(inputs).toHaveLength(6);
  } finally {
    left.close();
    right.close();
  }
});

test("accepted presses retain clamped drag and release ownership outside the pane crop", async () => {
  const panes: TestPane[] = [
    { paneId: "w1:p1", x: 0, mouseReporting: true },
    { paneId: "w1:p2", x: 10, mouseReporting: true },
  ];
  const inputs: Array<{
    paneId: string;
    kind: number;
    column: number;
    row: number;
  }> = [];
  let sendSurface!: (panes: TestPane[]) => void;
  const socketPath = await startSessionServer({
    panes,
    onConnection: (send) => {
      sendSurface = send;
    },
    onPaneInput: (paneId, reader) => {
      const count = reader.varint();
      for (let i = 0; i < count; i++) {
        expect(reader.variant()).toBe(2);
        const kind = reader.variant();
        reader.variant(); // button
        expect(reader.variant()).toBe(0);
        const column = reader.varint(),
          row = reader.varint();
        reader.bool();
        reader.u8();
        reader.varint();
        inputs.push({ paneId, kind, column, row });
      }
    },
  });
  const session = new EndpointTerminalSession(
    socketPath,
    "right",
    async () => "w1:p2",
  );
  try {
    await session.connect(20, 5);
    session.input(Buffer.from("\x1b[<0;8;3M\x1b[<32;9;3M\x1b[<0;9;3m"));
    await Bun.sleep(40);
    expect(inputs).toEqual(
      [0, 2, 1].map((kind) => ({ paneId: "w1:p2", kind, column: 7, row: 2 })),
    );
    session.input(Buffer.from("\x1b[<0;9;3M\x1b[<32;8;3M\x1b[<0;8;3m"));
    await Bun.sleep(40);
    expect(inputs).toHaveLength(3); // an outside press cannot acquire ownership
    session.input(Buffer.from("\x1b[<0;8;3M"));
    await Bun.sleep(40);
    sendSurface(panes.map((pane) => ({ ...pane, mouseReporting: false })));
    await Bun.sleep(40);
    sendSurface(panes);
    await Bun.sleep(40);
    session.input(Buffer.from("\x1b[<32;9;3M\x1b[<0;9;3m"));
    await Bun.sleep(40);
    expect(inputs).toHaveLength(4); // mode changes cancel gesture ownership
  } finally {
    session.close();
  }
});

test("terminal bridge carries endpoint mouse state and targets each attached terminal explicitly", async () => {
  const inputs: string[] = [];
  const scrollRequests: unknown[] = [];
  const socketPath = await startSessionServer({
    onRequest: (method, params) => {
      if (method === "pane.scroll") scrollRequests.push(params);
    },
    panes: [
      { paneId: "w1:p1", x: 0, mouseReporting: true },
      { paneId: "w1:p2", x: 10, mouseReporting: true },
    ],
    onPaneInput: (paneId) => inputs.push(paneId),
  });
  const frames: Array<{ terminal_id: string; mouse_reporting: boolean }> = [];
  const errors: string[] = [];
  const ws = {} as ServerWebSocket<unknown>;
  const bridge = createTerminalBridge({
    clientSocketPath: socketPath,
    herdrProtocol: async () => 22,
    lookupPaneId: async (id) => (id === "left" ? "w1:p1" : "w1:p2"),
    safeSend: (_ws, payload) => {
      const message = JSON.parse(payload);
      if (message.terminal) frames.push(message.terminal);
      return true;
    },
    clientLabel: () => "test",
    markRpcError: (_ws, _id, detail) => errors.push(detail ?? "error"),
  });
  try {
    for (const terminalId of ["left", "right"]) {
      await bridge.handleTerminalRpc(ws, "attach", "terminal.attach", {
        terminal_id: terminalId,
        cols: 20,
        rows: 5,
        relay_active: false,
      });
    }
    expect(frames).toContainEqual(
      expect.objectContaining({ terminal_id: "left", mouse_reporting: true }),
    );
    expect(frames).toContainEqual(
      expect.objectContaining({ terminal_id: "right", mouse_reporting: true }),
    );
    for (const terminalId of ["left", "right", "unattached"]) {
      await bridge.handleTerminalRpc(ws, "input", "terminal.input", {
        terminal_id: terminalId,
        data: Buffer.from("\x1b[<0;2;2M").toString("base64"),
      });
    }
    await Bun.sleep(40);
    expect(inputs).toEqual(["w1:p1", "w1:p2"]);
    expect(errors).toHaveLength(1);
    for (const [direction, source] of [
      ["up", "history"],
      ["down", "history"],
      ["up", "page-key"],
    ]) {
      await bridge.handleTerminalRpc(ws, "history", "terminal.scroll", {
        terminal_id: "right",
        direction,
        lines: 7,
        source,
      });
    }
    await Bun.sleep(40);
    expect(scrollRequests).toEqual([
      { pane_id: "w1:p2", offset_from_bottom: 7 },
      { pane_id: "w1:p2", offset_from_bottom: 0 },
      { pane_id: "w1:p2", offset_from_bottom: 7 },
    ]);
    expect(inputs).toHaveLength(2);
  } finally {
    bridge.dispose();
  }
});

test("endpoint clipboard follows foreground-recipient ownership, not producing PTY identity", async () => {
  const peers: Array<(data: string) => void> = [];
  const sessions: EndpointTerminalSession[] = [];
  const originalConnect = EndpointTerminalSession.prototype.connect;
  const connect = spyOn(
    EndpointTerminalSession.prototype,
    "connect",
  ).mockImplementation(function (
    this: EndpointTerminalSession,
    cols: number,
    rows: number,
  ) {
    sessions.push(this);
    return originalConnect.call(this, cols, rows);
  });
  const socketPath = await startSessionServer({
    panes: [
      { paneId: "w1:p1", x: 0, mouseReporting: false },
      { paneId: "w1:p2", x: 10, mouseReporting: false },
    ],
    onClipboardConnection: (send) => peers.push(send),
  });
  const ownerA = {} as ServerWebSocket<unknown>;
  const ownerB = {} as ServerWebSocket<unknown>;
  const passive = {} as ServerWebSocket<unknown>;
  const received: Array<{ ws: ServerWebSocket<unknown>; message: any }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const makeBridge = (connectionId: string, connectionGeneration = 1) =>
    createTerminalBridge({
      connectionId,
      connectionGeneration,
      clientSocketPath: socketPath,
      herdrProtocol: async () => 22,
      lookupPaneId: async (id) => (id === "left" ? "w1:p1" : "w1:p2"),
      logger: { ...silentLogger, warn: (message) => warnings.push(message) },
      safeSend: (ws, payload) => {
        const message = JSON.parse(payload);
        if (message.terminal_clipboard) received.push({ ws, message });
        return true;
      },
      clientLabel: () => "test",
      markRpcError: (_ws, _id, detail) => errors.push(detail ?? "error"),
    });
  const alpha = makeBridge("alpha");
  const beta = makeBridge("beta");
  const attach = (
    bridge: typeof alpha,
    ws: typeof ownerA,
    terminal_id: string,
  ) =>
    bridge.handleTerminalRpc(ws, "attach", "terminal.attach", {
      terminal_id,
      cols: 20,
      rows: 5,
    });
  const input = (
    bridge: typeof alpha,
    ws: typeof ownerA,
    terminal_id: string,
  ) =>
    bridge.handleTerminalRpc(ws, "input", "terminal.input", {
      terminal_id,
      data: "eA==",
    });
  const deliver = async (peer: number, data = "Y29weQ==") => {
    peers[peer](data);
    await Bun.sleep(20);
  };
  try {
    await attach(alpha, ownerA, "left");
    await attach(alpha, passive, "left");
    await attach(alpha, ownerB, "right");
    await attach(beta, ownerA, "left"); // duplicate ids and same browser, separate connection
    expect(warnings.some((message) => message.includes("unavailable"))).toBe(
      false,
    );
    await deliver(0); // no recent input
    expect(received).toEqual([]);
    await input(alpha, ownerA, "left");
    await deliver(0);
    expect(received).toEqual([
      {
        ws: ownerA,
        message: {
          connection_id: "alpha",
          connection_generation: 1,
          terminal_clipboard: { terminal_id: "left", data: "Y29weQ==" },
        },
      },
    ]);
    received.length = 0;
    await input(alpha, ownerB, "right");
    await deliver(0); // receiving left session no longer matches global input owner
    await deliver(2); // beta has no owner, despite same terminal/browser ids
    expect(received).toEqual([]);
    // Herdr may send a delayed/background LEFT PTY write to foreground RIGHT.
    // The wire has no source id: approved semantics deliver to B, not A.
    const delayedLeft = Buffer.from("delayed left PTY content").toString(
      "base64",
    );
    await deliver(1, delayedLeft);
    expect(received).toEqual([
      {
        ws: ownerB,
        message: {
          connection_id: "alpha",
          connection_generation: 1,
          terminal_clipboard: { terminal_id: "right", data: delayedLeft },
        },
      },
    ]);
    received.length = 0;
    for (const data of ["?", "invalid", "A".repeat(256 * 1024 + 4)])
      await deliver(1, data);
    expect(received).toEqual([]);
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now + 30_001);
    try {
      sessions[1].emit("clipboard", { data: "Y29weQ==" });
    } finally {
      clock.mockRestore();
    }
    expect(received).toEqual([]);
    await input(beta, ownerA, "left");
    await deliver(2);
    expect(received[0].message.connection_id).toBe("beta");
    received.length = 0;
    // Detach one pane while this browser still views another; reattach must
    // not resurrect its prior input owner, even with the same shared session.
    await attach(alpha, ownerA, "right");
    await input(alpha, ownerA, "left");
    await alpha.handleTerminalRpc(ownerA, "detach", "terminal.detach", {
      terminal_id: "left",
    });
    await attach(alpha, ownerA, "left");
    await deliver(0);
    expect(received).toEqual([]);
    await input(alpha, ownerA, "left");
    // A closed transport cannot pass a queued clipboard event to a replacement.
    sessions[0].close();
    await Bun.sleep(20);
    await attach(alpha, ownerA, "left");
    sessions[0].emit("clipboard", { data: "Y29weQ==" });
    await deliver(3);
    expect(received).toEqual([]);
    await input(alpha, ownerA, "left");
    sessions[0].emit("clipboard", { data: "Y29weQ==" });
    expect(received).toEqual([]);
    await deliver(3);
    expect(received).toHaveLength(1);
    expect(received[0].ws).toBe(ownerA);
    received.length = 0;
    alpha.cleanupWs(ownerA);
    sessions[3].emit("clipboard", { data: "Y29weQ==" });
    expect(received).toEqual([]);
    alpha.dispose();
    const replacement = makeBridge("alpha", 2);
    try {
      await attach(replacement, ownerA, "left");
      await input(replacement, ownerA, "left");
      sessions[3].emit("clipboard", { data: "Y29weQ==" });
      expect(received).toEqual([]);
      await deliver(4);
      expect(received[0].message.connection_generation).toBe(2);
      expect(received).toHaveLength(1);
    } finally {
      replacement.dispose();
    }
    expect(received.some(({ ws }) => ws === passive)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    alpha.dispose();
    beta.dispose();
    connect.mockRestore();
  }
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
