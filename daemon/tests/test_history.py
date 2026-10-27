import copy
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from shufler import backfill
from shufler.adapters.agent import ClaudeCodeAdapter
from shufler.adapters.review import ReviewerAdapter
from shufler.events import EventLog
from shufler.history import HistoryStore, compact, parse_when
from tests.conftest import FIX, NOW
from tests.test_api import hub, transcript_copy  # noqa: F401 - shared fixtures


def _wp(snap, pr):
    return next(w for w in snap["workpieces"] if w["pr"] == pr)


def test_record_range_and_days(snapshot, tmp_path):
    store = HistoryStore(tmp_path / "h.sqlite")
    log = EventLog()
    s1 = copy.deepcopy(snapshot)
    log.observe(s1, NOW)
    store.record(s1, log.last_new, NOW)  # first snapshot is always stored
    s2 = copy.deepcopy(snapshot)
    _wp(s2, 253)["stage"] = "deployed"
    _wp(s2, 253)["phase"] = "docs"
    log.observe(s2, NOW + 60)
    store.record(s2, log.last_new, NOW + 60)  # 3 events: burst, so a snapshot too
    s3 = copy.deepcopy(s2)
    log.observe(s3, NOW + 120)
    store.record(s3, log.last_new, NOW + 120)  # nothing new, under 5 min: no snapshot
    store.flush()
    r = store.range(NOW + 30, NOW + 600)
    assert r["base_ts"] == NOW and [e["kind"] for e in r["events"]] == ["phase", "merge", "deploy"]
    assert r["events"][0]["source"] == "live" and r["events"][0]["pr"] == 253
    assert r["base"]["workpieces"] and "skills" not in r["base"]
    days = store.days()
    assert len(days) == 1 and days[0]["merges"] == 1 and days[0]["deploys"] == 1 and days[0]["snapshots"] == 2
    store.prune(now=NOW + 91 * 86400)
    assert store.range(0, NOW + 10**9)["events"] == [] and store.days() == []


def test_compact_strips_message_text(snapshot):
    snap = copy.deepcopy(snapshot)
    snap["stations"][0]["last_assistant_preview"] = "secret words"
    snap["stations"][0]["pending_question"] = {"question": "Which region?", "options": []}
    c = compact(snap)
    assert "last_assistant_preview" not in c["stations"][0]
    assert c["stations"][0]["pending_question"] == {"present": True} and "secret" not in json.dumps(c)


def test_parse_when():
    assert parse_when("1760000000") == 1760000000.0
    assert parse_when("2026-10-21T10:00:00Z") == 1792576800.0
    assert parse_when("yesterday") is None and parse_when(None) is None


class FakeScm:
    def pr_history(self, since_day):
        return [{"number": 253, "created_at": "2026-10-10T09:00:00Z", "merged_at": "2026-10-12T15:00:00Z",
                 "branch": "ft_x", "reviews": [{"login": "reviewbot", "state": "APPROVED", "at": "2026-10-12T10:00:00Z"}]},
                {"number": 100, "created_at": "2026-01-01T00:00:00Z", "merged_at": None, "reviews": []}]

    def deploy_history(self, since_day):
        return [{"databaseId": 1, "headSha": "a", "createdAt": "2026-10-12T14:00:00Z"},
                {"databaseId": 2, "headSha": "b", "createdAt": "2026-10-12T18:00:00Z"}]


def test_backfill_from_fakes_and_fixture_transcripts(tmp_path):
    store = HistoryStore(tmp_path / "h.sqlite")
    agent = ClaudeCodeAdapter({"personal": FIX / "projects"}, {})
    ad = SimpleNamespace(scm=FakeScm(), agent=agent, reviewer=ReviewerAdapter("reviewbot"))
    n = backfill.run(store, ad, days=30, now=NOW)
    store.flush()
    evs = store.range(0, NOW + 1)["events"]
    assert n == len(evs) > 0 and all(e["source"] == "backfill" for e in evs)
    by = {(e["kind"], e["pr"]) for e in evs}
    assert {("open", 253), ("review", 253), ("merge", 253), ("deploy", 253)} <= by
    assert ("open", 100) not in by  # older than the window
    dep = next(e for e in evs if e["kind"] == "deploy")
    assert dep["ts"] == parse_when("2026-10-12T18:00:00Z") and dep["approx"] is True
    assert next(e for e in evs if e["kind"] == "review")["by"] == "reviewer"
    kinds = {e["kind"] for e in evs}
    assert {"session_start", "session_end", "pr_link"} <= kinds
    assert backfill.run(store, ad, days=30, now=NOW) == 0  # once per store
    assert all("text" not in e for e in evs if e["kind"].startswith("session"))


def test_history_api(hub, tmp_path):  # noqa: F811
    from shufler.app import create_app
    hub.history = HistoryStore(tmp_path / "h.sqlite")
    hub.history.add_events([{"ts": NOW, "kind": "merge", "pr": 253, "from": "open", "to": "merged"}])
    hub.history.flush()
    with TestClient(create_app(hub, start_loop=False, testing=True)) as c:
        r = c.get(f"/api/history/range?from={NOW - 10}&to={NOW + 10}").json()
        assert [e["kind"] for e in r["events"]] == ["merge"] and r["base"] is None
        assert c.get("/api/history/range").status_code == 400
        assert c.get("/api/history/days").json()["days"][0]["merges"] == 1


def test_range_maps_old_phase_names(snapshot, tmp_path):
    store = HistoryStore(tmp_path / "h.sqlite")
    old = copy.deepcopy(snapshot)
    _wp(old, 253)["phase"], _wp(old, 253)["stage"] = "docs", "deployed"
    _wp(old, 300)["phase"] = "preview"
    _wp(old, 260)["phase"], _wp(old, 260)["stage"] = "merge", "merged"   # v4 "merge" meant merged: stage decides
    store.q.put(("snapshot", (NOW, json.loads(json.dumps(old)))))
    store.add_events([{"ts": NOW + 1, "kind": "phase", "pr": 253, "workpiece_id": "pr:253",
                       "from": "ci", "to": "docs"},
                      {"ts": NOW + 2, "kind": "phase", "pr": 300, "workpiece_id": "pr:300",
                       "from": "test", "to": "preview"}])
    store.flush()
    r = store.range(NOW, NOW + 10)
    assert [(e["from"], e["to"]) for e in r["events"]] == [("review", "shipped"), ("build", "qa")]
    assert r["events"][0]["closeout"] is True and "closeout" not in r["events"][1]
    assert _wp(r["base"], 253)["phase"] == "shipped" and _wp(r["base"], 253)["postmerge_owed"] is True
    assert _wp(r["base"], 260)["phase"] == "deploy"
    assert _wp(r["base"], 300)["phase"] == "qa"
