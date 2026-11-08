# Security notes

The plugin publishes only a fixed state, heartbeat timestamp, and owner token
to its own tmux socket. It does not read agent transcripts, access credentials,
call a model, or send telemetry. Pane IDs/statuses are validated; subprocesses
use `execFile` with a bounded timeout. `if-shell -F` evaluates a tmux format and
executes fixed tmux commands, not a system shell.

The local runtime tests intentionally use a localhost mock model and temporary
server credentials. They sanitize the child environment, isolate HOME/XDG and
tmux sockets, redact passwords from diagnostics, and allow only the test model.
Cleanup targets directories/sockets created by that test invocation, never an
inherited tmux server or the user's OpenCode database.

## Dependency audit — 2026-11-08

`npm audit` against the lockfile reports **0 critical, 0 high, 24 moderate**
findings, counting affected transitive packages. The underlying advisories are:

- `glob`: [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
  — cancellation bypass can continue filesystem traversal.
- `minimatch`: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  — pathological glob patterns can amplify resource consumption.

These enter through the pinned **development-only OpenCode SDK 2.2.6** dependency
tree. This plugin does not import either API or accept glob patterns. The runtime
test verifies that the distributable works without the development dependencies;
OpenCode supplies the TUI SDK and Solid runtime. npm reports no fix within the
SDK's supported dependency graph. Do not force-upgrade or override the host SDK
to silence the audit.

`npm audit --omit=dev` reports **0 vulnerabilities**.

**Disposition:** deferred, no identified vulnerable call path in the plugin.
Review by **2026-11-22**, or immediately on an OpenCode SDK update. Re-run the
audit and runtime tests before distributing a new version. This is not a claim
that OpenCode's own dependency tree is vulnerability-free.

Use `npm ci` with the checked-in `.npmrc`; dependency lifecycle scripts are
disabled. Do not run blanket audit fixes or enable all dependency scripts.
