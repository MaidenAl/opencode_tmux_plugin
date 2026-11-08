import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { TmuxStatus, targetFromEnvironment, FORMAT_SUFFIX, LEASE_SECONDS } from "../src/tmux.ts";

const exec = promisify(execFile);

async function fixture(t: TestContext) {
  const directory = await mkdtemp("/tmp/opencode/oc tmux test-");
  const socket = `${directory}/tmux.sock`;
  const tmux = async (...args: string[]) =>
    (await exec("tmux", ["-S", socket, ...args])).stdout.replace(/\r?\n$/, "");
  t.after(async () => {
    await tmux("kill-server").catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  const pane = await tmux("-f", "/dev/null", "new-session", "-d", "-s", "plugin-test",
    "-n", "Agents", "-P", "-F", "#{pane_id}", "sleep 300");
  return {
    tmux, socket, pane,
    label: (id = pane) => tmux("display-message", "-p", "-t", id, "#{T:window-status-format}"),
  };
}

test("only a valid tmux environment enables the bridge", () => {
  assert.equal(targetFromEnvironment({}), undefined);
  assert.equal(targetFromEnvironment({ TMUX: "/tmp/socket,123,0" }), undefined);
  assert.equal(targetFromEnvironment({ TMUX: "invalid", TMUX_PANE: "%3" }), undefined);
  assert.equal(targetFromEnvironment({ TMUX: "/tmp/s,1,0", TMUX_PANE: "%3; kill-server" }), undefined);
  assert.deepEqual(targetFromEnvironment({ TMUX: "/tmp/socket,with,commas,123,0", TMUX_PANE: "%3" }), {
    socket: "/tmp/socket,with,commas", pane: "%3",
  });
});

test("formats preserve names/styles, install once, and stay blank in unrelated windows", async (t) => {
  const f = await fixture(t);
  const base = "#[fg=blue]#I:#W#{window_flags}";
  await f.tmux("set-option", "-gw", "window-status-format", base);
  await f.tmux("set-option", "-w", "-t", f.pane, "window-status-current-format", "LOCAL #W");
  const bridge = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  assert.equal(await f.label(), "#[fg=blue]0:Agents*");
  await bridge.publish("done");
  assert.match(await f.label(), /Agents\* ✓$/u);
  assert.equal(await f.tmux("display-message", "-p", "-t", f.pane,
    "#{T:window-status-current-format}"), "LOCAL Agents ✓");
  await bridge.publish("working");
  assert.match(await f.label(), / [⠋⠙⠹⠸]$/u);
  assert.equal(await f.tmux("show-options", "-gwqv", "window-status-format"), base + FORMAT_SUFFIX);
  const other = await f.tmux("new-window", "-d", "-n", "Unrelated", "-P", "-F", "#{pane_id}", "sleep 300");
  assert.equal(await f.label(other), "#[fg=blue]1:Unrelated");
  await bridge.close();
  assert.equal(await f.label(), "#[fg=blue]0:Agents*");
});

test("every pane contributes and indicators automatically follow pane moves", async (t) => {
  const f = await fixture(t);
  const second = await f.tmux("split-window", "-d", "-t", f.pane, "-P", "-F", "#{pane_id}", "sleep 300");
  const firstBridge = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  const secondBridge = await TmuxStatus.connect({ socket: f.socket, pane: second });
  await firstBridge.publish("done");
  await secondBridge.publish("working");
  assert.match(await f.label(), / [⠋⠙⠹⠸]$/u);
  await secondBridge.publish("attention");
  assert.match(await f.label(), / !$/u);
  const destination = await f.tmux("new-window", "-d", "-n", "Moved", "-P", "-F", "#{pane_id}", "sleep 300");
  await f.tmux("join-pane", "-d", "-s", second, "-t", destination);
  assert.match(await f.label(), / ✓$/u);
  assert.match(await f.label(destination), /Moved.* !$/u);
  await f.tmux("rename-window", "-t", destination, "Renamed");
  assert.match(await f.label(destination), /Renamed.* !$/u);
  await secondBridge.close();
  assert.doesNotMatch(await f.label(destination), /[!✓⠋⠙⠹⠸]/u);
  await firstBridge.close();
});

test("expired heartbeats cannot leave a false busy or finished indicator", async (t) => {
  const f = await fixture(t);
  const bridge = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  for (const status of ["working", "done", "error", "attention"] as const) {
    await bridge.publish(status);
    await f.tmux("set-option", "-p", "-t", f.pane, "@opencode_tmux_heartbeat",
      String(Math.floor(Date.now() / 1000) - LEASE_SECONDS - 1));
    assert.doesNotMatch(await f.label(), /[!✓✗⠋⠙⠹⠸]/u);
  }
  await bridge.close();
});

test("old plugin cleanup cannot erase a replacement plugin's status", async (t) => {
  const f = await fixture(t);
  const old = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  const replacement = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  await replacement.publish("error");
  await old.close();
  assert.match(await f.label(), / ✗$/u);
  await replacement.close();
});

test("intentional spacing in existing formats is preserved", async (t) => {
  const f = await fixture(t);
  const base = "  #W  ";
  await f.tmux("set-option", "-gw", "window-status-format", base);
  const bridge = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  await bridge.publish("done");
  assert.equal(await f.label(), "  Agents   ✓");
  await bridge.close();
  assert.equal(await f.label(), "  Agents  ");
});

test("uninstall removes only plugin-owned formatting and pane options", async (t) => {
  const f = await fixture(t);
  const base = "#[fg=blue]  #W  ";
  const local = "LOCAL #I:#W";
  await f.tmux("set-option", "-gw", "window-status-format", base);
  await f.tmux("set-option", "-w", "-t", f.pane, "window-status-current-format", local);
  await f.tmux("set-option", "-p", "-t", f.pane, "@user_setting", "keep me");
  const bridge = await TmuxStatus.connect({ socket: f.socket, pane: f.pane });
  await bridge.publish("done");
  await bridge.close();
  const target = { socket: f.socket, pane: f.pane };
  await TmuxStatus.uninstall(target);
  await TmuxStatus.uninstall(target);
  assert.equal(await f.tmux("show-options", "-gwqv", "window-status-format"), base);
  assert.equal(await f.tmux("show-options", "-wqv", "-t", f.pane, "window-status-current-format"), local);
  assert.equal(await f.tmux("show-options", "-pqv", "-t", f.pane, "@user_setting"), "keep me");
  assert.equal(await f.tmux("show-options", "-gqv", "@opencode_tmux_badge"), "");
});
