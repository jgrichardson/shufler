from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .._util import json_cmd
from .base import ALL_CAPS, Detection, env, find_bin, is_socket, process_running, section

APP_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux"

# Fields of `cmux workspace list` the snapshot may use. Message text
# (latest_conversation_message, latest_submitted_message) is dropped here.
CMUX_KEEP = (
    "id", "ref", "index", "title", "custom_title", "custom_color", "description",
    "current_directory", "listening_ports", "latest_submitted_at", "pinned", "selected",
)


class CmuxAdapter:
    """cmux: one row per workspace, groups from `workspace-group list` (with anchors), order = sidebar index."""

    name = "cmux"
    label = "cmux"
    caps = dict(ALL_CAPS)
    poll_interval = 2.0
    # config keys this adapter reads, with defaults (shown by `shufler setup` and docs/TERMINALS.md)
    CONFIG_DEFAULTS = {"bin": "cmux"}

    def __init__(self, bin_path: str):
        self.bin = bin_path

    @staticmethod
    def configured_bin(cfg: dict) -> str:
        """$SHUFLER_CMUX, else [cmux] bin, else `cmux`."""
        return env("CMUX") or section(cfg, "cmux").get("bin") or "cmux"

    @classmethod
    def from_config(cls, cfg: dict) -> "CmuxAdapter":
        return cls(cls.configured_bin(cfg))

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        cfg = cfg or {}
        b = find_bin(cls.configured_bin(cfg), "cmux", APP_BIN)
        sock = os.environ.get("CMUX_SOCKET_PATH") or None
        if not sock:
            for f in (Path.home() / "Library/Application Support/cmux/last-socket-path", Path("/tmp/cmux-last-socket-path")):
                try:
                    sock = f.read_text().strip() or None
                except OSError:
                    continue
                if sock:
                    break
        running = bool(b) and (is_socket(sock) or process_running("cmux"))
        detail = f"bin {b}" if b else "cmux not found"
        if b:
            detail += ", app running" if running else ", app not running"
        return Detection(bool(b), running, detail)

    def check(self) -> tuple[bool, str]:
        """Reachable right now? (`shufler status`)"""
        try:
            n = len(self.list_workspaces())
        except Exception as e:  # noqa: BLE001
            return False, f"{type(e).__name__}: {e}"[:200]
        return True, f"{n} workspaces"

    def list_workspaces(self) -> list[dict]:
        d = json_cmd([self.bin, "workspace", "list", "--json"], timeout=10)
        return [{k: w.get(k) for k in CMUX_KEEP} for w in d.get("workspaces", [])]

    def list_groups(self) -> list[dict]:
        d = json_cmd([self.bin, "workspace-group", "list", "--json"], timeout=10)
        return [
            {"name": g.get("name"), "ref": g.get("ref"), "color": g.get("custom_color"),
             "members": list(g.get("member_workspace_refs") or []), "pinned": bool(g.get("is_pinned")),
             "anchor": g.get("anchor_workspace_ref")}
            for g in d.get("groups", [])
        ]

    def focus_argv(self, ws: str) -> list[str]:
        return [self.bin, "select-workspace", "--workspace", ws]

    def list_surfaces_argv(self, ws: str) -> list[str]:
        return [self.bin, "list-pane-surfaces", "--workspace", ws, "--json"]

    def send_text_argv(self, ws: str, surface: str, text: str) -> list[str]:
        return [self.bin, "send", "--workspace", ws, "--surface", surface, text]

    def send_key_argv(self, ws: str, surface: str, key: str) -> list[str]:
        return [self.bin, "send-key", "--workspace", ws, "--surface", surface, key]

    def read_screen_argv(self, ws: str, surface: str, lines: int) -> list[str]:
        return [self.bin, "read-screen", "--workspace", ws, "--surface", surface, "--lines", str(lines)]

    def open_surface_argv(self, ws: str) -> list[str]:
        return [self.bin, "new-surface", "--type", "terminal", "--workspace", ws, "--focus", "true"]

    @staticmethod
    def first_terminal_surface(list_output: str) -> str | None:
        try:
            d = json.loads(list_output)
        except json.JSONDecodeError:
            return None
        for s in d.get("surfaces", []):
            if s.get("type") == "terminal":
                return s.get("ref")
        return None

    @staticmethod
    def new_surface_ref(open_output: str) -> str | None:
        m = re.search(r"surface:\d+", open_output)
        return m.group(0) if m else None
