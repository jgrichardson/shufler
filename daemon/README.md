# Shufler

A 3D control room for developers who run many AI coding agent sessions at once.

Shufler reads your terminal sessions (cmux, iTerm2 or tmux, or any other terminal in a watch-only mode), your agent transcripts (Claude Code and the OpenAI
Codex CLI) and your GitHub pull requests, and turns them into an interactive 3D world. Each terminal session is a
row, its PRs move left to right through stages of work, and anything that needs you lights up red.

This package is the local daemon and the `shufler` command. The built web app ships inside it, so nothing else is
needed to run it:

```bash
shufler setup     # pick your terminal; writes ~/.config/shufler/config.toml
shufler start     # http://127.0.0.1:4700
shufler mcp --print-config   # let Claude Code or Codex ask Shufler what is running
```

The full guide, screenshots and configuration reference are in the repository:
https://github.com/jgrichardson/shufler

MIT licensed.
