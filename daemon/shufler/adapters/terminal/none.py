"""No terminal: one row per running agent session, read straight from `ps` (processes.py).

For a terminal Shufler has no adapter for (Terminal.app, Ghostty, WezTerm, an editor's terminal, ssh, ...), or when
you only want to watch. Rows come from the interactive `claude` and `codex` processes themselves, so state, model,
tokens and PRs join from the transcripts exactly as with any terminal. What only a terminal can do is off: typing a
prompt, reading the screen, focusing or opening a pane, and reporting the focused row (Follow). Every such lever is
refused by its capability flag before a builder runs; the builders below raise if anything calls them anyway.

Mapping:
- rows: one per tty that runs an agent session (a process without a tty gets its own row), oldest first;
- row id: `tty-<tty>` (`tty-ttys003`), else `pid-<pid>`; every scanned process carries its row id as
  `workspace_id`, so the snapshot matches it to its row like an env match;
- title: the `--name` of the session, else the cwd's basename (`name.2`, `name.3` when several rows share it);
- groups: none. A session that exits takes its row with it (there is no pane left to show as closed).
"""

from __future__ import annotations

import os
import threading
import time

from .base import CAPABILITY_FLAGS, Detection


def row_id(p: dict) -> str:
    return f"tty-{p['tty']}" if p.get("tty") else f"pid-{p['pid']}"


class NoTerminalAdapter:
    name = "none"
    label = "no terminal"
    caps = {f: False for f in CAPABILITY_FLAGS}
    poll_interval = 3.0
    CONFIG_DEFAULTS: dict = {}
    # actions.plan() words a refused lever with this instead of "the <label> adapter cannot ..."
    refusal = ('no supported terminal is configured ([terminal] kind = "none"), so Shufler cannot {what}; '
               "pick a terminal with `shufler setup` to turn this lever on")

    def __init__(self, scanner=None):
        if scanner is None:
            from ...processes import ProcessScanner
            scanner = ProcessScanner()
        self.scanner = scanner
        self._procs: list[dict] | None = None
        self._at = 0.0
        self._lock = threading.Lock()

    @classmethod
    def from_config(cls, cfg: dict) -> "NoTerminalAdapter":
        return cls()

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        # always "installed", never "running": auto-detect falls back to it only when no real terminal is found
        return Detection(True, False, "always available: rows from running agent sessions; send and focus are off")

    def check(self) -> tuple[bool, str]:
        try:
            n = len(self.list_workspaces())
        except Exception as e:  # noqa: BLE001
            return False, f"{type(e).__name__}: {e}"[:200]
        return True, f"{n} agent sessions running (rows from ps; send, answer and focus are off)"

    def agent_processes(self) -> list[dict]:
        """The latest agent process scan, each tagged with its row id. The row list and the `processes` source
        (collectors.py) share it, so one `ps` per tick serves both and a row never lacks its process."""
        with self._lock:
            if self._procs is None or time.time() - self._at >= self.poll_interval / 2:
                self._procs = [{**p, "workspace_id": row_id(p)} for p in self.scanner()]
                self._at = time.time()
            return [dict(p) for p in self._procs]

    def list_workspaces(self) -> list[dict]:
        rows: dict[str, dict] = {}
        for p in sorted(self.agent_processes(), key=lambda p: (p.get("since") or 0, p["pid"])):
            rid = p["workspace_id"]
            if rid in rows:
                continue  # a second session on the same tty: one row, as one pane would be
            cwd = p.get("cwd")
            rows[rid] = {
                "id": rid, "ref": rid, "title": p.get("name") or (os.path.basename(cwd.rstrip("/")) if cwd else None)
                or p.get("harness") or "session", "custom_title": None, "custom_color": None, "description": None,
                "current_directory": cwd, "listening_ports": [], "latest_submitted_at": None, "pinned": False,
                "selected": False, "ttys": [p["tty"]] if p.get("tty") else [],
            }
        seen: dict[str, int] = {}
        out = []
        for i, r in enumerate(rows.values()):
            n = seen[r["title"]] = seen.get(r["title"], 0) + 1
            out.append({**r, "index": i, "title": r["title"] if n == 1 else f"{r['title']}.{n}"})
        return out

    def list_groups(self) -> list[dict]:
        return []

    def _off(self, what: str):
        raise RuntimeError(self.refusal.format(what=what))

    def focus_argv(self, ws: str) -> list[str]:
        self._off("focus a session")

    def list_surfaces_argv(self, ws: str) -> list[str]:
        self._off("find a session's pane")

    def send_text_argv(self, ws: str, surface: str, text: str) -> list[str]:
        self._off("type into a session")

    def send_key_argv(self, ws: str, surface: str, key: str) -> list[str]:
        self._off("type into a session")

    def read_screen_argv(self, ws: str, surface: str, lines: int) -> list[str]:
        self._off("read a session's screen")

    def open_surface_argv(self, ws: str) -> list[str]:
        self._off("open a new tab")

    @staticmethod
    def first_terminal_surface(list_output: str) -> str | None:
        return None

    @staticmethod
    def new_surface_ref(open_output: str) -> str | None:
        return None
