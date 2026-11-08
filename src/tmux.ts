import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { Status } from "./status.ts";

const exec = promisify(execFile);
export const LEASE_SECONDS = 5;
export const FORMAT_TOKEN = "#{T:@opencode_tmux_badge}";
const STATE = "@opencode_tmux_state";
const HEARTBEAT = "@opencode_tmux_heartbeat";
const OWNER = "@opencode_tmux_owner";

// T: evaluates %s at render time. P: aggregates every pane, not just the active one.
const liveStates = `#{P:#{?#{&&:#{!=:#{pane_dead},1},#{e|>=:#{${HEARTBEAT}},#{e|-:%s,${LEASE_SECONDS}}}},#{${STATE}},}}`;
const spinner = "#{?#{==:#{e|%%:%s,4},0},⠋,#{?#{==:#{e|%%:%s,4},1},⠙,#{?#{==:#{e|%%:%s,4},2},⠹,⠸}}}";
const BADGE = [
  ["done", "✓"], ["error", "✗"], ["working", spinner], ["attention", "!"],
].reduce((rest, [status, icon]) => `#{?#{m:*${status}*,${liveStates}},${icon},${rest}}`, "");

export interface TmuxTarget {
  socket: string;
  pane: string;
}

export function targetFromEnvironment(env: NodeJS.ProcessEnv): TmuxTarget | undefined {
  const socket = env.TMUX?.match(/^(.*),\d+,\d+$/s)?.[1];
  const pane = env.TMUX_PANE;
  if (!socket || !isAbsolute(socket) || !pane || !/^%\d+$/.test(pane)) return;
  return { socket, pane };
}

export class TmuxStatus {
  private readonly target: TmuxTarget;
  private readonly owner = randomUUID();
  private pending = Promise.resolve();
  private closed = false;

  private constructor(target: TmuxTarget) {
    if (!isAbsolute(target.socket) || !/^%\d+$/.test(target.pane)) {
      throw new Error("Invalid tmux socket or pane");
    }
    this.target = target;
  }

  static async connect(target: TmuxTarget): Promise<TmuxStatus> {
    const bridge = new TmuxStatus(target);
    await bridge.run("set-option", "-p", "-t", target.pane, OWNER, bridge.owner);
    await bridge.publish("idle");
    return bridge;
  }

  static async uninstall(target: TmuxTarget): Promise<void> {
    const bridge = new TmuxStatus(target);
    const windows = new Set((await bridge.run("list-windows", "-a", "-F", "#{window_id}")).split("\n"));
    const scopes = [["-gw"], ...[...windows].map((id) => ["-w", "-t", id])];
    for (const scope of scopes) {
      for (const option of ["window-status-format", "window-status-current-format"]) {
        const format = await bridge.run("show-options", ...scope, "-qv", option);
        if (format.includes(FORMAT_TOKEN)) {
          await bridge.run("set-option", ...scope, option, format.replaceAll(FORMAT_TOKEN, ""));
        }
      }
    }
    const panes = (await bridge.run("list-panes", "-a", "-F", "#{pane_id}")).split("\n");
    for (const pane of panes) {
      for (const option of [STATE, HEARTBEAT, OWNER]) {
        await bridge.run("set-option", "-pqu", "-t", pane, option);
      }
    }
    await bridge.run("set-option", "-gqu", "@opencode_tmux_badge");
    await bridge.refresh();
  }

  private async run(...args: string[]): Promise<string> {
    const result = await exec("tmux", ["-S", this.target.socket, ...args], { timeout: 2000 });
    return result.stdout.replace(/\r?\n$/, "");
  }

  private async ensureFormats(): Promise<void> {
    await this.run("set-option", "-g", "@opencode_tmux_badge", BADGE);
    for (const scope of ["-gw", "-w"]) {
      for (const option of ["window-status-format", "window-status-current-format"]) {
        const target = scope === "-w" ? ["-t", this.target.pane] : [];
        const format = await this.run("show-options", scope, "-qv", ...target, option);
        // An absent local override must keep inheriting the global theme.
        if (scope === "-w" && !format) continue;
        const updated = FORMAT_TOKEN + format.replaceAll(FORMAT_TOKEN, "");
        if (format !== updated) {
          await this.run("set-option", scope, ...target, option, updated);
        }
      }
    }
  }

  private async refresh(): Promise<void> {
    const clients = await this.run("list-clients", "-F", "#{client_name}");
    for (const client of clients.split("\n").filter(Boolean)) {
      await this.run("refresh-client", "-S", "-t", client);
    }
  }

  publish(status: Status): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!["idle", "done", "error", "working", "attention"].includes(status)) {
      return Promise.reject(new Error("Invalid OpenCode status"));
    }
    this.pending = this.pending.catch(() => {}).then(async () => {
      await this.ensureFormats();
      const { pane } = this.target;
      const heartbeat = Math.floor(Date.now() / 1000);
      // -F runs tmux commands, never a shell. The owner token also guards hot reloads.
      await this.run("if-shell", "-F", "-t", pane, `#{==:#{${OWNER}},${this.owner}}`,
        `set-option -p -t ${pane} ${STATE} ${status}; set-option -p -t ${pane} ${HEARTBEAT} ${heartbeat}`);
      await this.refresh();
    });
    return this.pending;
  }

  close(): Promise<void> {
    if (this.closed) return this.pending;
    this.closed = true;
    this.pending = this.pending.catch(() => {}).then(async () => {
      const { pane } = this.target;
      await this.run("if-shell", "-F", "-t", pane, `#{==:#{${OWNER}},${this.owner}}`,
        [STATE, HEARTBEAT, OWNER].map((option) => `set-option -pu -t ${pane} ${option}`).join("; "));
      await this.refresh();
    });
    return this.pending;
  }
}
