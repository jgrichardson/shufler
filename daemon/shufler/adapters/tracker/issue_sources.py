"""Issue source registry and the `[[issues.sources]]` loader.

Each entry names a `kind`. The kind resolves against `REGISTRY` and then the `shufler.issue_sources` entry point
group (name = kind, value = "package.module:Class"), so a tracker can ship as a separate package with no change to
Shufler. docs/EXTENDING.md has the guide.

Loading never stops the daemon. An entry that cannot be built (unknown kind, a plugin that fails to import, a bad
key) still gets a source, under `issues.<name>`, whose health reports the reason like any failing source.
Issues are collected and their health reported; the snapshot does not carry them yet.
"""

from __future__ import annotations

import importlib.metadata
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

from .github_issues import GitHubIssues
from .issues import Issue

log = logging.getLogger(__name__)

GROUP = "shufler.issue_sources"
NAME_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,30}")
DEFAULT_INTERVAL = 60.0
MIN_INTERVAL = 30.0

# Built-in kinds. A plugin adds more through the `shufler.issue_sources` entry point group. A kind that is already
# registered (built in, or by an earlier plugin) keeps its first class; the later one is skipped with a warning.
REGISTRY: dict[str, type] = {
    "github": GitHubIssues,
}


def _scan() -> tuple[dict[str, type], dict[str, str]]:
    """({kind: class}, {kind: why its plugin failed to load}) over the built-ins and every installed plugin."""
    out = dict(REGISTRY)
    broken: dict[str, str] = {}
    try:
        eps = list(importlib.metadata.entry_points(group=GROUP))
    except Exception:  # noqa: BLE001 - unreadable package metadata must not stop the daemon
        return out, broken
    for ep in eps:
        kind = ep.name.strip().lower()
        if kind in out:
            first = out[kind]
            log.warning("issue source kind %r from %s ignored: %s.%s registered it first", kind, ep.value,
                        first.__module__, first.__qualname__)
            continue
        try:
            out[kind] = ep.load()
        except Exception as e:  # noqa: BLE001 - a broken plugin must not stop the daemon
            broken[kind] = f"{type(e).__name__}: {e}"
            log.warning("issue source plugin %r (%s) failed to load: %s", kind, ep.value, broken[kind])
    return out, broken


def registered() -> dict[str, type]:
    return _scan()[0]


class IssueConfigError(Exception):
    """A `[[issues.sources]]` entry that cannot be built. Shown in source health, never raised to the daemon."""


@dataclass
class SourceEntry:
    """One `[[issues.sources]]` entry after loading: the built source, or the reason it could not be built."""

    name: str
    kind: str
    interval: float = DEFAULT_INTERVAL
    source: Any = None
    error: str | None = None


def _interval(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        return max(MIN_INTERVAL, float(value))
    except (TypeError, ValueError):
        return default


def load_sources(cfg: dict | None) -> list[SourceEntry]:
    """Every `[[issues.sources]]` entry, in config order. Never raises."""
    sec = (cfg or {}).get("issues") or {}
    raw = sec.get("sources") if isinstance(sec, dict) else None
    if isinstance(raw, dict):  # `[issues.sources]` written for `[[issues.sources]]`: one entry
        raw = [raw]
    if not raw or not isinstance(raw, list):
        return []
    default_interval = _interval(sec.get("interval"), DEFAULT_INTERVAL)
    reg, broken = _scan()
    kinds = ", ".join(reg) or "none"
    out: list[SourceEntry] = []
    seen: set[str] = set()
    for i, entry in enumerate(raw, 1):
        if not isinstance(entry, dict):
            out.append(SourceEntry(f"entry-{i}", "", error=f"[[issues.sources]] entry {i} is not a table"))
            seen.add(f"entry-{i}")
            continue
        kind = str(entry.get("kind") or "").strip().lower()
        cls = reg.get(kind)
        name = str(entry.get("name") or getattr(cls, "default_name", "") or kind or f"entry-{i}").strip().lower()
        e = SourceEntry(name, kind, _interval(entry.get("interval"), default_interval))
        if name in seen or not NAME_RE.fullmatch(name):
            e.name = f"entry-{i}"
            e.error = (f"[[issues.sources]] entry {i}: {'duplicate' if name in seen else 'bad'} source name {name!r}; "
                       "set `name` to a unique id of a-z, 0-9, _ and -")
        elif not kind:
            e.error = f"[[issues.sources]] entry {i} has no `kind`; registered kinds: {kinds}"
        elif kind in broken:
            e.error = f"the plugin for issue source kind {kind!r} failed to load: {broken[kind]}"
        elif cls is None:
            e.error = (f"unknown issue source kind {kind!r}; registered kinds: {kinds}. Install the plugin that "
                       f"provides it ({GROUP} entry point, docs/EXTENDING.md)")
        else:
            try:
                e.source = cls.from_config({**entry, "name": name}, cfg or {})
            except Exception as ex:  # noqa: BLE001 - a bad entry is a config error, not a crash
                e.error = f"issue source {name!r} ({kind}): {type(ex).__name__}: {ex}"
        if e.error:
            e.error = e.error[:300]
            log.warning("%s", e.error)
        seen.add(e.name)
        out.append(e)
    return out


def collector(entry: SourceEntry) -> Callable[[], list[dict]]:
    """The collector function for one entry: the source's issues as dicts, or, for an entry that could not be
    built, its config error raised on every read so source health shows it."""
    if entry.source is None:
        def failing() -> list[dict]:
            raise IssueConfigError(entry.error or "issue source not built")
        return failing

    def collect() -> list[dict]:
        return [i.to_dict() if isinstance(i, Issue) else dict(i) for i in entry.source.collect()]
    return collect


__all__ = ["GROUP", "REGISTRY", "registered", "IssueConfigError", "SourceEntry", "load_sources", "collector"]
