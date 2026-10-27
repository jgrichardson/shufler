import copy
import json

import pytest

from shufler import collectors, runner
from shufler.adapters.scm import GitHubAdapter
from shufler.collectors import LedgerBranches, Source
from shufler.runner import RunResult
from tests.conftest import NOW
from tests.test_world import build, by


def _res(pr=None, remote=False, worktree=False):
    return {"pr": pr, "remote": remote, "worktree": worktree, "checked_at": NOW}


def _with(raw, res):
    raw = copy.deepcopy(raw)
    raw["ledger_branches"] = {"ft_y": res}
    return build(raw)


def test_row_with_open_pr_becomes_that_pr(raw_data):
    snap = _with(raw_data, _res({"number": 260, "state": "open", "title": "t"}, remote=True))
    ids = {w["id"] for w in snap["workpieces"]}
    assert "branch:ft_y" not in ids
    w = by(snap["workpieces"], "id", "pr:260")
    assert w["ledger"]["area"] == "auth" and w["kind"] == "pr"
    assert snap["stale_ledger_rows"] == []


@pytest.mark.parametrize("state", ["merged", "closed"])
def test_row_with_old_merged_or_closed_pr_is_dropped(raw_data, state):
    snap = _with(raw_data, _res({"number": 20061, "state": state, "title": "t"}))
    assert "branch:ft_y" not in {w["id"] for w in snap["workpieces"]}
    assert snap["stale_ledger_rows"] == []


def test_row_merged_this_week_joins_the_shipped_pr(raw_data):
    merged = raw_data["gh_merged"][0]["number"]
    snap = _with(raw_data, _res({"number": merged, "state": "merged", "title": "t"}))
    assert "branch:ft_y" not in {w["id"] for w in snap["workpieces"]}
    assert by(snap["workpieces"], "id", f"pr:{merged}")["ledger"]["area"] == "auth"


def test_stale_row_is_listed_not_shown(raw_data):
    snap = _with(raw_data, _res())
    assert "branch:ft_y" not in {w["id"] for w in snap["workpieces"]}
    (row,) = snap["stale_ledger_rows"]
    assert row["branch"] == "ft_y" and row["title"] == "idea" and row["area"] == "auth"
    assert row["ledger_path"].endswith("ledgers/auth/ledger.md")


@pytest.mark.parametrize("res", [_res(remote=True), _res(worktree=True)])
def test_live_branch_without_pr_stays(raw_data, res):
    w = by(_with(raw_data, res)["workpieces"], "id", "branch:ft_y")
    assert w["label"] == "idea" and w["branch"] == "ft_y"


def test_unresolved_rows_stay_and_labels_never_show_a_branch(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["ledgers"]["auth"][1]["topic"] = ""
    snap = build(raw)
    w = by(snap["workpieces"], "id", "branch:ft_y")
    assert w["title"] is None and w["label"] == "Untitled work"
    assert by(snap["workpieces"], "id", "pr:253")["label"] == "feat: support handoff"
    assert snap["stale_ledger_rows"] == []


class FakeScm:
    def __init__(self):
        self.calls = []

    def branch_status(self, b):
        self.calls.append(b)
        if b == "ft_boom":
            raise RuntimeError("gh down")
        return {"pr": None, "remote": False}


def _src(name, data):
    s = Source(name, 1, lambda: data)
    s.data = data
    return s


def test_ledger_branches_collector(tmp_path, monkeypatch):
    monkeypatch.setattr(collectors, "cache_read", lambda name: {"ft_boom": {"pr": None, "remote": True,
                                                                             "checked_at": 0}})
    monkeypatch.setattr(collectors, "_cache_write", lambda *a: None)
    monkeypatch.setattr(collectors.config, "WORKTREE_ROOTS", [str(tmp_path)])
    (tmp_path / "proj" / "ft_wt").mkdir(parents=True)
    rows = [{"branch": b, "pr_numbers": [], "worktree": ""} for b in ("ft_open", "ft_gone", "ft_boom", "ft_wt")]
    rows += [{"branch": "has pr", "pr_numbers": [1], "worktree": ""}, {"branch": "bad branch name", "pr_numbers": []}]
    scm = FakeScm()
    lb = LedgerBranches(scm, _src("ledgers", {"a": rows}),
                        _src("gh", [{"number": 5, "branch": "ft_open", "title": "o"}]), _src("gh_merged", []))
    out = lb()
    assert out["ft_open"]["pr"]["number"] == 5 and out["ft_open"]["pr"]["state"] == "open"
    assert out["ft_gone"] == {**out["ft_gone"], "pr": None, "remote": False, "worktree": False}
    assert out["ft_boom"]["remote"] is True                  # gh failed: the last answer is kept
    assert out["ft_wt"]["worktree"] is True
    assert set(scm.calls) == {"ft_gone", "ft_boom", "ft_wt"} and "bad branch name" not in out
    scm.calls.clear()
    lb()
    assert scm.calls == ["ft_boom"]                          # fresh answers are cached for 30 min


def test_github_branch_status(monkeypatch):
    def fake(argv, timeout=30, env=None):
        if argv[1:3] == ["pr", "list"]:
            return RunResult(0, json.dumps([{"number": 1, "state": "CLOSED", "createdAt": "2026-01-01"},
                                            {"number": 2, "state": "MERGED", "createdAt": "2026-02-01",
                                             "title": "t", "url": "u", "mergedAt": "2026-02-02"}]), "")
        return RunResult(1, "", "gh: Not Found (HTTP 404)")
    monkeypatch.setattr(runner, "run", fake)
    st = GitHubAdapter("gh", "acme/widgets").branch_status("ft_x")
    assert st == {"pr": {"number": 2, "state": "merged", "title": "t", "url": "u", "merged_at": "2026-02-02"},
                  "remote": False}
    monkeypatch.setattr(runner, "run", lambda *a, **k: RunResult(1, "", "boom") if a[0][1] == "api"
                        else RunResult(0, "[]", ""))
    with pytest.raises(RuntimeError):
        GitHubAdapter("gh", "acme/widgets").branch_status("ft_x")


def test_ledger_branches_waits_for_sources(monkeypatch):
    monkeypatch.setattr(collectors, "cache_read", lambda name: {"ft_a": {"pr": None, "remote": True}})
    scm = FakeScm()
    lb = LedgerBranches(scm, Source("ledgers", 1, lambda: None), _src("gh", []), _src("gh_merged", []))
    assert lb() == {"ft_a": {"pr": None, "remote": True}} and scm.calls == []


def _branch_is_open_pr_head(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["ledgers"]["auth"][1]["branch"] = raw["gh"][1]["branch"]   # ft_y row now names #260's head
    return raw


def test_ledger_row_on_open_pr_head_is_that_pr_with_cold_resolver(raw_data):
    raw = _branch_is_open_pr_head(raw_data)
    assert "ledger_branches" not in raw                                  # resolver has not answered yet
    snap = build(raw)
    ids = [w["id"] for w in snap["workpieces"]]
    assert len(ids) == len(set(ids))
    assert ids.count("pr:260") == 1 and not any(i.startswith(("branch:", "fix:", "plan:")) and "billing" in i
                                                 for i in ids)
    assert by(snap["workpieces"], "id", "pr:260")["ledger"]["area"] == "auth"


def test_cold_pr_cache_then_warm_never_duplicates(raw_data):
    raw = _branch_is_open_pr_head(raw_data)
    cold = copy.deepcopy(raw)
    cold["gh"], cold["gh_merged"] = [], []                              # first pass: PR sources still empty
    for snap in (build(cold), build(raw)):
        ids = [w["id"] for w in snap["workpieces"]]
        assert len(ids) == len(set(ids))
    assert sum(1 for w in build(raw)["workpieces"] if w.get("branch") == raw["gh"][1]["branch"]) == 1


def test_pr_in_open_and_merged_lists_is_one_merged_entry(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["gh_merged"].append({"number": 253, "title": "feat: support handoff", "branch": "ft_x", "base": "develop",
                             "merged_at": "2026-10-21T12:00:00Z", "merge_sha": "abc", "url": "u", "labels": []})
    snap = build(raw)
    hits = [w for w in snap["workpieces"] if w["id"] == "pr:253"]
    assert len(hits) == 1 and hits[0]["stage"] in ("merged", "deployed")


def test_unique_workpieces_prefers_pr_then_merged(caplog):
    from shufler.world import unique_workpieces
    a = {"id": "pr:1", "pr": 1, "stage": "ready"}
    b = {"id": "pr:1", "pr": 1, "stage": "merged"}
    c = {"id": "pr:1", "pr": None, "stage": "intake"}
    with caplog.at_level("WARNING"):
        out = unique_workpieces([c, a, b, {"id": "x", "pr": None}])
        unique_workpieces([a, b])
    assert [w["id"] for w in out] == ["pr:1", "x"] and out[0] is b
    assert sum("duplicate workpiece id pr:1" in r.message for r in caplog.records) <= 1
