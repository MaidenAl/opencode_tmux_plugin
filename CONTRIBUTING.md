# Contributing

Thanks for helping improve the plugin. Keep changes focused and preserve users'
existing tmux formatting and unrelated OpenCode configuration.

## Development setup

Use Node.js 24 and npm 11.17.0. On Linux, install tmux and util-linux (for
`script`); the integration tests require both on `PATH`. The currently verified
host versions are OpenCode 2.2.6 and tmux 3.5a.

```sh
git clone https://github.com/MaidenAl/opencode_tmux_plugin.git
cd opencode_tmux_plugin
npm ci
mkdir -p /tmp/opencode
npm run typecheck
npm test
```

If contributing through a fork, clone your fork instead. Dependency lifecycle
scripts are intentionally disabled by `.npmrc`; do not enable them globally or
use forced audit fixes. The lockfile pins the development SDK to the tested
OpenCode version. See [SECURITY.md](SECURITY.md) for known development-only
dependency advisories.

## Tests

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Strict TypeScript checking of source and tests |
| `npm test` | Status/view unit tests and real tmux integration tests |
| `npm run test:runtime` | Real OpenCode TUI/server with a local mock model |
| `npm audit --audit-level=high` | Dependency audit; known moderate findings are documented |
| `npm audit --omit=dev` | Audit without development dependencies |

`npm test` creates private tmux sockets under `/tmp/opencode` and cleans up its
own sessions. It does not attach to your tmux server. There is no build step
or separate lint command.

For changes to the plugin lifecycle, SDK integration, or tmux behavior, also run
`npm run test:runtime` on Linux with `opencode` 2.2.6 and `ps` on `PATH`. It uses
isolated HOME/XDG directories, a private server, and a localhost mock model: no
personal credentials or paid model calls are needed. It tests normal shutdown
and kills only the OpenCode process it created to verify crash cleanup. GitHub
Actions runs the other checks, not this host-dependent runtime test.

## Pull requests

1. Open an issue first for large changes or new behavior so scope can be agreed.
2. Create a branch, make a focused change, and add regression tests for behavior
   changes. Keep source in `src/` and tests in `test/`.
3. Run the checks above and update the README if installation, compatibility,
   indicators, or cleanup behavior changes.
4. Describe the problem, the change, and the exact checks you ran in your PR.
   Mention any runtime test you could not run rather than claiming it passed.

Use the existing TypeScript/ES module style. Avoid unrelated refactoring and
new dependencies unless they are necessary. Never commit local configuration,
credentials, private prompts, or captured sessions. Keep discussions respectful
and constructive.

By submitting a contribution, you agree that it can be distributed under this
project's [MIT license](LICENSE).

## Reporting problems

Include reproduction steps, expected/actual behavior, and your OS, OpenCode,
tmux, and Node.js versions. For theme problems, include a minimal redacted
window-status format. Follow [SECURITY.md](SECURITY.md) for vulnerabilities;
do not report them in a public issue.
