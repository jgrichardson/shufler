import copy

from shufler.events import EventLog, diff
from tests.conftest import NOW


def _wp(snap, pr):
    return next(w for w in snap["workpieces"] if w["pr"] == pr)


def test_diff_two_fixture_snapshots(snapshot):
    before = copy.deepcopy(snapshot)
    after = copy.deepcopy(snapshot)
    w = _wp(after, 253)
    w["phase"], w["ball"], w["stage"] = "deploy", {"who": "ci", "name": None}, "merged"
    st = next(s for s in after["stations"] if s["id"] == "WS-B")
    st["note"] = {"state": "waiting", "text": "CI running on #253", "ts": NOW}
    evs = diff(before, after, NOW + 5)
    kinds = {e["kind"]: e for e in evs}
    assert set(kinds) == {"phase", "ball", "merge", "note"}
    assert kinds["phase"]["from"] == _wp(before, 253)["phase"] and kinds["phase"]["to"] == "deploy"
    assert kinds["phase"]["pr"] == 253 and kinds["phase"]["station_id"] == _wp(before, 253)["station_id"]
    assert kinds["ball"]["to"] == "ci" and kinds["merge"]["to"] == "merged"
    assert kinds["note"]["station_id"] == "WS-B" and kinds["note"]["from"] == "me" and kinds["note"]["to"] == "waiting"
    assert all(e["ts"] == NOW + 5 for e in evs)
    assert diff(before, copy.deepcopy(before), NOW) == []


def test_deploy_and_log_bounds(snapshot):
    log = EventLog(maxlen=3)
    first = copy.deepcopy(snapshot)
    assert log.observe(first, NOW) == []  # baseline
    nxt = copy.deepcopy(snapshot)
    w = _wp(nxt, 253)
    w["stage"] = "deployed"
    evs = log.observe(nxt, NOW + 1)
    assert [e["kind"] for e in evs] == ["merge", "deploy"] and nxt["events"] == evs
    for i in range(3):
        s = copy.deepcopy(nxt)
        _wp(s, 253)["phase"] = f"p{i}"
        log.observe(s, NOW + 2 + i)
    assert len(log.events) == 3 and [e["to"] for e in log.events] == ["p0", "p1", "p2"]


def test_baseline_suppresses_warmup_transitions(snapshot):
    log = EventLog()
    log.observe(copy.deepcopy(snapshot), NOW)
    warming = copy.deepcopy(snapshot)
    _wp(warming, 253)["stage"] = "deployed"
    assert log.observe(warming, NOW + 1, baseline=True) == [] and log.last_new == []
    assert log.observe(copy.deepcopy(warming), NOW + 2) == []
