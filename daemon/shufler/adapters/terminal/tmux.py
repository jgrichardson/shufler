"""tmux through its CLI.

Mapping:
- groups: one per tmux session (named after it), in `list-panes -a` order;
- rows: one per pane (`rows = "pane"`, default) or one per window (`rows = "window"`, targeting its active pane);
- order: session, then window index, then pane index;
- cwd: `pane_current_path`; ttys: `pane_tty` (processes.py also reads TMUX_PANE from the env).

`socket_name` (tmux -L) or `socket_path` (tmux -S) picks a server other than the default one.
"""

from __future__ import annotations

import re

from ... import runner
from .base import ALL_CAPS, Detection, env, find_bin, section, short_tty

FIELDS = ("session_id", "session_name", "session_attached", "session_last_attached", "window_id", "window_index",
          "window_name", "window_active", "pane_id", "pane_index", "pane_active", "pane_tty", "pane_current_path",
          "pane_pid")
# tmux prints control characters in format output as octal escapes, so \x1f arrives as the text "\037".
SEP_OUT = "\\037"
FORMAT = "\x1f".join("#{" + f + "}" for f in FIELDS)
KEYS = {"Return": "Enter", "Enter": "Enter", "Escape": "Escape", "Tab": "Tab", "BackSpace": "BSpace",
        "C-c": "C-c", "C-u": "C-u"}
PANE_RE = re.compile(r"%\d+")


def _int(x: str) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def parse_panes(text: str) -> list[dict]:
    """`list-panes -a -F FORMAT` → pane dicts in session, window index, pane index order."""
    out, order = [], {}
    for line in text.splitlines():
        f = line.split(SEP_OUT)
        if len(f) < len(FIELDS):
            f = line.split("\x1f")  # a tmux that does not escape
        if len(f) < len(FIELDS):
            continue
        d = dict(zip(FIELDS, f))
        order.setdefault(d["session_id"], len(order))
        for k in ("session_attached", "session_last_attached", "window_index", "window_active", "pane_index",
                  "pane_active", "pane_pid"):
            d[k] = _int(d[k])
        d["session_order"] = order[d["session_id"]]
        out.append(d)
    out.sort(key=lambda d: (d["session_order"], d["window_index"], d["pane_index"]))
    return out


class TmuxAdapter:
    name = "tmux"
    label = "tmux"
    caps = dict(ALL_CAPS)
    poll_interval = 2.0
    CONFIG_DEFAULTS = {"bin": "tmux", "socket_name": "", "socket_path": "", "rows": "pane"}

    def __init__(self, bin_path: str = "tmux", socket_name: str = "", socket_path: str = "", rows: str = "pane"):
        if rows not in ("pane", "window"):
            raise ValueError(f'[tmux] rows must be "pane" or "window", got {rows!r}')
        self.bin, self.rows = bin_path, rows
        self.server = ["-S", socket_path] if socket_path else (["-L", socket_name] if socket_name else [])

    @classmethod
    def from_config(cls, cfg: dict) -> "TmuxAdapter":
        s = section(cfg, "tmux")
        return cls(env("TMUX_BIN") or s.get("bin") or "tmux", s.get("socket_name") or "", s.get("socket_path") or "",
                   s.get("rows") or "pane")

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        a = cls.from_config(cfg or {})
        b = find_bin(a.bin)
        if not b:
            return Detection(False, False, "tmux not found")
        r = runner.run([b, *a.server, "list-sessions", "-F", "#{session_name}"], timeout=5)
        n = len(r.stdout.split()) if r.ok else 0
        return Detection(True, r.ok and n > 0, f"bin {b}, " + (f"{n} sessions" if r.ok else "no server running"))

    def _argv(self, *args: str) -> list[str]:
        return [self.bin, *self.server, *args]

    def check(self) -> tuple[bool, str]:
        r = runner.run(self._argv("list-sessions", "-F", "#{session_name}"), timeout=5)
        if not r.ok:
            return False, (r.stderr.strip() or f"rc={r.rc}")[:200]
        return True, f"{len(r.stdout.split())} sessions"

    # ---------------------------------------------------------------- reading

    def panes(self) -> list[dict]:
        r = runner.run(self._argv("list-panes", "-a", "-F", FORMAT), timeout=10)
        if not r.ok:
            raise RuntimeError(f"tmux rc={r.rc} {r.stderr.strip()[:200]}")
        return parse_panes(r.stdout)

    def list_workspaces(self) -> list[dict]:
        panes = self.panes()
        newest = max((p["session_last_attached"] for p in panes if p["session_attached"]), default=None)
        def selected(p: dict) -> bool:
            return bool(p["session_attached"] and p["session_last_attached"] == newest and p["window_active"]
                        and (p["pane_active"] or self.rows == "window"))
        out: list[dict] = []
        if self.rows == "window":
            windows: dict[str, list[dict]] = {}
            for p in panes:
                windows.setdefault(p["window_id"], []).append(p)
            for i, (wid, ps) in enumerate(windows.items()):
                active = next((p for p in ps if p["pane_active"]), ps[0])
                out.append(self._row(wid, i, active["window_name"], active, selected(active),
                                     [t for t in (short_tty(p["pane_tty"]) for p in ps) if t]))
            return out
        counts: dict[str, int] = {}
        for p in panes:
            counts[p["window_id"]] = counts.get(p["window_id"], 0) + 1
        for i, p in enumerate(panes):
            title = p["window_name"] if counts[p["window_id"]] == 1 else f"{p['window_name']}.{p['pane_index']}"
            tty = short_tty(p["pane_tty"])
            out.append(self._row(p["pane_id"], i, title, p, selected(p), [tty] if tty else []))
        return out

    @staticmethod
    def _row(ref: str, index: int, title: str, p: dict, selected: bool, ttys: list[str]) -> dict:
        return {"id": ref, "ref": ref, "index": index, "title": title or None, "custom_title": None,
                "custom_color": None, "description": None, "current_directory": p["pane_current_path"] or None,
                "listening_ports": [], "latest_submitted_at": None, "pinned": False, "selected": selected,
                "ttys": ttys, "group": p["session_name"]}

    def list_groups(self) -> list[dict]:
        groups: dict[str, dict] = {}
        for w in self.list_workspaces():
            g = groups.setdefault(w["group"], {"name": w["group"], "ref": w["group"], "color": None, "members": [],
                                               "pinned": False, "anchor": None})
            g["members"].append(w["ref"])
        return list(groups.values())

    # ---------------------------------------------------------------- actions (argv builders)

    def focus_argv(self, ws: str) -> list[str]:
        # select-window then select-pane; a client attached to that session shows it. Switching a client to
        # another session needs that client's name, so it is not done here.
        return self._argv("select-window", "-t", ws, ";", "select-pane", "-t", ws)

    def list_surfaces_argv(self, ws: str) -> list[str]:
        return self._argv("display-message", "-p", "-t", ws, "#{pane_id}")

    def send_text_argv(self, ws: str, surface: str, text: str) -> list[str]:
        return self._argv("send-keys", "-t", surface, "-l", "--", text)

    def send_key_argv(self, ws: str, surface: str, key: str) -> list[str]:
        if key not in KEYS:
            raise ValueError(f"tmux adapter has no key {key!r}; known: {', '.join(KEYS)}")
        return self._argv("send-keys", "-t", surface, KEYS[key])

    def read_screen_argv(self, ws: str, surface: str, lines: int) -> list[str]:
        return self._argv("capture-pane", "-p", "-t", surface, "-S", f"-{int(lines)}")

    def open_surface_argv(self, ws: str) -> list[str]:
        return self._argv("split-window", "-t", ws, "-c", "#{pane_current_path}", "-P", "-F", "#{pane_id}")

    @staticmethod
    def first_terminal_surface(list_output: str) -> str | None:
        m = PANE_RE.search(list_output or "")
        return m.group(0) if m else None

    @staticmethod
    def new_surface_ref(open_output: str) -> str | None:
        m = PANE_RE.search(open_output or "")
        return m.group(0) if m else None
