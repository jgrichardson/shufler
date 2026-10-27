"""Seams for everything machine- or vendor-specific.

One small Protocol per kind (terminal, agent, scm, review, tracker). Terminals
have a registry (cmux, iTerm2, tmux; adapters/terminal); the others have one
implementation each today. Command builders are pure and return argv lists,
so action previews show exactly what will run. `from_config()` picks the
implementations named in config.toml; an optional adapter that is off is None.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import config
from .agent import AgentAdapter, ClaudeCodeAdapter
from .review import ExternalReviewer, ReviewerAdapter
from .scm import GitHubAdapter, ScmAdapter
from .terminal import TerminalAdapter
from .terminal import build as build_terminal
from .tracker import BoardAdapter, IntakeAdapter, LedgerAdapter, WorkItemSource


@dataclass
class Adapters:
    terminal: TerminalAdapter
    agent: AgentAdapter
    scm: ScmAdapter | None
    reviewer: ExternalReviewer | None
    trackers: dict[str, WorkItemSource] = field(default_factory=dict)


def from_config() -> Adapters:
    if config.AGENT_ADAPTER != "claude-code":
        raise ValueError(f"unknown agent adapter {config.AGENT_ADAPTER!r}; only claude-code exists today")
    trackers: dict[str, WorkItemSource] = {}
    if config.ISSUES_DIR:
        trackers["intake"] = IntakeAdapter(config.ISSUES_DIR, config.ISSUE_CMD, config.BOARD_RECORD_KEY)
    if config.LEDGERS_DIR:
        trackers["ledgers"] = LedgerAdapter(config.LEDGERS_DIR)
    if config.BOARD_CMD:
        trackers["board"] = BoardAdapter(config.BOARD_CMD, config.BOARD_STAGES, config.BOARD_GET_ARGS,
                                         config.BOARD_STAGE_ARGS, config.BOARD_NOTE_ARGS, config.BOARD_STAGE_RE)
    scm = GitHubAdapter(config.GH, config.REPO, config.DEPLOY_WORKFLOW, config.DEPLOY_BRANCH) if config.REPO else None
    reviewer = (ReviewerAdapter(config.REVIEWER_LOGIN_RE, config.REVIEWER_STATUS_ARGV, config.REVIEWER_RETRIGGER_ARGV,
                                config.REVIEWER_RETRIGGER_COMMENT, scm) if config.REVIEW_ENABLED else None)
    return Adapters(
        terminal=build_terminal(config.TERMINAL_KIND, config.CFG),
        agent=ClaudeCodeAdapter(config.TRANSCRIPT_ROOTS, config.ACCOUNTS, config.USAGE_CACHE),
        scm=scm,
        reviewer=reviewer,
        trackers=trackers,
    )


_current: Adapters | None = None


def current() -> Adapters:
    global _current
    if _current is None:
        _current = from_config()
    return _current


def set_current(a: Adapters | None) -> None:
    """Tests swap in adapters built from fixture config."""
    global _current
    _current = a
