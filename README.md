# OpenCode tmux Plugin

[![CI](https://github.com/MaidenAl/opencode_tmux_plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/MaidenAl/opencode_tmux_plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Automatic, per-window agent indicators for **OpenCode V2**. No hard-coded window
names, screen scraping, monitoring daemon, or model/API calls.

```text
⠋1:Backend    ✓2:Frontend    !3:Review    ✗4:Tests
```

See which OpenCode windows are working, finished, or waiting for you without
switching panes. Indicators follow pane moves and window renames, include
background subagents, and preserve your existing tmux theme.

| Indicator | Meaning |
| --- | --- |
| `⠋` (animated) | Working; spinner advances every 200 ms (five updates per second) |
| `!` | Waiting for a permission or an answer |
| `✗` | The latest execution failed |
| `✓` | Execution finished; stays until the next run |
| None | No tracked work, a new idle session, or an interrupted run |

Priority is **attention → working → error → done**. A checkmark means the run
ended, not that its work is correct or its tests passed.

## Quick start

Tested with **OpenCode 2.2.6** and **tmux 3.5a on Linux**. The plugin runs in
OpenCode itself: no build step, npm installation, or separate Node process is
needed to use it.

### 1. Clone the plugin

```sh
git clone https://github.com/MaidenAl/opencode_tmux_plugin.git "$HOME/.local/share/opencode_tmux_plugin"
```

This is a source installation; the plugin is **not published to npm**. Keep the
clone in place while using it. A Unicode-capable terminal font is needed for the
spinner and status symbols. Other OpenCode/tmux versions and operating systems
have not been verified.

### 2. Enable it in OpenCode

Add the clone's **absolute path** to the existing `plugins` array in
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/home/YOUR_USERNAME/.local/share/opencode_tmux_plugin"]
}
```

Replace `/home/YOUR_USERNAME` with your home directory (for example,
`/Users/YOUR_USERNAME` on macOS); the JSON example is not a literal install path.
Use `printf '%s\n' "$HOME/.local/share/opencode_tmux_plugin"` to print yours.
Do not rely on shell variables or `~` being expanded inside JSON.

**Merge the entry; do not replace your other settings or plugins.** CLI config
reloads automatically; `/reload` can force a reload. No server restart is needed.
Launch OpenCode normally inside tmux. Outside tmux, this plugin does nothing.

Enabling it here applies globally for your user; no project configuration is
necessary.

### Updating

```sh
git -C "$HOME/.local/share/opencode_tmux_plugin" pull --ff-only
```

Then run `/reload` in each running OpenCode TUI to load the updated plugin.

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

The TUI's reactive session data drives state changes immediately. While working,
the spinner and attached clients refresh every **200 ms**; idle sessions only
renew their **five-second pane lease** once a second. Theme checks and client
discovery remain on a one-second maintenance interval, not every animation
frame. Updates and client refreshes share a single tmux command invocation per
frame. The plugin does not poll session status or inspect terminal output.

tmux options hold only a fixed state, spinner glyph, timestamp, and
reload-ownership token; no prompts, session titles, file contents, or credentials
are written to tmux.
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
   cd "$HOME/.local/share/opencode_tmux_plugin"
   npm run tmux:uninstall
   ```

The removal command touches only this plugin's format reference and namespaced
options; it preserves the rest of your formatting. Nothing is persisted in
`.tmux.conf`, so restarting a tmux server also clears the integration.

## Troubleshooting

- **No indicator:** launch OpenCode inside tmux and check that the absolute path
  in `cli.json` points to the clone containing `package.json`. Idle sessions have
  no indicator; start an execution to check it. tmux must be on `PATH`.
- **A custom status bar hides indicators:** themes that bypass tmux's standard
  window-status formats must include `#{T:@opencode_tmux_badge}` themselves.
- **Symbols are missing or misaligned:** use a terminal font with the Unicode
  braille and checkmark/cross glyphs used above.
- **An indicator briefly remains after a crash:** leases expire after five
  seconds, but the visible bar clears only at the next tmux status redraw.
- **“Could not update tmux status” warning:** check the tmux server/socket is
  reachable from the TUI. If indicators do not resume after restoring the
  connection, run `/reload` to reconnect the plugin.

For other problems, [open an issue](https://github.com/MaidenAl/opencode_tmux_plugin/issues/new/choose)
with your OpenCode, tmux, Node.js, and OS versions. Never include credentials or
private prompts in logs.

## Development / verification

Node.js 24 and npm 11.17.0 are used for development; tmux and the Linux `script`
utility (util-linux) must be on `PATH`.
Dependency lifecycle scripts are disabled by `.npmrc`.

```sh
npm ci
mkdir -p /tmp/opencode
npm test
npm run typecheck
npm run test:runtime
```

- Unit tests cover status priority, fresh/interrupted/completed sessions, open
  tabs, nested subagents, and clearing old child failures.
- Integration tests create private tmux sockets under `/tmp/opencode`, verifying
  multiple panes, pane moves/renames, format preservation, lease expiry,
  reload ownership, removal, and actual sub-second redraws in an attached terminal.
- The runtime test requires `opencode` and Linux `ps` on `PATH`. It copies only
  the distributable (no `node_modules`), launches a real OpenCode server/TUI in a
  private tmux session, uses separate HOME/XDG directories, and supplies a local
  mock model. It verifies execution, child sessions, questions, permission
  approval, provider errors, normal exit, and an actual SIGKILL. It uses **no
  personal credentials or paid models** and removes its own test environment.

See [SECURITY.md](SECURITY.md) for the development dependency audit.

GitHub Actions runs type checking, unit/tmux integration tests, and a dependency
audit on pushes and pull requests. The real OpenCode runtime test is a separate
local check; CI does not install or launch OpenCode. There is no build step or
separate lint command.

## Project structure

```text
src/
  tui.ts          OpenCode plugin entrypoint and reactive lifecycle
  view.ts         Open tabs and session-family selection
  status.ts       Pure session-to-indicator state reduction
  tmux.ts         Pane leases, window formats, animation, and cleanup
  uninstall.ts    Explicit removal of plugin-owned tmux state
test/
  *.test.ts       Unit tests and isolated tmux integration tests
  runtime.ts      End-to-end test with real OpenCode and a local mock model
.github/          CI workflow and contribution templates
```

## Contributing

Bug reports, documentation fixes, and focused pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and test isolation details.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Mohammad Alavi. This is an independent community plugin,
not an official OpenCode or tmux project.

## Sources

- [OpenCode TUI plugin API](https://opencode.ai/docs/build/plugins/cli)
- [CLI-only plugin loading](https://opencode.ai/docs/cli/plugins)
- [CLI configuration](https://opencode.ai/docs/cli/config)
- [OpenCode API and event schemas](https://opencode.ai/docs/api)
- [Custom provider for the local test model](https://opencode.ai/docs/providers#custom)
- [Solid reactive effects](https://docs.solidjs.com/reference/basic-reactivity/create-effect)
- tmux 3.5a's installed `man tmux`: user options, `P:` / `T:` formats, arithmetic,
  `window-status-format`, and `refresh-client`.
