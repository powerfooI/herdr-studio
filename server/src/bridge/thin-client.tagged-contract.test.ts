import { expect, test } from "bun:test";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "./bincode";
import { ThinClient } from "./thin-client";

// Literal bincode-standard payloads, independent of BinWriter. Contract source:
// herdr v0.9.0 b99002ac src/protocol/wire.rs TerminalHello/ClientMessage/
// ServerMessage (470-629, 1329-1450). Legacy protocol 20 retains its Hello fields
// and Terminal=2/Shutdown=4. These are hand-transcribed, not Rust-generated.
for (const protocol of [20, 22]) {
  test(`protocol ${protocol} tagged Hello/Welcome -> attach -> render/resize/input/paste/shutdown`, async () => {
    const socketPath = join(
      tmpdir(),
      `herdr-contract-${crypto.randomUUID()}.sock`,
    );
    const sockets = new Set<net.Socket>();
    const seen: string[] = [];
    const server = net.createServer((socket) => {
      sockets.add(socket);
      let input = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        input = Buffer.concat([input, Buffer.from(chunk)]);
        while (input.length >= 4) {
          const length = input.readUInt32LE(0);
          if (input.length < length + 4) return;
          const payload = input.subarray(4, length + 4);
          input = input.subarray(length + 4);
          seen.push(payload.toString("hex"));
          if (payload[0] === 0) {
            const welcome = encodeFrame(
              Buffer.from(protocol === 22 ? "00160100" : "00140100", "hex"),
            );
            // Deliberately fragment the length header.
            socket.write(welcome.subarray(0, 2));
            socket.write(welcome.subarray(2));
          } else if (payload[0] === 5) {
            socket.write(
              encodeFrame(
                Buffer.from(
                  protocol === 22
                    ? "0101641e010568656c6c6f"
                    : "0201641e010568656c6c6f",
                  "hex",
                ),
              ),
            );
          } else if (payload[0] === 1) {
            const payloads =
              protocol === 22
                ? [
                    "080100",
                    "080001",
                    "10fb000102",
                    "100000",
                    "03010874616b656f766572",
                  ]
                : ["04010874616b656f766572"];
            // Coalesce both mouse booleans, keyboard mode/reset and shutdown.
            socket.write(
              Buffer.concat(
                payloads.map((hex) => encodeFrame(Buffer.from(hex, "hex"))),
              ),
            );
          }
        }
      });
    });
    const client = new ThinClient(socketPath, async () => protocol);
    const errors: string[] = [];
    const mouse: unknown[] = [];
    const keyboard: unknown[] = [];
    client.on("error", (error) => errors.push(error.message));
    client.on("mouse_capture", (enabled, sgrPixels) =>
      mouse.push({ enabled, sgrPixels }),
    );
    client.on("keyboard_protocol", (mode) => keyboard.push(mode));
    const terminal = new Promise<unknown>((resolve) =>
      client.once("terminal", resolve),
    );
    const closed = new Promise<void>((resolve) =>
      client.once("close", resolve),
    );
    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      await client.connect(100, 30, {
        launchMode: "terminal-attach",
        encoding: 1,
      });
      expect(seen).toEqual([
        protocol === 22 ? "0016641e000000" : "0014641e0000010002",
      ]);
      client.attach("term_1", true);
      expect(await terminal).toEqual({
        seq: 1,
        width: 100,
        height: 30,
        full: true,
        bytes: Buffer.from("hello"),
      });
      client.resize(120, 40);
      client.input(Buffer.from("abc\x1b[200~paste\x1b[201~"));
      await closed;
      expect(seen.slice(1)).toEqual([
        "05067465726d5f3101",
        protocol === 22 ? "037828000000" : "0378280000",
        "01146162631b5b3230307e70617374651b5b3230317e",
      ]);
      expect(errors).toEqual(["takeover"]);
      expect(client.isClosed).toBe(true);
      expect(mouse).toEqual(
        protocol === 22
          ? [
              { enabled: true, sgrPixels: false },
              { enabled: false, sgrPixels: true },
            ]
          : [],
      );
      expect(keyboard).toEqual(
        protocol === 22
          ? [
              { flags: 256, modifyOtherKeysLevel: 2 },
              { flags: 0, modifyOtherKeysLevel: 0 },
            ]
          : [],
      );
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
