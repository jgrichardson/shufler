from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .claude_code import ClaudeCodeAdapter


class AgentAdapter(Protocol):
    """A coding agent that leaves per-session transcripts on disk.

    Record parsing (tool calls, pending questions, usage, pr-link records)
    lives with the implementation; today that is shufler.transcripts and
    shufler.conversation, which read Claude Code's JSONL shape.
    """

    name: str
    transcript_roots: dict[str, Path]

    def transcript_index(self): ...
    def skill_index(self): ...
    def input_draft(self, screen: str) -> str | None: ...
    def echo_line(self, screen: str, text: str) -> str | None: ...
    def accounts(self) -> dict[str, dict]: ...


__all__ = ["AgentAdapter", "ClaudeCodeAdapter"]
