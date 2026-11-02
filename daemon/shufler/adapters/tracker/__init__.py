from __future__ import annotations

from typing import Protocol

from .board import BoardAdapter
from .github_issues import GitHubIssues
from .intake import IntakeAdapter
from .issue_sources import SourceEntry, load_sources
from .issues import Issue, IssueSource
from .ledgers import LedgerAdapter


class WorkItemSource(Protocol):
    """Somewhere work items live outside the code host: intake records, area ledgers, a board. Each one is
    optional and off by default. Issue trackers (`[[issues.sources]]`) have their own protocol, `IssueSource`."""

    name: str

    def collect(self, *args) -> dict: ...


__all__ = ["WorkItemSource", "IntakeAdapter", "LedgerAdapter", "BoardAdapter", "Issue", "IssueSource", "GitHubIssues",
           "SourceEntry", "load_sources"]
