"""Issue sources: the `[[issues.sources]]` loader (built-in kinds, the `shufler.issue_sources` entry point group,
unknown kinds, duplicates) and the built-in GitHub Issues source with gh mocked. Nothing here calls a real gh."""

import importlib.metadata
import json
import logging

import pytest

from shufler import runner
from shufler.adapters import Adapters
from shufler.adapters.agent import ClaudeCodeAdapter
from shufler.adapters.terminal import ITerm2Adapter
from shufler.adapters.tracker import GitHubIssues, Issue, issue_sources
from shufler.adapters.tracker.issue_sources import IssueConfigError, collector, load_sources, registered
from shufler.collectors import Collectors, Source
from shufler.runner import RunResult
from tests.conftest import NOW


class FakeTracker:
    """A plugin's IssueSource, as a third-party package would write it."""

    kind = "acme"
    default_name = "acme"

    def __init__(self, name: str, team: str):
        self.name, self.team = name, team

    @classmethod
    def from_config(cls, entry: dict, cfg: dict) -> "FakeTracker":
        if not entry.get("team"):
            raise ValueError("needs team")
        return cls(entry["name"], entry["team"])

    def collect(self) -> list[Issue]:
        return [Issue(self.name, f"{self.team}-1", "Login times out", "https://tracker.example/1", "started",
                      assignee="demo", priority="urgent", labels=("auth",), updated_at="2026-10-21T09:00:00Z")]

    def body(self, key: str) -> str:
        return "steps to reproduce"


class OtherGitHub(FakeTracker):
    kind = "github"


class FakeEntryPoint:
    def __init__(self, name: str, target=None, error: Exception | None = None):
        self.name, self.value, self.group = name, f"acme_plugin:{name}", issue_sources.GROUP
        self._target, self._error = target, error

    def load(self):
        if self._error:
            raise self._error
        return self._target


@pytest.fixture
def plugins(monkeypatch):
    """Install fake entry points: plugins([FakeEntryPoint(...), ...])."""
    def install(eps):
        def entry_points(**kw):
            return eps if kw.get("group") == issue_sources.GROUP else []
        monkeypatch.setattr(importlib.metadata, "entry_points", entry_points)
    install([])
    return install


def cfg(*entries, **issues):
    return {"scm": {"repo": "acme/widgets"}, "issues": {**issues, "sources": list(entries)}}


# ---------------------------------------------------------------- loader

def test_no_issues_section_loads_nothing(plugins):
    assert load_sources({}) == []
    assert load_sources({"issues": {"interval": 90}}) == []


def test_builtin_github_kind_loads_with_defaults(plugins):
    [e] = load_sources(cfg({"kind": "github"}))
    assert (e.name, e.kind, e.interval, e.error) == ("gh", "github", 60.0, None)
    assert isinstance(e.source, GitHubIssues)
    assert (e.source.name, e.source.repo, e.source.filter) == ("gh", "acme/widgets", "assignee:@me")


def test_intervals_have_a_floor_and_entries_override_the_section(plugins):
    a, b = load_sources(cfg({"kind": "github", "name": "a"}, {"kind": "github", "name": "b", "interval": 5},
                            interval=120))
    assert (a.interval, b.interval) == (120.0, 30.0)


def test_entry_point_kind_loads(plugins):
    plugins([FakeEntryPoint("acme", FakeTracker)])
    assert registered()["acme"] is FakeTracker
    [e] = load_sources(cfg({"kind": "acme", "team": "ENG"}))
    assert e.error is None and isinstance(e.source, FakeTracker)
    assert (e.name, e.source.team) == ("acme", "ENG")
    assert collector(e)() == [{"source": "acme", "key": "ENG-1", "title": "Login times out",
                               "url": "https://tracker.example/1", "state": "started", "assignee": "demo",
                               "priority": "urgent", "labels": ["auth"], "updated_at": "2026-10-21T09:00:00Z"}]


def test_unknown_kind_is_a_config_error_in_source_health(plugins):
    [e] = load_sources(cfg({"kind": "linaer"}))
    assert e.source is None and e.name == "linaer"
    assert "unknown issue source kind 'linaer'" in e.error and "registered kinds: github" in e.error
    s = Source(f"issues.{e.name}", e.interval, collector(e))
    s.collect()
    h = s.health(NOW)
    assert h["ok"] is False and h["error"].startswith("IssueConfigError: unknown issue source kind 'linaer'")
    with pytest.raises(IssueConfigError):
        collector(e)()


def test_missing_kind_bad_entry_and_from_config_errors_do_not_raise(plugins):
    plugins([FakeEntryPoint("acme", FakeTracker)])
    a, b, c, d = load_sources(cfg({"repo": "acme/widgets"}, "not a table", {"kind": "acme"},
                                  {"kind": "github", "name": "bare", "repo": "no-slash"}))
    assert "has no `kind`" in a.error
    assert b.name == "entry-2" and "not a table" in b.error
    assert c.error == "issue source 'acme' (acme): ValueError: needs team"
    assert "needs repo" in d.error


def test_duplicate_kind_first_wins_with_a_warning(plugins, caplog):
    plugins([FakeEntryPoint("github", OtherGitHub), FakeEntryPoint("acme", FakeTracker),
             FakeEntryPoint("ACME", OtherGitHub)])
    with caplog.at_level(logging.WARNING, logger=issue_sources.__name__):
        reg = registered()
    assert reg["github"] is GitHubIssues and reg["acme"] is FakeTracker
    warned = [r.getMessage() for r in caplog.records]
    assert any("'github'" in m and "acme_plugin:github ignored" in m for m in warned)
    assert any("'acme'" in m and "acme_plugin:ACME ignored" in m for m in warned)


def test_broken_plugin_is_reported_for_its_kind(plugins):
    plugins([FakeEntryPoint("acme", error=ImportError("no module named acme_plugin"))])
    assert "acme" not in registered()
    [e] = load_sources(cfg({"kind": "acme", "team": "ENG"}))
    assert e.error == "the plugin for issue source kind 'acme' failed to load: ImportError: no module named acme_plugin"


def test_duplicate_source_names_are_an_error_on_the_later_entry(plugins):
    a, b, c = load_sources(cfg({"kind": "github"}, {"kind": "github"}, {"kind": "github", "name": "Bad Name"}))
    assert a.error is None and a.name == "gh"
    assert b.source is None and b.name == "entry-2" and "duplicate source name 'gh'" in b.error
    assert c.name == "entry-3" and "bad source name 'bad name'" in c.error


def test_unreadable_entry_point_metadata_keeps_the_builtins(monkeypatch):
    def boom(**kw):
        raise RuntimeError("metadata")
    monkeypatch.setattr(importlib.metadata, "entry_points", boom)
    assert registered() == {"github": GitHubIssues}


def test_collectors_register_one_source_per_entry(plugins):
    entries = load_sources(cfg({"kind": "github"}, {"kind": "nope"}))
    c = Collectors(Adapters(terminal=ITerm2Adapter(), agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None,
                            issues=entries))
    assert c.sources["issues.gh"].interval == 60.0
    c.sources["issues.nope"].collect()
    h = c.health(NOW)
    assert h["issues.nope"]["ok"] is False and "unknown issue source kind 'nope'" in h["issues.nope"]["error"]


# ---------------------------------------------------------------- GitHub Issues (gh mocked)

GH_LIST = [
    {"number": 42, "title": "Login times out", "url": "https://github.com/acme/widgets/issues/42", "state": "OPEN",
     "assignees": [{"login": "demo"}], "labels": [{"name": "bug"}, {"name": "auth"}],
     "updatedAt": "2026-10-21T09:00:00Z"},
    {"number": 7, "title": "Docs typo", "url": "https://github.com/acme/widgets/issues/7", "state": "OPEN",
     "assignees": [], "labels": [], "updatedAt": "2026-10-20T09:00:00Z"},
]


def test_github_collect_runs_gh_with_argv_and_a_timeout(monkeypatch):
    calls = []

    def fake_run(argv, timeout=30, env=None):
        calls.append((argv, timeout))
        return RunResult(0, json.dumps(GH_LIST), "")
    monkeypatch.setattr(runner, "run", fake_run)
    src = GitHubIssues("gh", "/bin/gh", "acme/widgets")
    issues = src.collect()
    assert calls == [(["/bin/gh", "issue", "list", "--repo", "acme/widgets", "--search", "assignee:@me",
                       "--limit", "100", "--json", "number,title,url,state,assignees,labels,updatedAt"], 30)]
    assert issues[0] == Issue("gh", "42", "Login times out", "https://github.com/acme/widgets/issues/42", "open",
                              assignee="demo", labels=("bug", "auth"), updated_at="2026-10-21T09:00:00Z")
    assert issues[1].assignee is None and issues[1].labels == () and issues[1].priority is None


def test_github_collect_failure_marks_the_source_failing(monkeypatch):
    monkeypatch.setattr(runner, "run", lambda argv, timeout=30, env=None: RunResult(1, "", "HTTP 404"))
    s = Source("issues.gh", 60, collector(load_sources(cfg({"kind": "github"}))[0]))
    s.collect()
    assert s.ok is False and "rc=1 HTTP 404" in s.error


def test_github_body_and_planners(monkeypatch):
    calls = []

    def fake_run(argv, timeout=30, env=None):
        calls.append(argv)
        return RunResult(0, json.dumps({"body": "steps"}), "")
    monkeypatch.setattr(runner, "run", fake_run)
    src = GitHubIssues("gh", "gh", "acme/widgets")
    assert src.body("42") == "steps"
    assert calls == [["gh", "issue", "view", "42", "--repo", "acme/widgets", "--json", "body"]]
    assert src.comment("42", "Fixed in #9") == ["gh", "issue", "comment", "42", "--repo", "acme/widgets",
                                                "--body", "Fixed in #9"]
    assert src.transition("42", "closed") == ["gh", "issue", "close", "42", "--repo", "acme/widgets"]
    assert src.transition("42", "open") == ["gh", "issue", "reopen", "42", "--repo", "acme/widgets"]
    with pytest.raises(ValueError):
        src.body("--web")
    with pytest.raises(ValueError):
        src.transition("42", "started")
    assert len(calls) == 1  # planners never run anything
