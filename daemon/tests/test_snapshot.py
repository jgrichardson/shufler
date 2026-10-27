import json

from shufler.collectors import parse_ledger
from tests.conftest import FIX, NOW


def by_id(items, key, value):
    return next(i for i in items if i[key] == value)


def test_halls_follow_groups_then_ungrouped(snapshot):
    assert [h["id"] for h in snapshot["halls"]] == ["IN_PROGRESS", "UNGROUPED"]
    assert snapshot["halls"][0]["station_ids"] == ["WS-A", "WS-B"]
    assert snapshot["halls"][1]["station_ids"] == ["WS-C"]


def test_station_joins(snapshot):
    a = by_id(snapshot["stations"], "id", "WS-A")
    # Title suffix resolves the session even though its note points at another ws_ref.
    assert a["title"] == "BILLING"
    assert a["session_id"] == "aaaa1111-0000-0000-0000-000000000000"
    assert a["note"]["state"] == "working"
    assert a["pr_numbers"] == [260]  # worktree branch → PR
    assert a["ports"] == [3005, 3041]
    assert a["last_prompt_at"] == "2026-10-21T13:47:00Z"

    b = by_id(snapshot["stations"], "id", "WS-B")
    assert b["session_id"] == "bbbb2222-0000-0000-0000-000000000000"
    assert b["account"] == "personal"
    assert b["note"] == {"state": "me", "text": "Owner: review and merge #253", "ts": 1760000100.0}
    assert b["activity"]["last_tool"] == "Bash"
    assert b["activity"]["subagents"] == 1  # toolu_B never got a result
    assert b["activity"]["status"] == "active"
    assert b["activity"]["idle_seconds"] == 50.0
    assert b["pr_numbers"] == [253]
    assert b["issue_slugs"] == ["support-queue"]
    assert b["tokens_today"] == 168  # msg_1 split records counted once

    c = by_id(snapshot["stations"], "id", "WS-C")
    assert c["session_id"] is None
    assert c["note"]["state"] == "waiting"  # parsed from the cmux description
    assert c["pr_numbers"] == [300]


def test_workpieces(snapshot):
    w = {x["pr"]: x for x in snapshot["workpieces"]}
    assert w[253]["stage"] == "ready"
    assert w[253]["station_id"] == "WS-B"
    assert w[253]["issue_slug"] == "support-queue"
    assert w[253]["board_stage"] == "in_review"
    assert w[253]["reviewer_loop"] == {"round": 2, "state": "approved"}
    assert w[253]["ledger"]["area"] == "auth"
    assert w[260]["stage"] == "ci" and w[260]["ci"] == "failure" and w[260]["failed_run_ids"] == [777]
    assert w[260]["station_id"] == "WS-A"
    assert w[300]["stage"] == "preview" and w[300]["reviewer"] == "none"
    assert w[171]["stage"] == "deployed" and w[171]["deployed_at"] == "2026-10-20T13:00:00Z"
    assert w[172]["stage"] == "merged"


def test_shipped_your_move_sources(snapshot):
    assert [s["pr"] for s in snapshot["shipped"]] == [172, 171]
    assert snapshot["shipped"][1]["deployed"] is True
    assert [m["id"] for m in snapshot["your_move"]] == ["question:WS-A", "merge:253", "closeout:171"]
    assert snapshot["sources"]["gh"]["ok"] is False
    assert snapshot["type"] == "snapshot" and snapshot["ts"] == NOW


def test_no_message_text_leaks(snapshot):
    blob = json.dumps(snapshot)
    for secret in ("SECRET", "PRIVATE"):
        assert secret not in blob


def test_empty_inputs_build():
    from shufler.snapshot import build_snapshot
    snap = build_snapshot({}, {}, 1.0)
    assert snap["stations"] == [] and snap["workpieces"] == [] and snap["halls"] == []


def test_parse_ledger_only_open_rows():
    rows = parse_ledger((FIX / "ledgers/auth/ledger.md").read_text())
    assert [r["branch"] for r in rows] == ["ft_x", "ft_y"]
    assert rows[0]["pr_numbers"] == [253] and rows[0]["ball"] == "Owner"
    assert rows[1]["pr_numbers"] == []


def test_round2_workpiece_fields(snapshot):
    w = {x["pr"]: x for x in snapshot["workpieces"]}
    assert w[253]["reviewer_at_head"] is True and w[253]["mergeable"] == "MERGEABLE" and w[253]["merge_state"] == "CLEAN"
    assert w[260]["mergeable"] == "CONFLICTING" and w[260]["reviewer_at_head"] is False
    assert w[300]["mergeable"] == "UNKNOWN"
    assert w[171]["closeout_owed"] is True    # deployed, issue still at "deployed"
    assert w[172]["closeout_owed"] is False   # issue already user_notified
    assert w[253]["closeout_owed"] is False   # not merged


def test_ready_needs_reviewer_at_head(raw_data):
    from shufler.snapshot import build_snapshot
    raw_data["gh_detail"]["253"]["head_at"] = "2026-10-21T09:30:00Z"  # pushed after the review bot's 09:00 approval
    w = {x["pr"]: x for x in build_snapshot(raw_data, {}, NOW)["workpieces"]}
    assert w[253]["reviewer"] == "approved" and w[253]["reviewer_at_head"] is False and w[253]["stage"] == "reviewer"


def test_pending_question_and_your_move(snapshot):
    a = by_id(snapshot["stations"], "id", "WS-A")
    q = a["pending_question"]
    assert q["question"] == "Narrow the cache fix so the review bot can approve?"
    assert q["header"] == "Scope"
    assert q["options"] == [
        {"label": "Narrow it", "description": "Smallest change", "recommended": True},
        {"label": "Keep fixing edge cases", "description": "Slower", "recommended": False},
    ]
    assert by_id(snapshot["stations"], "id", "WS-B")["pending_question"] is None
    q_row = next(m for m in snapshot["your_move"] if m["kind"] == "question")
    assert q_row["station_id"] == "WS-A" and q_row["severity"] == 3


def test_issue_events_and_null_quota(snapshot):
    b = by_id(snapshot["stations"], "id", "WS-B")
    assert [e["type"] for e in b["issue_events"]["support-queue"]] == ["review_approved", "reporter_replied", "ci_green"]
    assert set(b["issue_events"]["support-queue"][0]) == {"type", "ts"}
    assert b["context_pct"] is None and b["quota_pct"] is None


def test_last_assistant_preview(snapshot):
    assert by_id(snapshot["stations"], "id", "WS-B")["last_assistant_preview"] == "All tests pass. Pushed #253 for review."
    assert by_id(snapshot["stations"], "id", "WS-A")["last_assistant_preview"] == "Two ways to go here."
    assert by_id(snapshot["stations"], "id", "WS-C")["last_assistant_preview"] is None


def test_focus_and_session_source(snapshot):
    assert snapshot["focused_station_id"] == "WS-B"
    by = {s["id"]: s for s in snapshot["stations"]}
    assert by["WS-A"]["session_id_source"] == "title"
    assert by["WS-B"]["session_id_source"] == "note"
    assert by["WS-C"]["session_id_source"] == "none"


def test_stale_note_session_falls_back_to_fresh_cwd_transcript(raw_data):
    import copy
    from shufler.snapshot import build_snapshot
    from tests.conftest import NOW
    data = copy.deepcopy(raw_data)
    stale = "bbbb2222-0000-0000-0000-000000000000"
    data["transcripts"][stale]["last_at"] = NOW - 3 * 86400
    data["transcripts"]["cccc3333-0000-0000-0000-000000000000"] = {
        "cwd": "/Users/demo/widgets", "last_at": NOW - 120, "pr_numbers": [], "account": "personal"}
    data["transcripts"]["dddd4444-0000-0000-0000-000000000000"] = {
        "cwd": "/Users/demo/widgets", "last_at": NOW - 3600, "pr_numbers": [], "account": "personal"}
    by = {s["id"]: s for s in build_snapshot(data, {}, NOW)["stations"]}
    assert (by["WS-B"]["session_id"], by["WS-B"]["session_id_source"]) == ("cccc3333-0000-0000-0000-000000000000", "cwd_match")
    assert by["WS-C"]["session_id"] is None  # the only fresh transcript is already claimed by WS-B


def test_sidebar_order_and_groups(snapshot):
    # WS-C is ungrouped at cmux index 2, so the sidebar draws it below IN_PROGRESS, not above
    assert snapshot["groups"] == [{"name": "IN_PROGRESS", "pinned": True, "member_count": 2, "index": 0},
                                  {"name": "", "pinned": True, "member_count": 1, "index": 1}]
    side = {s["id"]: s["sidebar_index"] for s in snapshot["stations"]}
    assert side == {"WS-A": 0, "WS-B": 1, "WS-C": 2}
    assert [s["id"] for s in snapshot["stations"]] == ["WS-A", "WS-B", "WS-C"]  # array keeps cmux list order


def test_sidebar_follows_the_cmux_index(raw_data):
    """cmux numbers the sidebar top to bottom; the index wins over group list order and member order."""
    import copy
    from shufler.snapshot import build_snapshot
    from tests.conftest import NOW
    raw = copy.deepcopy(raw_data)
    raw["groups"] = [{"name": "ON_HOLD", "ref": "g:2", "color": None, "members": ["workspace:4"], "pinned": True},
                     {"name": "IN_PROGRESS", "ref": "g:1", "color": None,
                      "members": ["workspace:3", "workspace:2"], "pinned": False}]
    snap = build_snapshot(raw, {}, NOW)
    assert [(g["name"], g["index"], g["pinned"]) for g in snap["groups"]] == [("IN_PROGRESS", 0, False),
                                                                            ("ON_HOLD", 1, True)]
    assert {s["id"]: s["sidebar_index"] for s in snap["stations"]} == {"WS-A": 0, "WS-B": 1, "WS-C": 2}


def test_ungrouped_workspace_below_a_group_stays_below(raw_data):
    """A loose workspace dragged under a (collapsed) group keeps that place on the floor."""
    import copy
    from shufler.snapshot import build_snapshot
    from tests.conftest import NOW
    raw = copy.deepcopy(raw_data)
    idx = {"WS-A": 2, "WS-B": 0, "WS-C": 1}           # sidebar: B (grouped), C (grouped), A (loose)
    raw["terminal"] = [{**w, "index": idx[w["id"]]} for w in raw["terminal"]]
    raw["groups"] = [{"name": "LEDGERS", "ref": "g:1", "color": None, "members": ["workspace:3", "workspace:4"],
                      "pinned": True}]
    snap = build_snapshot(raw, {}, NOW)
    assert {s["id"]: s["sidebar_index"] for s in snap["stations"]} == {"WS-B": 0, "WS-C": 1, "WS-A": 2}
    assert [g["name"] for g in snap["groups"]] == ["LEDGERS", ""]


def test_group_anchors_from_real_cmux_json(raw_data, monkeypatch):
    """cmux backs each group with an anchor workspace that the sidebar draws as the header."""
    import copy
    from shufler import runner
    from shufler.adapters.terminal import CmuxAdapter
    from shufler.runner import RunResult
    from shufler.snapshot import build_snapshot
    from tests.conftest import FIX, NOW
    monkeypatch.setattr(runner, "run", lambda argv, timeout=30, env=None:
                        RunResult(0, (FIX / "cmux_groups_real.json").read_text(), ""))
    groups = CmuxAdapter("cmux").list_groups()
    assert {g["name"]: g["anchor"] for g in groups} == {
        "IN_PROGRESS": "workspace:2", "ON_HOLD": "workspace:13", "GENERAL": "workspace:14"}
    titles = {1: "CONTROL", 2: "LEDGERS", 17: "INFRA", 4: "AUTH", 7: "MOBILE",
              6: "SEARCH", 5: "BILLING", 13: "Group 5", 8: "BACKOFFICE", 22: "BUG_SQUASH", 23: "RHO_NATIVE_BANK",
              9: "DASHBOARDS", 19: "BOOKS_CLOSING_AGENT", 14: "Group 1 · aaaa1111", 15: "SHARED", 16: "CODEX"}
    base = raw_data["terminal"][2]
    raw = copy.deepcopy(raw_data)
    raw["groups"] = groups
    raw["terminal"] = [{**base, "id": f"WS-{n}", "ref": f"workspace:{n}", "index": i, "title": t, "custom_title": t,
                    "description": None, "current_directory": "/Users/demo/widgets", "selected": False}
                   for i, (n, t) in enumerate(titles.items())]
    snap = build_snapshot(raw, {}, NOW)
    refs = [s["ref"] for s in snap["stations"]]
    assert "workspace:2" not in refs and "workspace:13" not in refs     # anchors without a session: headers only
    anchored = next(s for s in snap["stations"] if s["ref"] == "workspace:14")
    assert anchored["session_id"] and anchored["anchor_for"] == "GENERAL"  # a live session keeps it
    assert all(s["anchor_for"] is None for s in snap["stations"] if s["ref"] != "workspace:14")
    assert [(g["name"], g["member_count"]) for g in snap["groups"]] == [
        ("", 1), ("IN_PROGRESS", 5), ("ON_HOLD", 5), ("GENERAL", 1)]
    order = sorted(snap["stations"], key=lambda s: s["sidebar_index"])
    assert [s["sidebar_index"] for s in order] == list(range(len(order))) == list(range(12))
    assert sorted(s["title"] for s in snap["utility_stations"]) == ["CODEX", "SHARED"]   # utility: no row
    assert all(s["utility"] and s["domain"] is None for s in snap["utility_stations"])
    assert [s["title"] for s in order][:3] == ["CONTROL", "INFRA", "AUTH"]


def test_closed_issues_do_not_attach_to_a_station(raw_data):
    import copy
    from shufler.snapshot import build_snapshot
    from tests.conftest import NOW
    data = copy.deepcopy(raw_data)
    sid = "bbbb2222-0000-0000-0000-000000000000"
    base = {"title": "x", "domain": "fees", "pr": None, "session_id": sid, "events": [],
            "card_id": None, "board_stage": None}
    data["intake"]["open-bug"] = {**base, "slug": "open-bug", "state": "intake"}
    data["intake"]["sent-bug"] = {**base, "slug": "sent-bug", "state": "user_notified"}
    data["intake"]["closed-bug"] = {**base, "slug": "closed-bug", "state": "closed"}
    st = next(s for s in build_snapshot(data, {}, NOW)["stations"] if s["id"] == "WS-B")
    assert "open-bug" in st["issue_slugs"]
    assert not {"sent-bug", "closed-bug"} & set(st["issue_slugs"])
