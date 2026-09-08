import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { BinReader, BinWriter, encodeFrame } from "./bincode";
import { EndpointClient, type EndpointSurface } from "./endpoint-client";
import type { CellData, FrameData } from "./thin-client";

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

const WELCOME = {
  generation: 1,
  server_version: "0.9.0",
  snapshot_codec: "shell.snapshot.v1",
  surface_codec: "shell.surface.v1",
  input_codec: "shell.input.semantic.v1",
  blob_codec: "shell.blob.v1",
  methods: ["pane.focus"],
  capabilities: ["surface_interest", "health_check"],
};

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
  w.bytes(Buffer.alloc(0)); // graphics
}

function writePane(w: BinWriter, paneId: string, focused = true) {
  w.string(paneId);
  w.varint(1); // content_revision
  for (const rect of [
    { x: 0, y: 0, width: 10, height: 5 },
    { x: 0, y: 0, width: 10, height: 5 },
  ]) {
    w.varint(rect.x);
    w.varint(rect.y);
    w.varint(rect.width);
    w.varint(rect.height);
  }
  w.bool(false); // scrollbar_rect
  w.bool(false); // scroll metrics
  w.bool(focused);
  w.bool(false); // mouse_reporting
  w.bool(false); // sgr_pixel_mouse
  w.bool(false); // alternate_screen_active
  w.varint(0); // pixel_width
  w.varint(0); // pixel_height
}

function surfaceFrame(payload: {
  surfaceRevision: number;
  frame: FrameData;
}): Buffer {
  const w = new BinWriter();
  w.variant(13); // PaneSurface
  w.string("boot-1");
  w.varint(1); // projection_revision
  w.varint(payload.surfaceRevision);
  writeFrame(w, payload.frame);
  w.varint(1); // one pane
  writePane(w, "w1:p1");
  w.varint(0); // splits
  w.bool(false); // popup
  // SurfaceGraphicsScene tail: the client stops reading before it.
  return w.toBuffer();
}

function patchFrame(payload: {
  baseSurfaceRevision: number;
  surfaceRevision: number;
  rows: Array<{ x: number; y: number; cells: CellData[] }>;
  cursor?: { x: number; y: number; visible: boolean; shape: number };
}): Buffer {
  const w = new BinWriter();
  w.variant(19); // PaneSurfacePatch
  w.string("boot-1");
  w.varint(1);
  w.varint(payload.baseSurfaceRevision);
  w.varint(payload.surfaceRevision);
  w.varint(payload.rows.length);
  for (const row of payload.rows) {
    w.varint(row.x);
    w.varint(row.y);
    w.varint(row.cells.length);
    for (const c of row.cells) writeCell(w, c);
  }
  w.varint(1);
  writePane(w, "w1:p1");
  w.option(payload.cursor, (cur) => {
    w.varint(cur.x);
    w.varint(cur.y);
    w.bool(cur.visible);
    w.u8(cur.shape);
  });
  return w.toBuffer();
}

function controlFrame(kind: string, data: string): Buffer {
  const w = new BinWriter();
  w.variant(20);
  w.string(kind);
  w.string(data);
  return w.toBuffer();
}

/**
 * Fake endpoint server: expects endpoint.hello.v1 as the first message, then
 * replies with the welcome and runs the given script.
 */
async function startEndpointServer(
  onHello: (hello: any, socket: net.Socket) => void,
  onMessage?: (variant: number, reader: BinReader, socket: net.Socket) => void,
  sendSnapshot = true,
) {
  const socketPath = path.join(
    tmpdir(),
    `herdr-gui-endpoint-${process.pid}-${crypto.randomUUID()}.sock`,
  );
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
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
          expect(variant).toBe(20);
          expect(reader.string()).toBe("endpoint.hello.v1");
          const hello = JSON.parse(reader.string());
          expect(reader.remaining).toBe(0);
          socket.write(
            encodeFrame(
              controlFrame("endpoint.welcome.v1", JSON.stringify(WELCOME)),
            ),
          );
          if (sendSnapshot) {
            socket.write(
              encodeFrame(
                controlFrame(
                  "shell.snapshot.v1",
                  JSON.stringify({ boot_id: "boot-1", revision: 1 }),
                ),
              ),
            );
          }
          onHello(hello, socket);
          continue;
        }
        onMessage?.(variant, reader, socket);
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

describe("EndpointClient (endpoint generation 1)", () => {
  test("sends a generation-1 hello with the required codecs", async () => {
    const socketPath = await startEndpointServer(() => {});
    const client = new EndpointClient(socketPath);
    const welcome = new Promise<any>((resolve) =>
      client.once("welcome", resolve),
    );
    await client.connect(100, 30);
    const w = await welcome;
    expect(w.serverVersion).toBe("0.9.0");
    expect(w.capabilities).toEqual(["surface_interest", "health_check"]);
    client.close();
  });

  test("waits for a valid snapshot after welcome before becoming ready", async () => {
    let peer!: net.Socket;
    const socketPath = await startEndpointServer(
      (_hello, socket) => {
        peer = socket;
      },
      undefined,
      false,
    );
    const client = new EndpointClient(socketPath);
    const welcome = new Promise<void>((resolve) =>
      client.once("welcome", resolve),
    );
    let ready = false;
    const connecting = client.connect(80, 24).then(() => {
      ready = true;
    });
    try {
      await welcome;
      expect(ready).toBe(false);
      const invalidSnapshot = new Promise<void>((resolve) =>
        client.once("snapshot", resolve),
      );
      peer.write(
        encodeFrame(controlFrame("shell.snapshot.v1", '{"boot_id":42}')),
      );
      await invalidSnapshot;
      expect(ready).toBe(false);
      peer.write(
        encodeFrame(controlFrame("shell.snapshot.v1", '{"boot_id":"boot-1"}')),
      );
      await connecting;
      expect(ready).toBe(true);
    } finally {
      client.close();
    }
  });

  test("rejects startup when the peer closes before the snapshot", async () => {
    const socketPath = await startEndpointServer(
      (_hello, socket) => socket.end(),
      undefined,
      false,
    );
    const client = new EndpointClient(socketPath);
    try {
      await expect(client.connect(80, 24)).rejects.toThrow("closed");
    } finally {
      client.close();
    }
  });

  test("times out if welcome is not followed by a snapshot", async () => {
    const socketPath = await startEndpointServer(() => {}, undefined, false);
    const client = new EndpointClient(socketPath);
    try {
      await expect(client.connect(80, 24)).rejects.toThrow(
        "welcome and snapshot",
      );
      expect(client.isClosed).toBe(true);
    } finally {
      client.close();
    }
  }, 12_000);

  test.each(["peer", "client"])(
    "rejects pending and new requests when the %s closes",
    async (closer) => {
      const socketPath = await startEndpointServer(
        () => {},
        (variant, _reader, socket) => {
          if (variant === 15 && closer === "peer") socket.end();
        },
      );
      const client = new EndpointClient(socketPath);
      try {
        await client.connect(80, 24);
        const pending = client.callEndpoint("pane.focus", { pane_id: "w1:p1" });
        if (closer === "client") client.close();
        await expect(pending).rejects.toThrow("closed");
        expect(client.isClosed).toBe(true);
        await expect(client.callEndpoint("pane.scroll", {})).rejects.toThrow(
          "closed",
        );
      } finally {
        client.close();
      }
    },
  );

  test("composes full surfaces and applies patches on the matching base", async () => {
    const base: FrameData = {
      cells: Array.from({ length: 20 }, () => cell(" ")),
      width: 10,
      height: 2,
      cursor: null,
      hyperlinks: [],
    };
    const socketPath = await startEndpointServer((_hello, socket) => {
      socket.write(
        encodeFrame(surfaceFrame({ surfaceRevision: 1, frame: base })),
      );
      socket.write(
        encodeFrame(
          patchFrame({
            baseSurfaceRevision: 1,
            surfaceRevision: 2,
            rows: [{ x: 2, y: 1, cells: [cell("h"), cell("i")] }],
            cursor: { x: 4, y: 1, visible: true, shape: 1 },
          }),
        ),
      );
      // Stale patch: wrong base must be dropped.
      socket.write(
        encodeFrame(
          patchFrame({
            baseSurfaceRevision: 1,
            surfaceRevision: 3,
            rows: [{ x: 0, y: 0, cells: [cell("X")] }],
          }),
        ),
      );
    });
    const client = new EndpointClient(socketPath);
    const surfaces: EndpointSurface[] = [];
    client.on("surface", (s) => surfaces.push(s));
    await client.connect(10, 2);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(surfaces.length).toBe(2);
    expect(surfaces[0].surfaceRevision).toBe(1);
    expect(surfaces[0].panes).toEqual([
      {
        paneId: "w1:p1",
        rect: { x: 0, y: 0, width: 10, height: 5 },
        innerRect: { x: 0, y: 0, width: 10, height: 5 },
        scroll: null,
        focused: true,
      },
    ]);
    const patched = surfaces[1];
    expect(patched.surfaceRevision).toBe(2);
    expect(patched.frame.cells[12].symbol).toBe("h");
    expect(patched.frame.cells[13].symbol).toBe("i");
    expect(patched.frame.cells[0].symbol).toBe(" ");
    // Earlier emitted frames stay immutable for retained consumers.
    expect(surfaces[0].frame.cells[12].symbol).toBe(" ");
    expect(patched.frame.cursor).toEqual({
      x: 4,
      y: 1,
      visible: true,
      shape: 1,
    });
    client.close();
  });

  test("encodes resize and answers health pings with a pong", async () => {
    const seen: Array<{ variant: number; fields: unknown[] }> = [];
    const socketPath = await startEndpointServer(
      (_hello, socket) => {
        socket.write(
          encodeFrame(controlFrame("endpoint.health.ping.v1", "{}")),
        );
      },
      (variant, reader, socket) => {
        if (variant === 12) {
          seen.push({
            variant,
            fields: [
              reader.varint(),
              reader.varint(),
              reader.varint(),
              reader.varint(),
              reader.bool(),
            ],
          });
        } else if (variant === 20) {
          seen.push({ variant, fields: [reader.string(), reader.string()] });
          socket.write(
            encodeFrame(controlFrame("endpoint.health.pong.v1", "{}")),
          );
        }
      },
    );
    const client = new EndpointClient(socketPath);
    await client.connect(100, 30);
    client.resize(80, 24);
    client.ping();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(seen).toContainEqual({ variant: 12, fields: [0, 0, 80, 24, false] });
    expect(seen).toContainEqual({
      variant: 20,
      fields: ["endpoint.health.ping.v1", "{}"],
    });
    // The client's pong reply to the server ping.
    expect(seen).toContainEqual({
      variant: 20,
      fields: ["endpoint.health.pong.v1", "{}"],
    });
    client.close();
  });

  test("rejects when the welcome carries a handshake error", async () => {
    const socketPath = path.join(
      tmpdir(),
      `herdr-gui-endpoint-err-${process.pid}-${crypto.randomUUID()}.sock`,
    );
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write(
          encodeFrame(
            controlFrame(
              "endpoint.welcome.v1",
              JSON.stringify({
                ...WELCOME,
                methods: [],
                capabilities: [],
                error: {
                  code: "unsupported_generation",
                  message: "endpoint generation 2 is unsupported",
                },
              }),
            ),
          ),
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const client = new EndpointClient(socketPath);
    await expect(client.connect(100, 30)).rejects.toThrow(
      "unsupported_generation",
    );
  });
});
