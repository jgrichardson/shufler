"""Terminal adapters: the program whose panes host the agent sessions (cmux, iTerm2, tmux, ...).

Everything terminal-specific lives behind `TerminalAdapter`. The core (collectors, snapshot, world, actions)
only sees the workspace and group records below, so a new terminal is one module plus one line in
`REGISTRY` (or a `shufler.terminals` entry point). docs/TERMINALS.md has the full guide.

Workspace record (one per row in the world; `list_workspaces()` returns them in the terminal's own order):

    id                   stable unique id; processes may carry it in their env (see processes.py)
    ref                  the handle actions target (often equal to id)
    index                0-based position top to bottom; rows follow it
    title, custom_title  display title (custom_title wins when set)
    custom_color         hex colour or None
    description          free text the terminal shows under the title, or None (cmux puts session notes here)
    current_directory    cwd, or None
    listening_ports      list of ports, may be empty
    latest_submitted_at  ISO time of the last prompt, or None
    pinned, selected     bools; `selected` is the focused row (drives Follow)
    ttys                 the row's tty names ("ttys003"), used to match running `claude` processes; may be empty

The field names come from cmux, the first adapter; they are the neutral shape now, filled by every adapter.

Group record (`list_groups()`, in display order): name (unique), ref, color, members (workspace refs), pinned,
anchor (a workspace ref drawn as the group header and dropped from rows, or None).
"""

from __future__ import annotations

import importlib.metadata
from typing import Any, Protocol

from .base import ALL_CAPS, CAPABILITY_FLAGS, Detection, short_tty
from .cmux import CmuxAdapter
from .iterm2 import ITerm2Adapter
from .none import NoTerminalAdapter
from .tmux import TmuxAdapter

SURFACE_PLACEHOLDER = "<first-terminal-surface>"
NEW_SURFACE_PLACEHOLDER = "<new-surface>"

class TerminalAdapter(Protocol):
    """A terminal whose panes host agent sessions.

    `name` is reported in snapshot capabilities and is the `[terminal] kind` value. Builders return argv
    lists (shown verbatim in action previews); the `*_argv` surface arguments may be a placeholder that
    actions.execute() resolves from the previous step's output.
    """

    name: str
    label: str
    caps: dict[str, bool]
    poll_interval: float

    def list_workspaces(self) -> list[dict]: ...
    def list_groups(self) -> list[dict]: ...
    def focus_argv(self, ws: str) -> list[str]: ...
    def list_surfaces_argv(self, ws: str) -> list[str]: ...
    def send_text_argv(self, ws: str, surface: str, text: str) -> list[str]: ...
    def send_key_argv(self, ws: str, surface: str, key: str) -> list[str]: ...
    def read_screen_argv(self, ws: str, surface: str, lines: int) -> list[str]: ...
    def open_surface_argv(self, ws: str) -> list[str]: ...
    def first_terminal_surface(self, list_output: str) -> str | None: ...
    def new_surface_ref(self, open_output: str) -> str | None: ...


# ---------------------------------------------------------------- registry

# Auto-detect tries these in order. A third-party adapter can also register through the
# `shufler.terminals` entry point group (name = kind, value = "package.module:Class"). "none" (rows from running
# agent sessions, no terminal levers) stays last: it is the fallback when no terminal is running or installed.
REGISTRY: dict[str, type] = {
    "cmux": CmuxAdapter,
    "iterm2": ITerm2Adapter,
    "tmux": TmuxAdapter,
    "none": NoTerminalAdapter,
}


def registered() -> dict[str, type]:
    out = {k: v for k, v in REGISTRY.items() if k != "none"}
    try:
        for ep in importlib.metadata.entry_points(group="shufler.terminals"):
            if ep.name not in out and ep.name != "none":
                try:
                    out[ep.name] = ep.load()
                except Exception:  # noqa: BLE001 - a broken plugin must not stop the daemon
                    continue
    except Exception:  # noqa: BLE001
        pass
    out["none"] = REGISTRY["none"]  # after plugins, so auto-detect tries every real terminal first
    return out


def caps_of(adapter: Any) -> dict[str, bool]:
    """The adapter's capability flags; a flag it does not declare counts as supported."""
    declared = getattr(adapter, "caps", None) or {}
    return {f: bool(declared.get(f, True)) for f in CAPABILITY_FLAGS}


def detect_all(cfg: dict | None = None) -> dict[str, Detection]:
    """{kind: Detection} for every registered adapter. `cfg` is the whole parsed config (for bin paths)."""
    cfg = cfg or {}
    out = {}
    for kind, cls in registered().items():
        try:
            out[kind] = cls.detect(cfg)
        except Exception as e:  # noqa: BLE001
            out[kind] = Detection(False, False, f"detect failed: {type(e).__name__}: {e}")
    return out


def auto_kind(cfg: dict | None = None) -> str:
    """Running terminal first, then "none" (rows from running agent sessions), then a terminal that is only installed.

    "none" beats an installed-but-not-running terminal, so a quit iTerm2 does not leave Shufler waiting on a window
    that is not there. The price: a daemon that starts at login, before the terminal app, resolves to "none" and
    keeps it until restart (the choice is made once per process) or until `[terminal] kind` is set explicitly."""
    found = detect_all(cfg)
    for kind, d in found.items():
        if kind != "none" and d.running:
            return kind
    return "none"


_resolved: str | None = None


def resolve_kind(kind: str | None = None, cfg: dict | None = None) -> str:
    """`[terminal] kind` with "auto" (or unset) resolved once per process."""
    global _resolved
    from ... import config

    kind = (kind or config.TERMINAL_KIND or "auto").strip().lower()
    if kind != "auto":
        return kind
    if _resolved is None:
        _resolved = auto_kind(config.CFG if cfg is None else cfg)
    return _resolved


def build(kind: str | None = None, cfg: dict | None = None) -> TerminalAdapter:
    from ... import config

    cfg = config.CFG if cfg is None else cfg
    kind = resolve_kind(kind, cfg)
    reg = registered()
    if kind not in reg:
        raise ValueError(f"unknown terminal kind {kind!r}; registered: {', '.join(reg)}")
    return reg[kind].from_config(cfg)


__all__ = [
    "TerminalAdapter", "CmuxAdapter", "ITerm2Adapter", "TmuxAdapter", "NoTerminalAdapter", "Detection", "REGISTRY",
    "CAPABILITY_FLAGS", "ALL_CAPS", "short_tty", "SURFACE_PLACEHOLDER", "NEW_SURFACE_PLACEHOLDER", "registered", "caps_of",
    "detect_all", "auto_kind", "resolve_kind", "build",
]
