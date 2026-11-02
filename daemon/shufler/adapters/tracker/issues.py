"""The issue record and the `IssueSource` protocol every issue tracker implements (GitHub Issues built in, others
from plugins). The registry and the `[[issues.sources]]` loader are in issue_sources.py; docs/EXTENDING.md has the
guide for writing one."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol


@dataclass(frozen=True)
class Issue:
    """One issue, the same shape whatever the tracker. `source` is the source's name (`gh`, `linear`, ...) and
    `key` the tracker's own id (`42`, `ENG-123`); the workpiece id will be `issue:<source>-<key>`. The body is not
    here: it can be long and is untrusted, so it is fetched with `IssueSource.body()` only when asked for."""

    source: str
    key: str
    title: str
    url: str
    state: str                      # lower-case tracker state: "open", "closed", "started", ...
    assignee: str | None = None     # login or display name
    priority: str | None = None     # the tracker's own label ("urgent", "P1"); None when it has none
    labels: tuple[str, ...] = ()
    updated_at: str | None = None   # ISO 8601

    def to_dict(self) -> dict:
        d = asdict(self)
        d["labels"] = list(self.labels)
        return d


class IssueSource(Protocol):
    """An issue tracker. Built once per `[[issues.sources]]` entry with the classmethod `from_config(entry, cfg)`,
    where `entry` is that table (its `name` already resolved) and `cfg` the whole parsed config; raise ValueError
    for a missing or bad key and the message shows in source health.

    `collect()` runs on the source's poll interval in a collector thread; raise to mark the source failing (it
    keeps its last good data). Calls go out as argv lists through `shufler.runner` (no shell, a timeout) or as
    HTTPS requests to the one host the entry names.

    Optional, for writing back once an issue's work is merged: `comment(key, text)` and `transition(key, state)`.
    They plan and never run anything: each returns an argv list (or, for an HTTP tracker, a request dict
    `{method, url, body}`) that the action layer shows in the confirm panel and runs only after you confirm. A
    source without them is read-only; the core checks with `getattr` before offering write-back.
    """

    kind: str
    name: str

    def collect(self) -> list[Issue]: ...
    def body(self, key: str) -> str: ...
    def comment(self, key: str, text: str) -> list[str] | dict: ...      # optional
    def transition(self, key: str, state: str) -> list[str] | dict: ...  # optional
