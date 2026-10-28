# Changelog

All notable changes to Shufler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-28

### Added

- A hosted demo at https://shufler.app (GitHub Pages): the web app on built-in sample data, with
  no daemon and every action simulated. `VITE_DEMO=1` and `SHUFLER_BASE` build it; `.github/workflows/pages.yml`
  publishes it on every push to `main`. Its status bar links back to the repository. The hosted demo shows a
  lighter floor of six rows and one or two PRs each; local `?mock=1` keeps the full sample world.
- Command Post, a sixth skin (`?skin=commandpost`): a field base on a
  living map, with compounds for rows, command tents and container cabins
  for sessions, supply convoys for work items, field facilities for stages,
  a signals hut for the library and a depot with a helipad for shipped work.
  Logistics and ops only. Light and dark themes, horizon camera scenery and
  big-island layout included; all geometry is procedural.
- Packaged installs. The daemon builds as a wheel and sdist named `shufler`
  that carry the built web app, so `pipx install` or `uv tool install` of a
  release wheel gives a working `shufler` command with no clone, Bun or Node.
  The package is on PyPI as `shufler`, and the wheel is also attached to the
  GitHub release.
- A `shufler` command for packaged installs, with the same commands as
  `bin/shufler` (`init`, `setup`, `start`, `stop`, `status`, `install`,
  `uninstall`, `library`, `mcp`, `version`) plus `serve`, which runs the
  daemon in the foreground for launchd and `brew services`. `python -m
  shufler` works too.
- A Homebrew formula for the project's own tap (`brew tap
  jgrichardson/shufler`), in `packaging/homebrew/shufler.rb`, with a
  `brew services` block.
- `install.sh`, a one-line installer: it checks for Python, uv or pipx,
  installs the latest release wheel with `uv tool` or `pipx`, then runs
  `shufler setup`. Running it again upgrades in place.
- `packaging/release.sh` builds the web app, the sdist and the wheel, smoke
  tests the wheel, fills the formula's URL and sha256, and prints what to
  publish. It publishes nothing itself.
- CI builds the wheel on macOS and Linux and smoke tests it: a clean venv,
  a throwaway home, `setup`, the daemon on a spare port, and the served web
  app (`packaging/smoke-test.sh`).
- Works in any terminal: `[terminal] kind = "none"` (offered by
  `shufler setup`, and what `auto` falls back to when no supported terminal
  is running; resolved once at daemon start, so set `kind` if the daemon starts at login before your terminal) draws one row per running `claude` or `codex`
  session straight from `ps`, with state, model, tokens, questions and PRs as
  usual. Sending, answering, skills, library send, Focus, new tabs and
  terminal sync are off.
- Greyed-out levers: the snapshot's `capabilities.terminal_caps` carries the
  active terminal's capability flags (new flag `can_follow`), and the web app
  shows every lever the terminal cannot pull as disabled with a tooltip that
  says why: session and item panel buttons, answer options, dispatch boxes,
  skill buttons, library sends, the palette, the `F` key, toast buttons and
  the terminal sync switch. Auto-send of pinned context skips quietly.
- Mock mode takes `?terminal=none` and `?caps_off=<flag>,...` to preview
  those states without a daemon.
- An MCP server, `shufler mcp`, so agents in Claude Code or Codex can ask
  Shufler what is running. Read-only tools: `status`, `needs_you`, `get_pr`,
  `read_session` and `list_work_items`. It is a client of the daemon's
  existing HTTP API.
- Opt-in dispatch tools for the MCP server (`[mcp] allow_dispatch = true`):
  `send_prompt` and `answer_question` return the daemon's preview and a
  one-time `confirm_id`, and only `confirm_dispatch` sends. The never-do
  guard, a control-character check, a no-self-target rule and a rate limit
  apply. `docs/MCP.md` has the threat model.
- `shufler mcp --print-config` prints setup lines for Claude Code and Codex.

### Changed

- The Python distribution is renamed from `shufler-daemon` to `shufler`, and
  the daemon now has a build backend (hatchling). `uv sync` installs the
  package into `daemon/.venv`, which adds a `shufler` command there.
- An installed copy reads its example config and web app from inside the
  package, and writes `actions.jsonl` to `~/.local/share/shufler/` rather
  than beside the code. A clone behaves as before.
- `shufler stop` and `status` only count a launchd job whose plist is in the
  current home directory.
- A refused terminal lever names the reason in plain words; in no-terminal
  mode: "no supported terminal is configured ..., pick a terminal with
  `shufler setup`". Additive contract changes: `capabilities.terminal_caps`,
  the `none` terminal kind and source key, and the `can_follow` flag. See
  `CONTRACT.md`.

## [0.2.0] - 2026-10-28

### Added

- OpenAI Codex CLI as a second agent harness. Codex sessions in cmux, iTerm2
  or tmux show as rows beside Claude Code ones, with state, model, tokens,
  turns, PRs and the conversation read from `~/.codex/sessions`.
- Codex approval prompts are read from the screen and answered with Codex's
  own keys (`y`, `a`, `Esc`) from the scene.
- A harness registry (`[agents] enabled`, auto-detect by default) and an entry
  point (`shufler.agents`) for adding more. `shufler setup` and `status` list
  the detected harnesses. See `docs/AGENTS.md`.
- A `harness` field on each station, a small harness badge on Codex rows, and
  Codex-format messages in the context library.
- A horizon view: `H`, the Horizon button in the layer bar or
  `?camera=horizon` tilts the camera low over the front rows so the sky, the
  skyline and each skin's landmarks fill the top of the frame. `H` again
  flies back to the view you had.
- Horizon scenery for the skins: a ringed gas giant for Starship, distant
  ridges for Factory and a hall haze for Casino, placed where the default
  view never looks.
- A big-island layout: **Grid | Islands** in the top bar, `I` or
  `?layout=islands` gives each session its own large island with a loop of
  track and a lit stop for every stage, and pods ride the loop to their
  stage. The grid stays the default, the choice is saved in the browser, and
  Pipeline view always draws the grid.
- The horizon view works over both layouts; switching layout while it is on
  keeps it on and re-frames it.
- `bin/shufler version`, and a fuller `bin/shufler --help`.

### Changed

- `pending_question` may carry `kind`, `source` and a `key` per option, and
  `capabilities` lists the enabled `agents`. Both are additive; see
  `CONTRACT.md`.
- Row headers slim down while the horizon view is on, and become name tags
  under each island in the big-island layout.

### Fixed

- Theme Park's lawn now meets the sky without a seam when seen from low.
- Casino no longer shows a black void above its walls from a low camera.

## [0.1.0] - 2026-10-27

The first public release.

### Added

- A 3D control room that shows every AI coding agent session as a row, and
  every pull request as a car riding from idea to production.
- Terminal adapters for cmux, iTerm2 and tmux, chosen with `shufler setup`,
  plus an entry point (`shufler.terminals`) for adding more.
- Click a row to focus its terminal tab or pane.
- Your-move highlighting, pull request gates, levers with a confirmation
  preview, and answering an agent's question from the scene.
- Pods, a pipeline board, domains, a warehouse, a context library, a fleet
  view, a skills palette, an event ticker and history, and layers.
- Five skins: Starship, Factory, Sky Islands, Theme Park and Casino, each in
  light and dark.
- An optional reviewer bot, work-item intake, ledgers and a board, and custom
  commands, all configured in `~/.config/shufler/config.toml`.
- A mock mode (`?mock=1`) for trying it without any setup.

[0.3.0]: https://github.com/jgrichardson/shufler/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jgrichardson/shufler/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jgrichardson/shufler/releases/tag/v0.1.0
