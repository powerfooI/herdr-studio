import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentHistoryCard, HISTORY_PREVIEW_CHARS } from "./AgentHistoryCard";
import type { HistoryEntry } from "./agentHistory";

function render(entry: HistoryEntry) {
  return renderToStaticMarkup(
    createElement(AgentHistoryCard, { entry, index: 2, onExpand() {} }),
  );
}

test("redacted tool entries offer an on-demand Load button and suppress copy", () => {
  const stub: HistoryEntry = {
    id: "2",
    kind: "tool_result",
    role: "tool",
    tool_name: "bash",
    text: "",
    text_bytes: 2048,
    sent_at: "2026-01-01T00:00:00Z",
  };
  const markup = renderToStaticMarkup(
    createElement(AgentHistoryCard, {
      entry: stub,
      index: 3,
      onExpand() {},
      onLoadContent() {},
    }),
  );
  expect(markup).toContain("Load output (2.0 KB)");
  expect(markup).not.toContain("agent-history-copy");
  expect(markup).not.toContain("agent-history-card-open");
  const callStub = renderToStaticMarkup(
    createElement(AgentHistoryCard, {
      entry: { ...stub, kind: "tool_call", text_bytes: 100 },
      index: 4,
      onExpand() {},
      onLoadContent() {},
    }),
  );
  expect(callStub).toContain("Load arguments (100 B)");
  const loading = renderToStaticMarkup(
    createElement(AgentHistoryCard, {
      entry: stub,
      index: 3,
      contentLoading: true,
      onExpand() {},
      onLoadContent() {},
    }),
  );
  expect(loading).toContain("Loading…");
  expect(loading).toContain("disabled");
});

test("tool cards label arguments, output/errors and call association with bounded safe previews", () => {
  const base: HistoryEntry = {
    id: "1",
    kind: "tool_call",
    role: "tool",
    tool_name: "bash",
    source_call_id: "call-1",
    text: '<script>alert("x")</script>' + "x".repeat(100_000),
    sent_at: "2026-01-01T00:00:00Z",
  };
  const call = render(base);
  expect(call).toContain("Arguments");
  expect(call).toContain("Call ID: call-1");
  expect(call).toContain("View full tool details");
  expect(call).not.toContain("<script>");
  expect(call).toContain("&lt;script&gt;");
  expect(call.length).toBeLessThan(HISTORY_PREVIEW_CHARS + 2500);
  expect(call).toContain('data-sequence="2"');
  const result = render({
    ...base,
    kind: "tool_result",
    is_error: true,
    text: "exit 1",
  });
  expect(result).toContain("Tool error: bash");
  expect(result).toContain("Error output");
  expect(result).toContain("exit 1");
});
