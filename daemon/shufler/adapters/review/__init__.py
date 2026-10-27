from __future__ import annotations

import re
from typing import Protocol

from .._util import json_cmd


class ExternalReviewer(Protocol):
    """A review bot that posts PR reviews under a known GitHub login, optionally with a status watcher and a
    way to ask for a re-review."""

    name: str
    login_re: re.Pattern

    def is_reviewer(self, login: str | None) -> bool: ...
    def status(self) -> dict[str, dict]: ...
    def retrigger_argv(self, n: int) -> list[str] | None: ...


class ReviewerAdapter:
    """A generic external reviewer bot, configured in [reviewer]:

    - `login_regex` matches the bot's GitHub login; its latest review on a PR is the reviewer verdict.
    - `status_command` (optional) is an argv printing `{"prs": {"<n>": {"status": ..., "cycle": n}}}` as JSON.
    - `retrigger_command` (an argv template with {pr}) or `retrigger_comment` (a PR comment template with {pr},
      posted with `gh pr comment`) asks the bot for a re-review."""

    name = "reviewer"

    def __init__(self, login_regex: str, status_argv: list[str] | None = None,
                 retrigger_argv: list[str] | None = None, retrigger_comment: str = "", scm=None):
        self.login_re = re.compile(login_regex, re.I)
        self.status_argv = status_argv
        self.retrigger_template = retrigger_argv
        self.retrigger_comment = retrigger_comment
        self.scm = scm

    @property
    def command(self) -> list[str] | None:
        """The status watcher, when there is one (the collector polls it)."""
        return self.status_argv

    def is_reviewer(self, login: str | None) -> bool:
        return bool(login and self.login_re.search(login))

    def status(self) -> dict[str, dict]:
        if not self.status_argv:
            return {}
        d = json_cmd(list(self.status_argv), timeout=20)
        return {str(k): v for k, v in (d.get("prs") or {}).items()}

    def retrigger_argv(self, n: int) -> list[str] | None:
        if self.retrigger_template:
            return [a.replace("{pr}", str(n)) for a in self.retrigger_template]
        if self.retrigger_comment and self.scm is not None:
            return self.scm.comment_argv(n, self.retrigger_comment.replace("{pr}", str(n)))
        return None


__all__ = ["ExternalReviewer", "ReviewerAdapter"]
