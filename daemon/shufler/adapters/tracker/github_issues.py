from __future__ import annotations

import re

from ... import config
from .._util import json_cmd
from .issues import Issue

REPO_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
LIST_FIELDS = "number,title,url,state,assignees,labels,updatedAt"


class GitHubIssues:
    """GitHub Issues through the gh CLI, with your gh login (no token of its own). Entry keys: `repo` (default
    `[scm] repo`), `filter` (GitHub search syntax; default your own open issues), `limit` (default 100)."""

    kind = "github"
    default_name = "gh"

    def __init__(self, name: str, gh: str, repo: str, filter: str = "assignee:@me", limit: int = 100):
        self.name, self.gh, self.repo, self.filter, self.limit = name, gh, repo, filter, limit

    @classmethod
    def from_config(cls, entry: dict, cfg: dict) -> "GitHubIssues":
        scm = cfg.get("scm") or {}
        repo = str(entry.get("repo") or scm.get("repo") or "")
        if not REPO_RE.fullmatch(repo):
            raise ValueError('needs repo = "owner/name" (or [scm] repo)')
        gh = config.env("GH") or scm.get("gh") or "gh"
        return cls(entry["name"], gh, repo, str(entry.get("filter") or "assignee:@me"),
                   max(1, min(int(entry.get("limit") or 100), 500)))

    def collect(self) -> list[Issue]:
        d = json_cmd([self.gh, "issue", "list", "--repo", self.repo, "--search", self.filter,
                      "--limit", str(self.limit), "--json", LIST_FIELDS], timeout=30)
        return [Issue(
            source=self.name, key=str(i["number"]), title=i.get("title") or "", url=i.get("url") or "",
            state=(i.get("state") or "").lower(),
            assignee=next((a.get("login") for a in i.get("assignees") or [] if a.get("login")), None),
            labels=tuple(l.get("name") for l in i.get("labels") or [] if l.get("name")),
            updated_at=i.get("updatedAt"),
        ) for i in d]

    def _key(self, key: str) -> str:
        if not str(key).isdigit():
            raise ValueError(f"not a GitHub issue number: {key!r}")
        return str(key)

    def body(self, key: str) -> str:
        d = json_cmd([self.gh, "issue", "view", self._key(key), "--repo", self.repo, "--json", "body"], timeout=30)
        return d.get("body") or ""

    def comment(self, key: str, text: str) -> list[str]:
        return [self.gh, "issue", "comment", self._key(key), "--repo", self.repo, "--body", text]

    def transition(self, key: str, state: str) -> list[str]:
        verb = {"closed": "close", "open": "reopen"}.get(state)
        if not verb:
            raise ValueError(f"GitHub issues are open or closed, not {state!r}")
        return [self.gh, "issue", verb, self._key(key), "--repo", self.repo]
