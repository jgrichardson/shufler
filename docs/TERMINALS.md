# Terminals

Shufler draws one row per terminal pane or workspace that hosts an agent session. It reads the rows from
your terminal, and it types prompts, reads the screen and focuses panes through that terminal. The core
daemon does not depend on any one terminal: everything terminal-specific lives in a small adapter under
`daemon/shufler/adapters/terminal/`.

| Terminal | Status | Mechanism | Extra dependency |
|---|---|---|---|
| [cmux](#cmux) | supported (the original) | the `cmux` CLI | none |
| [iTerm2](#iterm2) | supported | AppleScript through `osascript` | none (macOS Automation permission) |
| [tmux](#tmux) | supported | the `tmux` CLI | none |
| [any other (`none`)](#no-terminal-none) | supported, watch only | rows from running agent processes (`ps`) | none |

## Choosing your terminal

```bash
shufler setup                      # interactive: lists every terminal, detected one is the default
shufler setup --yes                # accept the current or detected choice (scripts, CI)
shufler setup --terminal iterm2    # pick one without prompts
shufler setup --terminal tmux --set rows=window --set socket_name=work
shufler setup --terminal none      # any other terminal: rows from the running sessions, no terminal levers
shufler status                     # shows the active terminal and whether it is reachable
```

`shufler setup` lists every registered terminal with what it found (installed, running), marks the current
choice and the detected one, asks for that terminal's options and writes them to your config file
(`~/.config/shufler/config.toml`, or `$SHUFLER_CONFIG`). When the file does not exist yet it is created
from `daemon/config.example.toml` first. Running it again shows the current choice and lets you change it;
pressing Enter at every question keeps what you have. `shufler start` runs setup by itself the first time,
when no config exists (with `--yes` when there is no keyboard attached).

What setup writes:

```toml
[terminal]
kind = "iterm2"          # "cmux" | "iterm2" | "tmux" | "none" | "auto"

[iterm2]
group_by = "window"      # or "tab_prefix"
prefix_separator = " · "
```

`kind = "auto"` (the default when `kind` is missing) picks the first terminal that is running, in the order
cmux, iTerm2, tmux (then any plug-in); if none is running, `none`. An installed terminal that is not running is not chosen. `auto` is resolved once, when the daemon starts, so a daemon that starts at login before the terminal app falls back to `none` until it is restarted or `kind` is set explicitly (for example `kind = "iterm2"`). The `utility` and `processes` options (see
`daemon/config.example.toml`) live under `[terminal]`, next to `kind`. The environment variable
`SHUFLER_TERMINAL=iterm2` overrides `kind` for one run, which is handy for a second test daemon.

The snapshot reports the active terminal in `capabilities.terminal`, what it can do in
`capabilities.terminal_caps` (see [Capability flags](#capability-flags)), and its health under
`sources.<terminal>` (`sources.cmux`, `sources.iterm2`, `sources.tmux`, `sources.none`).

## How each terminal maps

| | cmux | iTerm2 | tmux |
|---|---|---|---|
| Row | a workspace | a session (one pane) | a pane (`rows = "pane"`) or a window (`rows = "window"`) |
| Row id | workspace UUID | session unique id (UUID) | pane id `%3` or window id `@1` |
| Title | workspace title | session name, else tab title | window name (`name.N` when the window has several panes) |
| Group | cmux workspace group (with its anchor) | one per window, named from the window title; or the tab title prefix (`AUTH · login` → `AUTH`) | one per tmux session |
| Order | the sidebar index | window creation order, then tab, then pane | session, then window index, then pane index |
| cwd | workspace directory | the session's `path` variable, else the cwd of the foreground process on its tty | `pane_current_path` |
| Focused row (Follow) | the selected workspace | the current session of the current window | the active pane of the active window in the most recently attached session |
| Process match | `CMUX_WORKSPACE_ID` in the process env | `ITERM_SESSION_ID` in the env, else the tty | `TMUX_PANE` in the env, else the tty |

Running agent processes (`claude`, `codex`; see [`AGENTS.md`](AGENTS.md)) are matched to rows by, in order:
the terminal's id in the process environment, the process's tty (when exactly one row owns it), the joined
session id, then a cwd that belongs to one row only. When the terminal reports ttys (iTerm2 and tmux do), a process on a tty that none of its rows
owns runs in some other terminal and is ignored, so a daemon pointed at tmux does not claim sessions that
run in cmux.

## cmux

Nothing to set up beyond the binary path, which setup detects:

```toml
[cmux]
bin = "/Applications/cmux.app/Contents/Resources/bin/cmux"
```

Rows follow the sidebar, groups and their anchors come from `cmux workspace-group list`, and a workspace
description of the form `● <state> · <text>` is read as the row's note (a note file for the same session
wins; see `[notes] dir` in `daemon/config.example.toml`).

## iTerm2

```toml
[iterm2]
group_by = "window"        # one group per window, named from its title
# group_by = "tab_prefix"  # group by tab-title prefix: "AUTH · login" goes in AUTH; no prefix = ungrouped
prefix_separator = " · "
# osascript = "/usr/bin/osascript"
```

Shufler talks to iTerm2 with AppleScript. The commands live in one script,
`daemon/shufler/adapters/terminal/iterm2.applescript`, so every action preview is one readable line such
as `osascript …/iterm2.applescript write <session-id> 'status'`.

**Why AppleScript and not the iTerm2 Python API.** AppleScript needs no extra package, no API server and no
cookie, and it covers everything Shufler needs: list windows, tabs and sessions with their ids, names, ttys
and the `path` variable; `write text`; `contents` to read the screen; `select` to focus; `create tab` to open.
The Python API (the `iterm2` package over a websocket) would add a dependency, an asyncio client and a second
permission (Settings > General > Magic > Enable Python API), for no capability this adapter uses. A listing
of a handful of sessions takes well under a second, so the row list is polled every 3 seconds.

### The Automation permission

The first time Shufler drives iTerm2, macOS asks whether the app running Shufler may control iTerm2. Allow
it. If you denied it, open System Settings > Privacy & Security > Automation and turn on iTerm2 under that
app. `shufler status` tells you whether it is granted:

```
terminal: iterm2 (configured), reachable: 3 windows, Automation permission granted
```

The permission belongs to the program that runs `osascript`:

- `shufler dev` or `shufler start` without launchd: the daemon is a child of your terminal, so the
  terminal app (iTerm2, Terminal, cmux, ...) is the one asking.
- `shufler install` (launchd): the daemon's Python is started by launchd, not by a terminal. macOS should
  ask once for that Python binary in your login session. This path has not been verified yet. If the source
  `iterm2` stays offline with "Automation permission denied" and no prompt appeared, run
  `tccutil reset AppleEvents`, restart the daemon and watch for the prompt, or run the daemon with
  `shufler start` from a terminal that already has the permission.

### What works and what is limited

- Works: rows, groups by window or tab prefix, ordering, cwd, focused-row Follow, process matching by
  `ITERM_SESSION_ID` and tty, dispatch / answer / run-skill / library send (type, Return, read the screen
  back), Focus, and "open a new tab here" (a new tab in the same window that `cd`s to the session's path).
- iTerm2 has no workspace groups, colours, descriptions or listening ports, so rows have no colour and no
  note from the terminal itself (note files from `[notes] dir` still join; a `[[commands]]` entry of yours can write them).
- Window titles follow the active session's title in many profiles, so a group named after a window can be
  renamed when you switch panes. Name your tabs and use `group_by = "tab_prefix"` for stable groups.
- Rows follow window creation order, not the on-screen z-order: following z-order would reshuffle the floor
  each time you click another window.
- Focus brings iTerm2 to the front (`activate`).

## tmux

```toml
[tmux]
rows = "pane"              # or "window" (targets the window's active pane)
# bin = "/opt/homebrew/bin/tmux"
# socket_name = "work"     # tmux -L work
# socket_path = "/tmp/tmux.sock"  # tmux -S /tmp/tmux.sock
```

- Commands: `list-panes -a -F …` to list, `send-keys -t <pane> -l -- <text>` then `send-keys -t <pane> Enter`
  to type, `capture-pane -p -t <pane> -S -<n>` to read, `select-window` + `select-pane` to focus,
  `split-window -c '#{pane_current_path}'` to open a new pane next to the row.
- Focus selects the window and pane on the tmux server. A client attached to that session shows it; Shufler
  does not switch an attached client to another tmux session, because that needs the client's name.
- tmux has no colours, descriptions or ports for rows.

## No terminal (`none`)

```toml
[terminal]
kind = "none"
```

For any terminal Shufler has no adapter for (Terminal.app, Ghostty, WezTerm, Kitty, Warp, an editor's
terminal, a session over ssh), or when you only want to watch. Rows come from the running agent processes
themselves, the same `ps` scan that tells open sessions from closed ones elsewhere (see
[`AGENTS.md`](AGENTS.md)), every 3 seconds:

| | none |
|---|---|
| Row | a tty that runs an interactive `claude` or `codex` (a process without a tty gets its own row) |
| Row id | `tty-<tty>` (`tty-ttys003`), else `pid-<pid>` |
| Title | the session's `--name`, else its cwd's basename (`api`, `api.2`, ... when several share it) |
| Group | none: every row is in the ungrouped hall |
| Order | oldest session first |
| cwd | the process's cwd (`lsof`), or its `codex -C` directory |
| Focused row (Follow) | none |
| Process match | each process carries its row id, so it always lands on its own row |

State, model, tokens, context, questions, approvals read from transcripts, notes and PRs join exactly as with
any terminal. What needs a terminal is off: every capability flag is `False`, so the web greys out sending a
prompt, answering a question, running a skill, library send, Focus, new tabs and terminal sync (each with a
tooltip saying why), and the daemon refuses them with "no supported terminal is configured ..., pick a terminal
with `shufler setup`". The adapter's command builders raise if anything calls them past that check.

Limits: a session that exits takes its row with it (no pane is left to show as closed). The Codex approval
overlay cannot be read off the screen; an escalated command still shows as a pending approval from the rollout
(see [`AGENTS.md`](AGENTS.md)), and you answer it in the session's own window. `[terminal] processes = false` has no effect here, since the processes are the rows.

## Writing a terminal adapter

A terminal adapter is one Python module plus one line in the registry. Wezterm, Kitty, Ghostty, Zellij or
Windows Terminal would each be a good first contribution.

### The contract

`daemon/shufler/adapters/terminal/__init__.py` defines `TerminalAdapter` and documents the two records the
core reads.

A **workspace record**, one per row, in display order:

| key | meaning |
|---|---|
| `id` | stable unique id; if your terminal exports it to child shells, processes can be matched by env |
| `ref` | the handle your action builders target (often the same as `id`) |
| `index` | 0-based position, top to bottom; rows follow it |
| `title`, `custom_title` | display title (`custom_title` wins when set) |
| `custom_color` | hex colour or `None` |
| `description` | text under the title, or `None` |
| `current_directory` | cwd or `None` |
| `listening_ports` | list, may be empty |
| `latest_submitted_at` | ISO time or `None` |
| `pinned`, `selected` | bools; `selected` marks the focused row |
| `ttys` | tty names (`"ttys003"`) owned by the row; used to match agent processes; may be empty |

The field names come from cmux, the first adapter; every adapter fills the same keys.

A **group record**, in display order: `name` (unique), `ref`, `color`, `members` (workspace refs), `pinned`,
`anchor` (a workspace ref drawn as the group header and dropped from the rows, or `None`).

The class:

| member | what it does |
|---|---|
| `name` | the `[terminal] kind` value and `capabilities.terminal` |
| `label` | display name used in messages ("finish or clear it in iTerm2 first") |
| `caps` | capability flags, below |
| `poll_interval` | seconds between row listings |
| `CONFIG_DEFAULTS` | the keys your `[<name>]` config section takes, with defaults |
| `detect(cfg)` (classmethod) | `Detection(installed, running, detail)` for setup and `kind = "auto"`; must be quick and must not change anything |
| `from_config(cfg)` (classmethod) | build the adapter from the whole parsed config |
| `check()` | `(ok, detail)` for `shufler status` |
| `list_workspaces()`, `list_groups()` | the records above |
| `focus_argv(ws)` | argv that brings the row forward |
| `list_surfaces_argv(ws)` + `first_terminal_surface(out)` | argv whose output names the pane to type into, and its parser |
| `send_text_argv(ws, surface, text)` | argv that types text without Enter |
| `send_key_argv(ws, surface, key)` | argv that presses a key; `"Return"` is the one the core uses |
| `read_screen_argv(ws, surface, lines)` | argv that prints the last lines of the screen |
| `open_surface_argv(ws)` + `new_surface_ref(out)` | argv that opens a new terminal next to the row, and the parser for its id |

Builders return argv lists and never run anything themselves: the confirm panel shows exactly what will run,
and the never-do guard checks every step. The surface arguments may be the placeholders
`<first-terminal-surface>` and `<new-surface>`, which the action runner fills from the previous step's output.

### Capability flags

`can_send`, `can_focus`, `can_read_screen`, `can_open`, `has_groups`, `can_follow`. Set a flag to `False` when
your terminal cannot do it; a flag you leave out counts as supported. The snapshot carries them as
`capabilities.terminal_caps`, and the web greys out each lever whose flag is off, with a tooltip that says why.
The daemon also refuses such a lever with a plain message ("the X adapter cannot focus a session; this lever is
off for this terminal") instead of running a command that cannot work; an adapter can word it itself with a
`refusal` attribute, a format string with `{what}`.

| flag | levers it gates |
|---|---|
| `can_send` + `can_read_screen` | dispatch, answer a question, post-merge close-out, new work item, run a skill, library send (the daemon reads the input box before typing so it never clobbers a half-typed draft) |
| `can_focus` | Focus (buttons, the `F` key, the palette, the Focus button on a toast) |
| `can_open` | new tab or pane next to a row |
| `can_read_screen` | also the Codex approval screen probe |
| `can_follow` | terminal sync (Follow): the adapter marks the focused row with `selected` |
| `has_groups` | informational: rows land in the ungrouped hall |

### Skeleton

```python
# daemon/shufler/adapters/terminal/wezterm.py
from __future__ import annotations

from ... import runner
from .._util import json_cmd
from .base import ALL_CAPS, Detection, find_bin, section, short_tty


class WeztermAdapter:
    name = "wezterm"
    label = "WezTerm"
    caps = dict(ALL_CAPS)   # or {**ALL_CAPS, "has_groups": False}
    poll_interval = 2.0
    CONFIG_DEFAULTS = {"bin": "wezterm"}

    def __init__(self, bin_path: str = "wezterm"):
        self.bin = bin_path

    @classmethod
    def from_config(cls, cfg: dict) -> "WeztermAdapter":
        return cls(section(cfg, "wezterm").get("bin") or "wezterm")

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        b = find_bin(cls.from_config(cfg or {}).bin)
        if not b:
            return Detection(False, False, "wezterm not found")
        r = runner.run([b, "cli", "list", "--format", "json"], timeout=5)
        return Detection(True, r.ok, f"bin {b}")

    def check(self) -> tuple[bool, str]:
        try:
            return True, f"{len(self.list_workspaces())} panes"
        except Exception as e:  # noqa: BLE001
            return False, str(e)[:200]

    def list_workspaces(self) -> list[dict]:
        panes = json_cmd([self.bin, "cli", "list", "--format", "json"], timeout=10)
        return [{"id": str(p["pane_id"]), "ref": str(p["pane_id"]), "index": i, "title": p.get("title"),
                 "custom_title": None, "custom_color": None, "description": None,
                 "current_directory": p.get("cwd"), "listening_ports": [], "latest_submitted_at": None,
                 "pinned": False, "selected": bool(p.get("is_active")),
                 "ttys": [t] if (t := short_tty(p.get("tty_name"))) else []}
                for i, p in enumerate(panes)]

    def list_groups(self) -> list[dict]:
        return []           # no groups: every row lands in the ungrouped hall

    def focus_argv(self, ws): return [self.bin, "cli", "activate-pane", "--pane-id", ws]
    def list_surfaces_argv(self, ws): return ["echo", ws]
    def send_text_argv(self, ws, surface, text): return [self.bin, "cli", "send-text", "--pane-id", surface, "--no-paste", text]
    def send_key_argv(self, ws, surface, key): return [self.bin, "cli", "send-text", "--pane-id", surface, "--no-paste", "\r"]
    def read_screen_argv(self, ws, surface, lines): return [self.bin, "cli", "get-text", "--pane-id", surface]
    def open_surface_argv(self, ws): return [self.bin, "cli", "split-pane", "--pane-id", ws]

    @staticmethod
    def first_terminal_surface(out: str) -> str | None:
        return out.strip() or None

    @staticmethod
    def new_surface_ref(out: str) -> str | None:
        return out.strip() or None
```

(The WezTerm commands above are illustrative; check them against `wezterm cli --help`.)

Register it with one line in `REGISTRY` in `adapters/terminal/__init__.py`:

```python
REGISTRY = {"cmux": CmuxAdapter, "iterm2": ITerm2Adapter, "tmux": TmuxAdapter, "wezterm": WeztermAdapter,
            "none": NoTerminalAdapter}  # keep "none" last: auto-detect picks a running terminal, else it
```

or, from a separate package, with an entry point (no change to Shufler itself):

```toml
[project.entry-points."shufler.terminals"]
wezterm = "my_package.wezterm:WeztermAdapter"
```

If your terminal exports a pane id to child shells (like `ITERM_SESSION_ID` or `TMUX_PANE`), add a regex for it
in `daemon/shufler/processes.py` so running agent processes match by env; otherwise tty matching works as
long as you fill `ttys`.

### Testing

Tests never talk to a real terminal. Every command goes through `shufler.runner.run`, so monkeypatch it and
return canned output:

```python
from shufler import runner
from shufler.runner import RunResult

def test_wezterm_rows(monkeypatch):
    monkeypatch.setattr(runner, "run", lambda argv, timeout=30, env=None:
                        RunResult(0, '[{"pane_id": 3, "title": "api", "cwd": "/w", "tty_name": "/dev/ttys004"}]', ""))
    ws = WeztermAdapter().list_workspaces()
    assert ws[0]["id"] == "3" and ws[0]["ttys"] == ["ttys004"]
```

`daemon/tests/test_terminal_adapters.py` has worked examples for iTerm2 and tmux: canned listings, argv
builders, groups, ordering, process matching by tty, capability gating and the snapshot built from the
adapter's rows. If you test against a live terminal by hand, use a throwaway window, session or server
(`tmux -L scratch`), never the ones you are working in.

### Checklist

- [ ] `name`, `label`, `caps`, `poll_interval`, `CONFIG_DEFAULTS`, `detect`, `from_config`, `check`
- [ ] `list_workspaces` fills every key of the workspace record, in display order, `index` 0..n-1
- [ ] `list_groups` returns unique names (or `[]`), members are workspace refs
- [ ] `ttys` filled when the terminal knows them, so processes match
- [ ] every builder returns argv (no shell strings), and `Return` works in `send_key_argv`
- [ ] `detect` is read-only and fast (a few hundred ms at most)
- [ ] capability flags off for anything the terminal cannot do
- [ ] one line in `REGISTRY` (or an entry point), a `[<name>]` section with comments in `config.example.toml`
- [ ] unit tests with a mocked `runner.run`; `cd daemon && uv run pytest -q` is green
- [ ] a section in this file: mapping, setup, limits

## Contributing an adapter

Open an issue first if the terminal needs a new dependency or a change outside `adapters/terminal/` and
`processes.py`; most adapters need neither. Keep the daemon's wire contract (`CONTRACT.md`) and the snapshot
shape unchanged: an adapter only fills the workspace and group records. In the pull request, list what you
tested live and on which terminal version, and what the adapter cannot do.
