"""Shared pieces for terminal adapters: detection result, capability flags and small probes."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Capability flags every adapter declares. A lever whose flag is False is refused with a plain message
# instead of running a command that cannot work, and the web greys it out (snapshot `capabilities.terminal_caps`).
# `can_follow`: the adapter marks the focused row (`selected`), which drives Follow in the web.
CAPABILITY_FLAGS = ("can_send", "can_focus", "can_read_screen", "can_open", "has_groups", "can_follow")
ALL_CAPS = {f: True for f in CAPABILITY_FLAGS}


@dataclass
class Detection:
    """What `detect()` found: installed (the app or binary exists), running (reachable right now), detail."""

    installed: bool
    running: bool
    detail: str = ""


def section(cfg: dict, *keys: str) -> dict:
    d = cfg
    for k in keys:
        d = d.get(k) or {} if isinstance(d, dict) else {}
    return d if isinstance(d, dict) else {}


def env(name: str) -> str | None:
    return os.environ.get("SHUFLER_" + name)


def find_bin(*candidates: str | None) -> str | None:
    """The first candidate that is an executable path or a name on PATH."""
    for c in candidates:
        if not c:
            continue
        p = Path(c).expanduser()
        if "/" in c and p.is_file() and os.access(p, os.X_OK):
            return str(p)
        hit = shutil.which(c)
        if hit:
            return hit
    return None


def process_running(name: str) -> bool:
    """True when a process with exactly this name runs (pgrep -x)."""
    try:
        return subprocess.run(["pgrep", "-qx", name], timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def is_socket(path: str | Path | None) -> bool:
    try:
        return bool(path) and stat.S_ISSOCK(Path(path).expanduser().stat().st_mode)
    except OSError:
        return False


def short_tty(tty: str | None) -> str | None:
    """'/dev/ttys003' or 'ttys003' → 'ttys003'; '??' and '' → None."""
    t = (tty or "").strip()
    if not t or t in ("??", "-"):
        return None
    return t[5:] if t.startswith("/dev/") else t
