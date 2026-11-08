# OpenCode tmux status

A local OpenCode V2 TUI plugin for automatic tmux window indicators. Targets
OpenCode 2.2.6 and tmux 3.5a; development uses Node.js 24 and TypeScript.

## Approved behavior

- Track sessions open in each TUI and their background subagents.
- Summarize all OpenCode panes in each window: attention, working, error, done.
- Keep the done marker until the next run; never mark a new idle session done.
- Follow panes when they move, without changing window names or existing styles.
- Remove indicators on exit and protect against stale indicators after crashes.
- Make no changes outside this repository during development. All runtime tests
  use an isolated tmux server, never the user's `Main` session.

## Implementation checkpoints

1. Initialize the repository and verify the installed OpenCode plugin contract.
2. Test and implement session/family status tracking.
3. Test and implement tmux aggregation, lifecycle, and crash cleanup.
4. Connect the TUI plugin, verify it in an isolated tmux environment, and document
   installation and removal.

Each implementation checkpoint is verified and committed separately. Acceptance
requires passing tests and strict type checking, including isolated real-tmux
tests of pane moves, multiple panes, and cleanup. Runtime OpenCode loading must
be checked separately from simulated session events.

## Sources

- [OpenCode TUI plugin API](https://opencode.ai/docs/build/plugins/cli)
- [CLI-only plugin loading](https://opencode.ai/docs/cli/plugins)
- [OpenCode API and event schemas](https://opencode.ai/docs/api)
