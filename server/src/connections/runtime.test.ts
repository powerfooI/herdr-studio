import { expect, test } from "bun:test";
import { createLastStepBaselineStore } from "../workspace/git-diff";
import { createLegacyConnectionRuntime } from "./runtime";

test("legacy runtime exposes and reports its configured connection identity", async () => {
  const events: Array<{ event: unknown; connectionId: string }> = [];
  const errors: Array<{ error: unknown; connectionId: string }> = [];
  const runtime = createLegacyConnectionRuntime({
    identity: { id: "remote-dev", label: "Remote Dev", source: "test" },
    config: {
      socketPath: "/tmp/m3-runtime-control.sock",
      clientSocketPath: "/tmp/m3-runtime-client.sock",
      sshHost: undefined,
      session: undefined,
      hasExplicitSocketPath: true,
      hasExplicitClientSocketPath: true,
    },
    safeSend: () => true,
    clientLabel: () => "browser",
    markRpcError: () => undefined,
    onEvent: (event, identity) => {
      events.push({ event, connectionId: identity.id });
    },
    onError: (error, identity) => {
      errors.push({ error, connectionId: identity.id });
    },
  });

  const event = { event: "workspace.updated", data: { workspace_id: "same" } };
  const error = new Error("downstream failed");
  runtime.herdr.emit("event", event);
  runtime.herdr.emit("error", error);

  expect(runtime.identity).toEqual({
    id: "remote-dev",
    label: "Remote Dev",
    source: "test",
  });
  expect(events).toEqual([{ event, connectionId: "remote-dev" }]);
  expect(errors).toEqual([{ error, connectionId: "remote-dev" }]);
  const stopping = runtime.stop();
  runtime.herdr.emit("event", {
    event: "pane.agent_status_changed",
    data: {
      pane_id: "w1:p1",
      workspace_id: "w1",
      agent_status: "working",
    },
  });
  await stopping;
  expect(events).toEqual([{ event, connectionId: "remote-dev" }]);
});

test("runtime stop drains an in-flight completion and suppresses publication", async () => {
  const tree = "a".repeat(40);
  let snapshotCall = 0;
  let releaseCompletion: () => void = () => undefined;
  let signalCompletion: () => void = () => undefined;
  const completionStarted = new Promise<void>((resolve) => {
    signalCompletion = resolve;
  });
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  const baselines = createLastStepBaselineStore({
    shQuote: (value) => `'${value}'`,
    runProcessWithCodeTimeout: async () => {
      snapshotCall += 1;
      if (snapshotCall === 2) {
        signalCompletion();
        await completionGate;
      }
      return { code: 0, stdout: `${tree}\n`, stderr: "" };
    },
  });
  const events: unknown[] = [];
  const runtime = createLegacyConnectionRuntime({
    config: {
      socketPath: "/tmp/m3-runtime-stop-control.sock",
      clientSocketPath: "/tmp/m3-runtime-stop-client.sock",
      sshHost: undefined,
      session: undefined,
      hasExplicitSocketPath: true,
      hasExplicitClientSocketPath: true,
    },
    safeSend: () => true,
    clientLabel: () => "browser",
    markRpcError: () => undefined,
    onEvent: (event) => events.push(event),
    lastStepBaselines: baselines,
    resolveLastStepWorkspaceGitRoot: async () => "/repo",
    lastStepTransitionDebounceMs: 0,
  });

  runtime.herdr.emit("event", {
    event: "pane.agent_status_changed",
    data: {
      pane_id: "w1:p1",
      workspace_id: "w1",
      agent_status: "working",
    },
  });
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  runtime.herdr.emit("event", {
    event: "pane.agent_status_changed",
    data: {
      pane_id: "w1:p1",
      workspace_id: "w1",
      agent_status: "idle",
    },
  });
  await completionStarted;

  let stopped = false;
  const stopping = runtime.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  releaseCompletion();
  await stopping;

  expect(
    events.some(
      (event) =>
        (event as { event?: unknown }).event ===
        "workspace.last_step_completed",
    ),
  ).toBe(false);
  await expect(
    baselines.captureWorkspace("w1", async () => "/repo"),
  ).rejects.toMatchObject({ code: "LAST_STEP_STORE_DISPOSED" });
});

test("layout subscription ACK and reconnect request browser reconciliation", async () => {
  const events: unknown[] = [];
  const subscriptions: Array<{ ack: () => void; close: () => void }> = [];
  const runtime = createLegacyConnectionRuntime({
    config: {
      socketPath: "/tmp/unused-layout-contract-control.sock",
      clientSocketPath: "/tmp/unused-layout-contract-client.sock",
      hasExplicitSocketPath: true,
      hasExplicitClientSocketPath: true,
    },
    safeSend: () => true,
    clientLabel: () => "test",
    markRpcError: () => undefined,
    onEvent: (event) => events.push(event),
  });
  // No real sockets, settings-driven git operations, or pane processes.
  runtime.workspaceAutoSync.start = () => undefined;
  runtime.herdr.call = async () => ({ panes: [] });
  runtime.herdr.subscribe = (types) => {
    expect(types).toContain("layout.updated");
    let ack!: () => void;
    let close!: () => void;
    const ready = new Promise<void>((resolve) => {
      ack = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    subscriptions.push({ ack, close });
    return { ready, closed, close };
  };
  try {
    runtime.startBackground();
    expect(subscriptions).toHaveLength(1);
    expect(events).toEqual([]); // No snapshot invalidation before the ACK.
    subscriptions[0]!.ack();
    await Bun.sleep(10);
    expect(events).toEqual([{ event: "session.resync_required", data: {} }]);
    // Subscription name is dotted; tagged event envelopes use snake_case.
    const layout = {
      event: "layout_updated",
      data: { layout: { tab_id: "tab_1" } },
    };
    runtime.herdr.emit("event", layout);
    expect(events.at(-1)).toEqual(layout);
    subscriptions[0]!.close();
    const deadline = Date.now() + 3000;
    while (subscriptions.length < 2 && Date.now() < deadline)
      await Bun.sleep(10);
    expect(subscriptions).toHaveLength(2);
    expect(events).toHaveLength(2);
    subscriptions[1]!.ack();
    await Bun.sleep(10);
    expect(events.at(-1)).toEqual({
      event: "session.resync_required",
      data: {},
    });
    expect(events).toHaveLength(3);
  } finally {
    await runtime.stop();
  }
});
