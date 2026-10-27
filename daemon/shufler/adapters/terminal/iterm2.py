"""iTerm2 through AppleScript (`osascript`), no extra dependency.

Mapping:
- a row per iTerm2 session (a pane); id and ref are the session's unique id (the UUID iTerm2 also exports to
  the shell as ITERM_SESSION_ID=w0t1p0:<UUID>, which processes.py reads);
- title: the session name, else the tab title;
- groups: one per window, named from the window title (`group_by = "window"`), or by a tab-title prefix such as
  "AUTH · login" → AUTH (`group_by = "tab_prefix"`; a tab with no prefix stays ungrouped);
- order: window creation order (iTerm2's window id; z-order would reshuffle the rows every time a window is
  clicked), then tab order, then pane order;
- cwd: the session's `path` variable, else the cwd of the foreground process on its tty (`lsof`).

Every command goes through iterm2.applescript so action previews stay one readable line.
"""

from __future__ import annotations

import re
from pathlib import Path

from ... import runner
from .base import ALL_CAPS, Detection, process_running, section, short_tty

SCRIPT = Path(__file__).with_name("iterm2.applescript")
US = "\x1f"
UUID_RE = re.compile(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}")
KEYS = {"Return": 13, "Enter": 13, "Escape": 27, "Tab": 9, "BackSpace": 127, "C-c": 3, "C-u": 21}
NOT_AUTHORIZED = "-1743"  # errAEEventNotPermitted: the Automation permission was denied
APP = "/Applications/iTerm.app"


def parse_list(text: str) -> list[dict]:
    """The `list` command's output → session dicts in window id, tab, pane order."""
    out = []
    for line in text.splitlines():
        f = line.split(US)
        if len(f) < 10 or not f[0].strip().lstrip("-").isdigit():
            continue
        out.append({"window_id": int(f[0]), "window_name": f[1], "tab": int(f[2] or 0), "tab_title": f[3],
                    "pane": int(f[4] or 0), "id": f[5], "name": f[6], "tty": f[7], "path": f[8] or None,
                    "selected": f[9].strip() == "true"})
    out.sort(key=lambda s: (s["window_id"], s["tab"], s["pane"]))
    return out


def tab_prefix(title: str, separator: str) -> str | None:
    """'AUTH · login' → 'AUTH' (None when the title has no prefix)."""
    if separator and separator in (title or ""):
        head = title.split(separator, 1)[0].strip()
        return head or None
    return None


def parse_ps_tty(text: str) -> dict[str, int]:
    """`ps -axo pid=,tty=,stat=` → {tty: pid of its foreground process}, preferring the newest '+' process."""
    best: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit():
            continue
        tty = short_tty(parts[1])
        if tty and "+" in parts[2]:
            best[tty] = max(best.get(tty, 0), int(parts[0]))
    return best


class ITerm2Adapter:
    name = "iterm2"
    label = "iTerm2"
    caps = dict(ALL_CAPS)
    poll_interval = 3.0  # one osascript round trip lists every session
    CONFIG_DEFAULTS = {"osascript": "osascript", "group_by": "window", "prefix_separator": " · "}

    def __init__(self, osascript: str = "osascript", group_by: str = "window", prefix_separator: str = " · ",
                 script: Path | str = SCRIPT):
        if group_by not in ("window", "tab_prefix"):
            raise ValueError(f'[iterm2] group_by must be "window" or "tab_prefix", got {group_by!r}')
        self.osascript, self.group_by, self.sep, self.script = osascript, group_by, prefix_separator, str(script)
        self._cwd_cache: dict[tuple[str, int], str | None] = {}

    @classmethod
    def from_config(cls, cfg: dict) -> "ITerm2Adapter":
        s = section(cfg, "iterm2")
        return cls(s.get("osascript") or "osascript", s.get("group_by") or "window",
                   s.get("prefix_separator") if s.get("prefix_separator") is not None else " · ")

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        installed = Path(APP).is_dir() or Path.home().joinpath("Applications/iTerm.app").is_dir()
        running = process_running("iTerm2")
        return Detection(installed or running, running,
                         ("running" if running else "installed, not running") if installed or running else "not found")

    def _argv(self, *args: str) -> list[str]:
        return [self.osascript, self.script, *args]

    def check(self) -> tuple[bool, str]:
        """Reachable right now, and is the Automation permission granted? (`shufler status`)"""
        r = runner.run(self._argv("ping"), timeout=10)
        if r.ok:
            return True, f"{r.stdout.strip()} windows, Automation permission granted"
        if NOT_AUTHORIZED in r.stderr:
            return False, ("Automation permission denied: System Settings > Privacy & Security > Automation, "
                           "allow the app running Shufler to control iTerm2")
        return False, (r.stderr.strip() or f"rc={r.rc}")[:200]

    # ---------------------------------------------------------------- reading

    def sessions(self) -> list[dict]:
        r = runner.run(self._argv("list"), timeout=10)
        if not r.ok:
            if NOT_AUTHORIZED in r.stderr:
                raise RuntimeError("iTerm2 Automation permission denied (System Settings > Privacy & Security > "
                                   "Automation)")
            raise RuntimeError(f"osascript rc={r.rc} {r.stderr.strip()[:200]}")
        return parse_list(r.stdout)

    def _fill_cwds(self, sessions: list[dict]) -> None:
        """Sessions without a `path` variable: the cwd of the foreground process on their tty."""
        missing = [s for s in sessions if not s["path"] and short_tty(s["tty"])]
        if not missing:
            return
        r = runner.run(["ps", "-axo", "pid=,tty=,stat="], timeout=10)
        fg = parse_ps_tty(r.stdout) if r.ok else {}
        want = {short_tty(s["tty"]): fg.get(short_tty(s["tty"])) for s in missing}
        new = sorted({pid for tty, pid in want.items() if pid and (tty, pid) not in self._cwd_cache})
        if new:
            from ...processes import parse_lsof_cwd
            lr = runner.run(["lsof", "-a", "-d", "cwd", "-Fn", "-p", ",".join(map(str, new))], timeout=10)
            cwds = parse_lsof_cwd(lr.stdout) if lr.stdout else {}
            for tty, pid in want.items():
                if pid in new:
                    self._cwd_cache[(tty, pid)] = cwds.get(pid)
        live = {(t, p) for t, p in want.items() if p}
        self._cwd_cache = {k: v for k, v in self._cwd_cache.items() if k in live}
        for s in missing:
            tty = short_tty(s["tty"])
            s["path"] = self._cwd_cache.get((tty, want.get(tty)))

    def _group_name(self, s: dict) -> str | None:
        if self.group_by == "tab_prefix":
            return tab_prefix(s["tab_title"] or s["name"], self.sep)
        return None  # by window: list_groups names the windows

    def list_workspaces(self) -> list[dict]:
        sessions = self.sessions()
        self._fill_cwds(sessions)
        out = []
        for i, s in enumerate(sessions):
            title = (s["name"] or s["tab_title"] or "").strip() or None
            tty = short_tty(s["tty"])
            out.append({
                "id": s["id"], "ref": s["id"], "index": i, "title": title, "custom_title": None,
                "custom_color": None, "description": None, "current_directory": s["path"],
                "listening_ports": [], "latest_submitted_at": None, "pinned": False, "selected": s["selected"],
                "ttys": [tty] if tty else [],
            })
        return out

    def list_groups(self) -> list[dict]:
        sessions = self.sessions()
        groups: dict[str, dict] = {}
        if self.group_by == "tab_prefix":
            for s in sessions:
                name = self._group_name(s)
                if name:
                    groups.setdefault(name, {"name": name, "ref": name, "color": None, "members": [],
                                             "pinned": False, "anchor": None})["members"].append(s["id"])
            return list(groups.values())
        by_window: dict[int, list[dict]] = {}
        for s in sessions:
            by_window.setdefault(s["window_id"], []).append(s)
        used: set[str] = set()
        for wid, members in by_window.items():
            base = (members[0]["window_name"] or "").strip() or f"Window {wid}"
            name, n = base, 2
            while name in used:
                name, n = f"{base} ({n})", n + 1
            used.add(name)
            groups[name] = {"name": name, "ref": f"window:{wid}", "color": None,
                            "members": [s["id"] for s in members], "pinned": False, "anchor": None}
        return list(groups.values())

    # ---------------------------------------------------------------- actions (argv builders)

    def focus_argv(self, ws: str) -> list[str]:
        return self._argv("focus", ws)

    def list_surfaces_argv(self, ws: str) -> list[str]:
        return self._argv("surface", ws)

    def send_text_argv(self, ws: str, surface: str, text: str) -> list[str]:
        return self._argv("write", surface, text)

    def send_key_argv(self, ws: str, surface: str, key: str) -> list[str]:
        if key not in KEYS:
            raise ValueError(f"iTerm2 adapter has no key {key!r}; known: {', '.join(KEYS)}")
        return self._argv("key", surface, str(KEYS[key]))

    def read_screen_argv(self, ws: str, surface: str, lines: int) -> list[str]:
        return self._argv("read", surface, str(lines))

    def open_surface_argv(self, ws: str) -> list[str]:
        return self._argv("open", ws)

    @staticmethod
    def first_terminal_surface(list_output: str) -> str | None:
        m = UUID_RE.search(list_output or "")
        return m.group(0) if m else None

    @staticmethod
    def new_surface_ref(open_output: str) -> str | None:
        m = UUID_RE.search(open_output or "")
        return m.group(0) if m else None
