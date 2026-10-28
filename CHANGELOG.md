# Changelog

All notable changes to Shufler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A hosted demo on GitHub Pages (https://jgrichardson.github.io/shufler/): the web app on built-in sample data, with
  no daemon and every action simulated. `VITE_DEMO=1` and `SHUFLER_BASE` build it; `.github/workflows/pages.yml`
  publishes it on every push to `main`. Its status bar links back to the repository. The hosted demo shows a
  lighter floor of six rows and one or two PRs each; local `?mock=1` keeps the full sample world.

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

[Unreleased]: https://github.com/jgrichardson/shufler/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jgrichardson/shufler/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jgrichardson/shufler/releases/tag/v0.1.0
