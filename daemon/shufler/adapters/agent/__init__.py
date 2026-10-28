"""Agent harnesses: the coding agents whose sessions run in the terminal's rows (Claude Code, Codex, ...).

Everything harness-specific lives behind `AgentAdapter`: which processes are its sessions, where its transcripts
are and how to read them, what its input box looks like on screen, and how to answer its questions. The core
(processes, collectors, snapshot, actions) asks the registry, so a new harness is one module plus one line in
`REGISTRY` (or a `shufler.agents` entry point). docs/AGENTS.md has the full guide.

Which harnesses run: `[agents] enabled = ["claude", "codex"]`, or "auto" (the default): Claude Code always (as
before), plus every other registered harness whose `detect()` says it is installed.
"""

from __future__ import annotations

import importlib.metadata
from pathlib import Path
from typing import Any, Protocol

from .claude_code import ClaudeCodeAdapter
from .codex import CodexAdapter


class AgentAdapter(Protocol):
    """A coding agent that leaves per-session transcripts on disk.

    `harness` is the short id in the snapshot (`station.harness`) and in `[agents] enabled`. A transcript
    index's `scan()` returns {session_id: summary} with the keys of transcripts.SessionStats.summary plus
    `harness`; `sessions[sid].path` is the transcript file the Conversation panel reads.
    """

    name: str
    harness: str
    label: str
    transcript_roots: dict[str, Path]

    def transcript_index(self): ...
    def skill_index(self): ...
    def input_draft(self, screen: str) -> str | None: ...
    def echo_line(self, screen: str, text: str) -> str | None: ...
    def accounts(self) -> dict[str, dict]: ...
    def match_process(self, tokens: list[str]) -> dict | None: ...


# ---------------------------------------------------------------- registry

# Auto mode enables "claude" always and the others when detected. A third-party harness can also register through
# the `shufler.agents` entry point group (name = harness id, value = "package.module:Class").
REGISTRY: dict[str, type] = {
    "claude": ClaudeCodeAdapter,
    "codex": CodexAdapter,
}
ALWAYS_ON = ("claude",)


def registered() -> dict[str, type]:
    out = dict(REGISTRY)
    try:
        for ep in importlib.metadata.entry_points(group="shufler.agents"):
            if ep.name not in out:
                try:
                    out[ep.name] = ep.load()
                except Exception:  # noqa: BLE001 - a broken plugin must not stop the daemon
                    continue
    except Exception:  # noqa: BLE001
        pass
    return out


def detect_all(cfg: dict | None = None) -> dict[str, Any]:
    """{harness: Detection} for every registered harness."""
    from ..terminal.base import Detection
    out = {}
    for h, cls in registered().items():
        try:
            out[h] = cls.detect(cfg or {})
        except Exception as e:  # noqa: BLE001
            out[h] = Detection(False, False, f"detect failed: {type(e).__name__}: {e}")
    return out


def setting(cfg: dict | None = None) -> list[str] | str:
    """`[agents] enabled` (or $SHUFLER_AGENTS, comma-separated): a list of harness ids, or "auto"."""
    import os
    raw: Any = os.environ.get("SHUFLER_AGENTS") or ((cfg or {}).get("agents") or {}).get("enabled") or "auto"
    if isinstance(raw, str):
        raw = raw.strip().lower()
        if raw in ("", "auto"):
            return "auto"
        raw = [x for x in raw.replace(" ", ",").split(",") if x]
    return [str(x).strip().lower() for x in raw if str(x).strip()]


_resolved: list[str] | None = None


def enabled(cfg: dict | None = None, *, fresh: bool = False) -> list[str]:
    """The harness ids that run, registry order, "auto" resolved once per process. Unknown ids are dropped."""
    global _resolved
    from ... import config
    cfg = config.CFG if cfg is None else cfg
    want = setting(cfg)
    reg = registered()
    if want != "auto":
        return [h for h in reg if h in want]
    if _resolved is None or fresh:
        found = detect_all(cfg)
        _resolved = [h for h in reg if h in ALWAYS_ON or found[h].installed]
    return list(_resolved)


def build(harness: str, cfg: dict | None = None):
    """One harness adapter. Claude Code reads its accounts from config.py ([agent] / [[agent.accounts]])."""
    from ... import config
    cfg = config.CFG if cfg is None else cfg
    if harness == "claude":
        return ClaudeCodeAdapter(config.TRANSCRIPT_ROOTS, config.ACCOUNTS, config.USAGE_CACHE)
    reg = registered()
    if harness not in reg:
        raise ValueError(f"unknown agent harness {harness!r}; registered: {', '.join(reg)}")
    return reg[harness].from_config(cfg)


def build_all(cfg: dict | None = None) -> dict[str, Any]:
    return {h: build(h, cfg) for h in enabled(cfg)}


__all__ = ["AgentAdapter", "ClaudeCodeAdapter", "CodexAdapter", "REGISTRY", "registered", "detect_all", "setting",
           "enabled", "build", "build_all"]
