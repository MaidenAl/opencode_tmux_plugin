import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client";

const exec = promisify(execFile);
const plugin = fileURLToPath(new URL("../", import.meta.url));
const redact = (text: string) => text.replace(/server password \S+/g, "server password [redacted]");

async function until<T>(description: string, read: () => Promise<T>, accept: (value: T) => boolean) {
  const deadline = Date.now() + 30_000;
  let last: T;
  do {
    last = await read();
    if (accept(last)) return last;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}: ${redact(JSON.stringify(last))}`);
}

test("real OpenCode TUI observes execution, child agents, questions, and errors", { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp("/tmp/opencode/oc-tmux-runtime-");
  const socket = `${directory}/tmux.sock`;
  const workspace = `${directory}/workspace`;
  const localPlugin = `${directory}/plugin`;
  const pending: ServerResponse[] = [];
  let fail = false;
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the local test prompt; never log it. */ }
    if (fail) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Intentional test failure", type: "invalid_request_error" } }));
    } else {
      pending.push(response);
    }
  });
  model.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => model.once("listening", resolve));
  const address = model.address();
  assert.ok(address && typeof address !== "string");
  const env = {
    PATH: process.env.PATH,
    HOME: `${directory}/home`,
    XDG_CONFIG_HOME: `${directory}/config`,
    XDG_DATA_HOME: `${directory}/data`,
    XDG_CACHE_HOME: `${directory}/cache`,
    XDG_STATE_HOME: `${directory}/state`,
    XDG_RUNTIME_DIR: `${directory}/runtime`,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    OC_TMUX_TEST_KEY: "local-test-only",
    OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({
      plugins: [localPlugin], attention: { sound: false, notifications: false },
      highlights: false, tabs: { mode: "on" },
    }),
  };
  const tmux = async (...args: string[]) =>
    (await exec("tmux", ["-S", socket, ...args], { env })).stdout.replace(/\r?\n$/, "");
  t.after(async () => {
    await tmux("kill-server").catch(() => {});
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  for (const path of [workspace, env.HOME, `${env.XDG_CONFIG_HOME}/opencode`, env.XDG_RUNTIME_DIR]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  // Verify the distributable alone: no developer node_modules or build output.
  await mkdir(localPlugin);
  await cp(`${plugin}/package.json`, `${localPlugin}/package.json`);
  await cp(`${plugin}/src`, `${localPlugin}/src`, { recursive: true });
  await writeFile(`${env.XDG_CONFIG_HOME}/opencode/opencode.json`, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "tmux-test/model", update: "disable", snapshots: false,
    permissions: [{ action: "tmux-test", resource: "*", effect: "ask" }],
    providers: { "tmux-test": {
      env: ["OC_TMUX_TEST_KEY"], package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${address.port}/v1` },
      models: { model: { name: "Local test model", limit: { context: 32_000, output: 1000 } } },
    } },
    policies: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "tmux-test", effect: "allow" },
    ],
  }));

  const serverPane = await tmux("-f", "/dev/null", "new-session", "-d", "-s", "plugin-runtime", "-n", "Server",
    "-x", "140", "-y", "40", "-c", workspace, "-P", "-F", "#{pane_id}",
    "opencode serve --hostname 127.0.0.1 --port 0 --print-logs");
  let tuiPane: string | undefined;
  try {
    const output = await until("private server URL", () => tmux("capture-pane", "-p", "-t", serverPane),
      (text) => /http:\/\/127\.0\.0\.1:\d+/.test(text) && /server password \S+/.test(text));
    const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    const password = output.match(/server password (\S+)/)![1];
    await tmux("set-environment", "-g", "OPENCODE_PASSWORD", password);
    const authorization = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    async function api<T = unknown>(path: string, method = "GET", body?: object): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method, headers: { "Content-Type": "application/json", authorization },
        body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
      return (response.status === 204 ? undefined : (await response.json() as { data: T }).data) as T;
    }
    const root = await api<SessionInfo>("/api/session", "POST", { title: "tmux runtime", location: { directory: workspace } });
    tuiPane = await tmux("new-window", "-d", "-n", "Agent", "-c", workspace, "-P", "-F", "#{pane_id}", "/bin/sh");
    const pane = tuiPane;
    const launch = async () => {
      await tmux("send-keys", "-t", pane, "-l", `opencode --server ${base} --session ${root.id}`);
      await tmux("send-keys", "-t", pane, "Enter");
    };
    await launch();
    const state = () => tmux("show-options", "-pqv", "-t", pane, "@opencode_tmux_state");
    await until("plugin load and initial idle state", state, (value) => value === "idle");

    async function prompt(id: string) {
      await api(`/api/session/${id}/prompt`, "POST", { text: "Reply with OK. This is a local plugin test." });
      await until("local model request", async () => pending.length, (count) => count > 0);
    }
    function finish() {
      for (const response of pending.splice(0)) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (delta: object, finish_reason: string | null) => ({
          id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "model",
          choices: [{ index: 0, delta, finish_reason }],
        });
        response.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: "OK" }, null))}\n\n`
          + `data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`);
      }
    }

    await prompt(root.id);
    await until("working indicator", state, (value) => value === "working");
    const frames = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const frame = await tmux("show-options", "-gqv", "@opencode_tmux_spinner");
      assert.match(frame, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/u);
      frames.add(frame);
      await delay(100);
    }
    assert.ok(frames.size >= 5, `Expected sub-second animation, observed ${frames.size} frames`);
    t.diagnostic(`Sub-second spinner: observed ${frames.size} distinct working frames`);
    finish();
    await until("finished indicator", state, (value) => value === "done");
    t.diagnostic("Real execution: idle → working → done");

    const child = await api<SessionInfo>("/api/session", "POST", { parentID: root.id, title: "Background child" });
    await prompt(child.id);
    await until("busy background child", state, (value) => value === "working");
    finish();
    await until("whole family finished", state, (value) => value === "done");
    t.diagnostic("A real child session keeps its parent's window busy");

    const form = await api<FormInfo>(`/api/session/${root.id}/form`, "POST", {
      title: "Test question", fields: [{ key: "ready", type: "boolean", title: "Ready?" }],
    });
    await until("needs attention", state, (value) => value === "attention");
    await api(`/api/session/${root.id}/form/${form.id}`, "DELETE");
    await until("attention cleared", state, (value) => value === "done");
    t.diagnostic("Real pending form: done → attention → done");

    const permission = api(`/api/session/${root.id}/permission`, "POST", {
      action: "tmux-test", resources: ["local-test-only"],
    });
    // Attach a rejection handler immediately while the request waits for its reply.
    void permission.catch(() => {});
    const requests = await until("permission request", () => api<PermissionRequest[]>(
      `/api/session/${root.id}/permission`), (items) => items.length > 0);
    await until("permission attention", state, (value) => value === "attention");
    await api(`/api/session/${root.id}/permission/${requests[0].id}/reply`, "POST", { decision: "once" });
    await permission;
    await until("permission cleared", state, (value) => value === "done");
    t.diagnostic("Real permission approval: done → attention → done");

    fail = true;
    await api(`/api/session/${root.id}/prompt`, "POST", { text: "Trigger the local test error." });
    await until("failed execution", state, (value) => value === "error");
    t.diagnostic("Real provider failure displays error, not done");
    assert.match(await tmux("display-message", "-p", "-t", pane, "#{T:window-status-format}"), /^✗\d+:Agent/u);

    await tmux("send-keys", "-t", pane, "C-d");
    await until("normal exit clears pane state", state, (value) => value === "");
    t.diagnostic("Normal TUI exit removes its pane status");

    // Plugin cleanup precedes TUI exit; do not send the next launch to the old TUI.
    await until("shell regains the pane", () => tmux("display-message", "-p", "-t", pane,
      "#{pane_current_command}"), (command) => command === "sh");
    await launch();
    await until("plugin restored after reopening", state, (value) => value === "error");
    const shellPID = await tmux("display-message", "-p", "-t", pane, "#{pane_pid}");
    const children = (await exec("ps", ["-o", "pid=,comm=", "--ppid", shellPID])).stdout;
    const childPID = children.match(/^\s*(\d+)\s+opencode\s*$/m)?.[1];
    assert.ok(childPID, "Only kill the OpenCode child of this isolated test pane");
    process.kill(Number(childPID), "SIGKILL");
    await until("crash lease expires", () => tmux("display-message", "-p", "-t", pane,
      "#{T:window-status-format}"), (label) => !/[!✓✗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u.test(label));
    t.diagnostic("An actual SIGKILL cannot leave a stale window indicator");
  } catch (error) {
    t.diagnostic(redact((await tmux("capture-pane", "-p", "-t", serverPane).catch(String)).slice(-2000)));
    if (tuiPane) t.diagnostic(redact(await tmux("capture-pane", "-p", "-t", tuiPane).catch(String)));
    const log = `${env.XDG_DATA_HOME}/opencode/log/opencode.log`;
    t.diagnostic(redact((await readFile(log, "utf8").catch(String)).slice(-2000)));
    throw error;
  }
});
