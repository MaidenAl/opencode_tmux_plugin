# OpenCode tmux status

Automatic, per-window agent indicators for **OpenCode V2**. No hard-coded window
names, screen scraping, monitoring daemon, or model/API calls.

```text
⠋1:Gw    ✓3:Cliff    !4:Terminal
```

| Indicator | Meaning |
| --- | --- |
| `⠋ ⠙ ⠹ ⠸` | Working; spinner advances once a second |
| `!` | Waiting for a permission or an answer |
| `✗` | The latest execution failed |
| `✓` | Execution finished; stays until the next run |
| None | No tracked work, a new idle session, or an interrupted run |

Priority is **attention → working → error → done**. A checkmark means the run
ended, not that its work is correct or its tests passed.

## Enable

Tested with **OpenCode 2.2.6** and **tmux 3.5a on Linux**. The plugin runs in
OpenCode itself: no build step, npm installation, or separate Node process is
needed to use it.

Add this folder to the existing `plugins` array in
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/home/alavi/repos/opencode_tmux"]
}
```

**Merge the entry; do not replace your other settings or plugins.** CLI config
reloads automatically; `/reload` can force a reload. No server restart is needed.
Launch OpenCode normally inside tmux. Outside tmux, this plugin does nothing.

**Development did not enable the plugin in your `Main` session or edit your
global configuration.** The path above is the remaining opt-in step.

## What is tracked

- Every root-session tab open in that TUI, plus its session family, including
  nested/background subagents. With tabs disabled, only the displayed family
  contributes. Sessions elsewhere on a shared server do not count.
- Every OpenCode pane in a window, including inactive split panes. Renaming or
  moving panes/windows needs no reconfiguration.
- Actual OpenCode execution status, including time awaiting a blocking tool.
  Standalone background services/OS processes are not agent executions.
- Initial pending permissions/questions and the outcome of an existing session
  are synchronized when the session is opened. Old child failures do not stick
  to a parent's later execution.

## How tmux integration works

The TUI's reactive session data drives state changes immediately. A one-second
heartbeat renews a **five-second pane lease**, animates the spinner, and refreshes
attached clients. It does not poll session status or inspect terminal output.

Pane options hold only a fixed state, timestamp, and reload-ownership token; no
prompts, session titles, file contents, or credentials are written to tmux.
Socket paths and pane IDs come from `TMUX` / `TMUX_PANE`. Commands use argument
arrays, not shell interpolation.

tmux's own format engine aggregates all live pane leases. On normal exit, the
pane's options are cleared. On a crash, a stale lease becomes invisible after
five seconds **at the next status redraw** (up to your `status-interval` later).
Dead panes are excluded immediately. Hot-reload ownership prevents an old
instance's cleanup from clearing a new instance's status.

The plugin prepends `#{T:@opencode_tmux_badge}` to the global
`window-status-format` and `window-status-current-format`, and to existing local
overrides when needed. Window names, existing formatting/spacing, colors,
`status-interval`, and your config files are not changed. Theme reloads are
picked up on the next heartbeat. A custom status bar that bypasses tmux's normal
window-status formats needs its own integration. The icon has no added space
before the window number; existing trailing indicators are migrated automatically.

## Disable / remove

1. Remove this entry from `cli.json`, letting each running TUI reload it.
2. The visible indicators disappear. A harmless, empty format reference can
   remain in the running tmux server.
3. To remove that reference and all plugin-owned options too, **after disabling
   the plugin in every TUI**, run this from a shell inside the intended tmux
   server, with Node.js 24 installed:

   ```sh
   cd /home/alavi/repos/opencode_tmux
   npm run tmux:uninstall
   ```

The removal command touches only this plugin's format reference and namespaced
options; it preserves the rest of your formatting. Nothing is persisted in
`.tmux.conf`, so restarting a tmux server also clears the integration.

## Development / verification

Node.js 24 and npm 11.17.0 are used for development; tmux must be on `PATH`.
Dependency lifecycle scripts are disabled by `.npmrc`.

```sh
npm ci
npm test
npm run typecheck
npm run test:runtime
```

- Unit tests cover status priority, fresh/interrupted/completed sessions, open
  tabs, nested subagents, and clearing old child failures.
- Integration tests create private tmux sockets under `/tmp/opencode`, verifying
  multiple panes, pane moves/renames, format preservation, lease expiry,
  reload ownership, and removal.
- The runtime test requires `opencode` and Linux `ps` on `PATH`. It copies only
  the distributable (no `node_modules`), launches a real OpenCode server/TUI in a
  private tmux session, uses separate HOME/XDG directories, and supplies a local
  mock model. It verifies execution, child sessions, questions, permission
  approval, provider errors, normal exit, and an actual SIGKILL. It uses **no
  personal credentials or paid models** and removes its own test environment.

See [SECURITY.md](SECURITY.md) for the development dependency audit.

## Sources

- [OpenCode TUI plugin API](https://opencode.ai/docs/build/plugins/cli)
- [CLI-only plugin loading](https://opencode.ai/docs/cli/plugins)
- [CLI configuration](https://opencode.ai/docs/cli/config)
- [OpenCode API and event schemas](https://opencode.ai/docs/api)
- [Custom provider for the local test model](https://opencode.ai/docs/providers#custom)
- [Solid reactive effects](https://docs.solidjs.com/reference/basic-reactivity/create-effect)
- tmux 3.5a's installed `man tmux`: user options, `P:` / `T:` formats, arithmetic,
  `window-status-format`, and `refresh-client`.
