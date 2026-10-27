# Changelog

All notable changes to Shufler are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/jgrichardson/shufler/releases/tag/v0.1.0
