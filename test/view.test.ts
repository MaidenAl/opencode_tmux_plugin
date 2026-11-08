import assert from "node:assert/strict";
import { test } from "node:test";
import { openRoots, viewStatus, type StatusView } from "../src/view.ts";

function view(): StatusView {
  return {
    data: { session: {
      root: (id) => id === "child" ? "root" : id,
      family: (id) => [id],
      get: () => ({ outcome: "succeeded", time: {} }),
      status: () => "idle",
      permission: { list: () => [] },
      form: { list: () => [] },
    } },
    ui: {
      tabs: { enabled: () => true, list: () => [
        { sessionID: "root", busy: false, attention: false },
        { sessionID: "background", busy: false, attention: false },
      ] },
      router: { current: () => ({ type: "session", sessionID: "child" }) },
    },
  };
}

test("the selected child maps to its root without duplicating the open tab", () => {
  assert.deepEqual(openRoots(view()), ["root", "background"]);
});

test("tabs-disabled mode only tracks the displayed session family", () => {
  const context = view();
  context.ui.tabs.enabled = () => false;
  assert.deepEqual(openRoots(context), ["root"]);
  context.ui.router.current = () => ({ type: "home" });
  assert.equal(viewStatus(context), "idle");
});

test("open background tabs still count on the home or a plugin screen", () => {
  const context = view();
  context.ui.router.current = () => ({ type: "home" });
  assert.deepEqual(openRoots(context), ["root", "background"]);
  assert.equal(viewStatus(context), "done");
});

test("native tab busy/attention flags cover sessions still being synchronized", () => {
  const context = view();
  context.ui.tabs.list = () => [{ sessionID: "root", busy: true, attention: false }];
  assert.equal(viewStatus(context), "working");
  context.ui.tabs.list = () => [{ sessionID: "root", busy: true, attention: true }];
  assert.equal(viewStatus(context), "attention");
});

test("closing a background tab removes its busy flag immediately", () => {
  const context = view();
  context.ui.tabs.list = () => [{ sessionID: "background", busy: true, attention: false }];
  assert.equal(viewStatus(context), "working");
  context.ui.tabs.list = () => [];
  assert.equal(viewStatus(context), "done");
});
