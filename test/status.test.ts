import assert from "node:assert/strict";
import { test } from "node:test";
import { paneStatus, type SessionSource } from "../src/status.ts";

function source(
  sessions: Record<string, {
    running?: boolean;
    permission?: boolean;
    question?: boolean;
    outcome?: "succeeded" | "failed" | "interrupted";
    busy?: number;
    idle?: number;
    children?: string[];
  }>,
): SessionSource {
  return {
    get: (id) => sessions[id] && {
      outcome: sessions[id].outcome,
      time: { busy: sessions[id].busy, idle: sessions[id].idle },
    },
    family: (id) => [id, ...(sessions[id]?.children ?? [])],
    status: (id) => sessions[id]?.running ? "running" : "idle",
    permission: { list: (id) => sessions[id]?.permission ? [{}] : [] },
    form: { list: (id) => sessions[id]?.question ? [{}] : [] },
  };
}

test("new idle sessions and a home screen are not marked finished", () => {
  const data = source({ fresh: {} });
  assert.equal(paneStatus([], data), "idle");
  assert.equal(paneStatus(["fresh"], data), "idle");
  assert.equal(paneStatus(["not-yet-loaded"], data), "idle");
});

test("working depends on session execution, not terminal output", () => {
  assert.equal(paneStatus(["root"], source({ root: { running: true } })), "working");
});

test("a finished parent stays busy while a nested background agent runs", () => {
  const data = source({
    root: { outcome: "succeeded", children: ["child", "grandchild"] },
    child: { outcome: "succeeded" },
    grandchild: { running: true },
  });
  assert.equal(paneStatus(["root"], data), "working");
});

test("permissions and questions take priority over working", () => {
  for (const attention of [{ permission: true }, { question: true }]) {
    const data = source({
      root: { running: true, children: ["child"] },
      child: attention,
    });
    assert.equal(paneStatus(["root"], data), "attention");
  }
});

test("only open roots contribute, including background tabs", () => {
  const data = source({ first: { outcome: "succeeded" }, second: { running: true } });
  assert.equal(paneStatus(["first", "second"], data), "working");
  assert.equal(paneStatus(["first"], data), "done");
});

test("completion persists and the next execution replaces it", () => {
  const completed = source({ root: { outcome: "succeeded" } });
  assert.equal(paneStatus(["root"], completed), "done");
  assert.equal(paneStatus(["root"], completed), "done");
  assert.equal(paneStatus(["root"], source({
    root: { outcome: "succeeded", running: true },
  })), "working");
});

test("failed executions are not shown as successful completion", () => {
  assert.equal(paneStatus(["root"], source({ root: { outcome: "failed" } })), "error");
  assert.equal(paneStatus(["root"], source({
    root: { outcome: "succeeded", busy: 100, children: ["child"] },
    child: { outcome: "failed", idle: 200 },
  })), "error");
});

test("a later parent run clears old child failures, not still-running children", () => {
  for (const running of [false, true]) {
    const data = source({
      root: { outcome: "succeeded", busy: 300, children: ["child"] },
      child: { outcome: "failed", idle: 200, running },
    });
    assert.equal(paneStatus(["root"], data), running ? "working" : "done");
  }
});

test("interrupted runs are idle, not successful", () => {
  assert.equal(paneStatus(["root"], source({
    root: { outcome: "interrupted", children: ["child"] },
    child: { outcome: "succeeded" },
  })), "idle");
});

test("working in another open tab outranks an old error", () => {
  assert.equal(paneStatus(["a", "b"], source({
    a: { outcome: "failed" }, b: { running: true },
  })), "working");
});
