import copy

from shufler import collectors
from shufler.collectors import DeployTracker, Source
from shufler.snapshot import build_snapshot
from tests.conftest import NOW

T0 = "2026-10-22T08:00:00Z"


def _merged(n, branch, base, sha):
    return {"number": n, "branch": branch, "base": base, "merge_sha": sha, "merged_at": T0, "title": f"t{n}"}


class StackScm:
    deploy_branch = "develop"

    def __init__(self):
        self.head_calls = []
        self.heads = {
            "dead": [{"number": 90, "state": "closed", "base": "develop", "created_at": "2026-10-01"}],
            "open_par": [{"number": 91, "state": "open", "base": "develop", "created_at": "2026-10-01"}],
            "old": [{"number": 50, "state": "merged", "base": "develop", "merge_sha": "s50", "merged_at": T0,
                     "created_at": "2026-09-01"},
                    {"number": 49, "state": "closed", "base": "develop", "created_at": "2026-09-02"}],
        }

    def deploy_runs(self):
        return [{"databaseId": 1, "status": "completed", "conclusion": "success", "headSha": "D",
                 "createdAt": "2026-10-22T08:26:00Z"}]

    def contains(self, sha, head):
        return sha in ("s100", "s50")

    def prs_for_head(self, branch):
        self.head_calls.append(branch)
        return self.heads.get(branch, [])


def _tracker(monkeypatch, merged):
    monkeypatch.setattr(collectors, "cache_read", lambda name: {})
    monkeypatch.setattr(collectors, "_cache_write", lambda *a: None)
    src = Source("gh_merged", 1, lambda: merged)
    src.data = merged
    scm = StackScm()
    return DeployTracker(scm, src), scm


def test_two_level_stack_inherits_shipped(monkeypatch):
    merged = [_merged(100, "base1", "develop", "s100"),     # squash-merged to develop and deployed
              _merged(101, "child", "base1", "s101"),        # stack layer 1
              _merged(102, "grand", "child", "s102"),        # stack layer 2
              _merged(103, "c3", "dead", "s103"),            # parent closed unmerged
              _merged(104, "c4", "open_par", "s104"),        # parent still open
              _merged(105, "c5", "old", "s105"),             # parent merged before this week
              _merged(106, "c6b", "c7b", "s106"), _merged(107, "c7b", "c6b", "s107")]  # cycle
    dt, scm = _tracker(monkeypatch, merged)
    prs = dt()["prs"]
    assert prs["100"] == {"deployed": True, "deployed_at": "2026-10-22T08:26:00Z"}
    assert prs["101"] == {"deployed": True, "deployed_at": "2026-10-22T08:26:00Z", "shipped_via": 100}
    assert prs["102"]["deployed"] and prs["102"]["shipped_via"] == 101
    assert prs["103"] == {"deployed": False, "dropped": True, "shipped_via": 90}
    assert "104" not in prs and "106" not in prs and "107" not in prs
    assert prs["105"]["deployed"] and prs["105"]["shipped_via"] == 50
    assert scm.head_calls.count("dead") == 1
    scm.head_calls.clear()
    dt()
    assert scm.head_calls == []   # merged/closed/none answers are cached; open parents only after 10 min


def test_snapshot_drops_and_marks_stack_layers(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["deploys"]["prs"]["172"] = {"deployed": False, "dropped": True, "shipped_via": 90}
    raw["deploys"]["prs"]["171"]["shipped_via"] = 100
    snap = build_snapshot(raw, {}, NOW)
    by = {w["pr"]: w for w in snap["workpieces"]}
    assert 172 not in by and all(s["pr"] != 172 for s in snap["shipped"])
    assert by[171]["shipped_via"] == 100 and by[171]["stage"] == "deployed"
    assert all("shipped_via" in w for w in snap["workpieces"])
