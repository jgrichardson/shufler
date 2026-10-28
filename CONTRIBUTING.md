# Contributing

Shufler is a 3D control room for developers who run many AI coding agent sessions at once. Bug reports, adapters for more terminals and tools, and new skins are all welcome.

## Run it

```bash
bin/shufler init     # writes ~/.config/shufler/config.toml from daemon/config.example.toml
$EDITOR ~/.config/shufler/config.toml
cd web && bun install && bun run build && cd ..
bin/shufler start    # http://127.0.0.1:4700
bin/shufler test     # daemon tests (uv + pytest)
cd web && npx tsc --noEmit && npx vitest run
```

`bin/shufler dev` runs the daemon with reload plus the Vite dev server.

## Packaging

The daemon is a Python package (`daemon/pyproject.toml`, hatchling). A wheel built from a checkout picks up `web/dist` as `shufler/web` and the example config as `shufler/config.example.toml` (see `daemon/hatch_build.py`), so build the web app first. `daemon/README.md` is the short package description and `daemon/LICENSE` is a copy of `LICENSE`; keep them in step.

```bash
packaging/release.sh             # web build, sdist, wheel, smoke test, filled-in Homebrew formula, in dist/
packaging/smoke-test.sh dist/shufler-*.whl 4781   # install a wheel in a clean venv and run it on port 4781
```

`release.sh` prints the publishing steps (GitHub release, PyPI, the tap) and does none of them.

## Add an adapter

Adapters live in `daemon/shufler/adapters/<kind>/`. Each kind has a Protocol in its `__init__.py`: terminal, agent, scm, review or tracker. Terminals have a guide in [`docs/TERMINALS.md`](docs/TERMINALS.md) and agent harnesses (Claude Code and Codex today) in [`docs/AGENTS.md`](docs/AGENTS.md); both can also ship as a separate package through an entry point (`shufler.terminals`, `shufler.agents`).

1. Add a module next to the existing implementation, for example `terminal/tmux.py` with a `TmuxAdapter`, and implement every Protocol method. Command builders return argv lists and never run a shell.
2. Register it in `adapters.from_config()` (terminals: the registry in `adapters/terminal/__init__.py`, chosen by `[terminal] kind`; agent harnesses: the registry in `adapters/agent/__init__.py`, chosen by `[agents] enabled`), and add the keys it needs to `daemon/config.example.toml` with commented examples.
3. Add tests under `daemon/tests/` with fixture output from the real tool. Keep fixtures free of real names, emails, PR titles and paths, and use names like `acme/widgets`.
4. If the adapter can be off, make sure `config.capabilities()` reports it so the web hides its levers.

## Rules

- The daemon binds to 127.0.0.1 only. No action may kill processes, force-push, remove worktrees, reset --hard, or post to chat or email. The never-do guard in `actions.py` enforces this.
- `CONTRACT.md` is the snapshot and action schema shared by the daemon and the web. Change it first when a field changes.
