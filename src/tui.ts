import { Plugin } from "@opencode/plugin/tui";
import { createEffect } from "solid-js";
import type { Status } from "./status.ts";
import { TmuxStatus, targetFromEnvironment } from "./tmux.ts";
import { openRoots, viewStatus } from "./view.ts";

export default Plugin.define({
  id: "opencode.tmux-status",
  async setup(context) {
    const target = targetFromEnvironment(process.env);
    if (!target) return;

    let warned = false;
    function warn() {
      if (warned) return;
      warned = true;
      context.ui.toast.show({
        title: "tmux status",
        message: "Could not update tmux status. Indicators will expire until the connection recovers.",
        variant: "warning",
      });
    }

    let bridge: TmuxStatus;
    try {
      bridge = await TmuxStatus.connect(target);
    } catch {
      warn();
      return;
    }

    let status: Status = "idle";
    let writing = false;
    let stopped = false;
    async function publish() {
      if (writing || stopped) return;
      writing = true;
      try {
        do {
          const sent = status;
          await bridge.publish(sent);
          warned = false;
          if (sent === status) break;
        } while (!stopped);
      } catch {
        warn();
      } finally {
        writing = false;
      }
    }

    const synchronized = new Set<string>();
    // An app slot gives effects a host-owned Solid lifetime, including tab/route changes.
    const remove = context.ui.slot({
      append: "app",
      render() {
        createEffect(() => {
          const next = viewStatus(context);
          if (next === status) return;
          status = next;
          void publish();
        });
        createEffect(() => {
          for (const root of openRoots(context)) {
            for (const id of new Set([root, ...context.data.session.family(root)])) {
              if (synchronized.has(id)) continue;
              synchronized.add(id);
              void Promise.all([
                context.data.session.sync(id),
                context.data.session.permission.sync(id),
                context.data.session.form.sync(id),
              ]).catch(warn);
            }
          }
        });
        return null;
      },
    });

    // Only the lease/spinner needs a timer; agent state comes from reactive event data.
    const heartbeat = setInterval(() => void publish(), 1000);
    heartbeat.unref();
    return async () => {
      stopped = true;
      clearInterval(heartbeat);
      remove();
      await bridge.close().catch(() => {}); // The pane/server may already have gone away.
    };
  },
});
