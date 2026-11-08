import { TmuxStatus, targetFromEnvironment } from "./tmux.ts";

const target = targetFromEnvironment(process.env);
if (!target) {
  console.error("Run this command inside the tmux server to clean up. Disable the OpenCode plugin first.");
  process.exitCode = 1;
} else {
  try {
    await TmuxStatus.uninstall(target);
    console.log("Removed OpenCode status formatting from this tmux server; other settings were preserved.");
  } catch (error) {
    console.error("Could not remove tmux status formatting:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
