import { EndpointClient } from "./bridge/endpoint-client";

// Live probe for the stable endpoint path (Herdr >= 0.9.0). Usage:
//   bun run server/src/probe-endpoint.ts [client-socket-path]

const sockPath =
  process.argv[2] ??
  `${process.env.HOME}/.config/herdr/sessions/endpoint-spike/herdr-client.sock`;

const c = new EndpointClient(sockPath);
let surfaces = 0;
c.on("welcome", (w) =>
  console.log(
    `WELCOME ${w.serverVersion} methods=${w.methods.length} caps=${w.capabilities.join(",")}`,
  ),
);
c.on("snapshot", (s) =>
  console.log(`SNAPSHOT boot=${s.bootId} rev=${s.revision}`),
);
c.on("surface", (s) => {
  surfaces++;
  if (surfaces > 3) return;
  console.log(
    `SURFACE #${surfaces} rev=${s.surfaceRevision} ${s.frame.width}x${s.frame.height} ` +
      `panes=${s.panes.map((p: { paneId: string; rect: { x: number; y: number; width: number; height: number }; focused: boolean }) => `${p.paneId}@${p.rect.x},${p.rect.y} ${p.rect.width}x${p.rect.height}${p.focused ? "*" : ""}`).join("|")} ` +
      `cursor=${s.frame.cursor ? `${s.frame.cursor.x},${s.frame.cursor.y}` : "none"}`,
  );
});
c.on("shell_error", (m) => console.log("SHELL_ERROR", m));
c.on("error", (e) => console.log("ERROR", (e as Error).message));
c.on("close", () => console.log("CLOSED"));

await c.connect(Number(process.argv[3] ?? 100), Number(process.argv[4] ?? 30));
setTimeout(() => {
  console.log("done, surfaces:", surfaces);
  c.close();
  process.exit(0);
}, 5000);
