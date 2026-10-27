import copy
import json

import pytest

from shufler.snapshot import build_snapshot
from shufler.world import (PhaseMemory, _ball_from_ledger, enrich, load_domains, map_phase, match_domain,
                           non_pr_phase, tokens)
from tests.conftest import DOMAINS, NOW

DOMS = load_domains(DOMAINS)


def by(items, key, value):
    return next(i for i in items if i[key] == value)


def build(raw, memory=None, acks=None, now=NOW):
    return enrich(build_snapshot(raw, {}, now), raw, now, memory or PhaseMemory(__import__("pathlib").Path("/dev/null")),
                  acks or set(), DOMS)


@pytest.mark.parametrize("text,expected", [
    ("ios-release", "mobile"), ("MOBILE", "mobile"), ("terraform/vpc", "infra"), ("INFRA", "infra"),
    ("SEARCH_RANKING_AGENT", "search"), ("readme", "docs"), ("ft_09-16_invoice_pdf_export", "billing"),
    ("www-account", None), ("", None), ("payments", "billing"), ("auth", "auth"), ("oauth billing", "auth"),
])
def test_match_domain(text, expected):
    assert match_domain(text, DOMS) == expected


def test_tokens_include_joined_pairs():
    assert "cash_flow" in tokens("cash-flow") and "rate-limit" in tokens("rate limit")


@pytest.mark.parametrize("text,plan_doc,phase", [
    ("intake", False, "plan"), ("brainstorm", False, "brainstorm"), ("ideate on pricing tiers", False, "brainstorm"),
    ("explore options", False, "brainstorm"), ("brainstorm, see docs/plans/x-plan.md", False, "plan"),
    ("brainstorm", True, "plan"), ("building", False, "plan"), ("me", False, "plan"), (None, False, "plan"),
])
def test_non_pr_phase(text, plan_doc, phase):
    assert non_pr_phase(text, plan_doc) == phase


def test_map_phase_old_names():
    assert [map_phase(p) for p in ("test", "ci", "preview", "ready", "docs", "build", "shipped", None)] == \
        ["build", "review", "qa", "merge", "shipped", "build", "shipped", None]


@pytest.mark.parametrize("raw,who,name", [
    ("Owner", "owner", None), ("me", "owner", None), ("Owner merges, then #20013", "owner", None),
    ("Sam", "person", "Sam"), ("Dev (msg owed)", "person", "Dev"), ("Reviewer", "reviewer", None), ("reviewbot asked", "reviewer", None), ("area session", "claude", None),
    ("Claude", "claude", None), ("", None, None),
])
def test_ball_from_ledger(raw, who, name):
    b = _ball_from_ledger(raw)
    assert (b and b["who"], b and b["name"]) == (who, name) if who else b is None


def test_links_sources_and_primary_owner(snapshot):
    b = by(snapshot["stations"], "id", "WS-B")
    assert [(l["id"], l["source"]) for l in b["links"]] == [("pr:253", "ledger"), ("branch:ft_y", "ledger")]
    assert b["workpiece_ids"] == ["pr:253", "branch:ft_y"] and b["pr_numbers"] == [253]
    a = by(snapshot["stations"], "id", "WS-A")
    assert [(l["id"], l["source"]) for l in a["links"]] == [("pr:260", "worktree")]
    c = by(snapshot["stations"], "id", "WS-C")
    assert [(l["id"], l["source"]) for l in c["links"]] == [("pr:300", "cmux")]
    w = by(snapshot["workpieces"], "id", "pr:253")
    assert w["station_id"] == "WS-B" and w["station_ids"] == ["WS-B"]
    assert by(snapshot["workpieces"], "id", "pr:171")["station_id"] is None  # unowned


def test_station_domain_group_focus(snapshot):
    st = {s["id"]: s for s in snapshot["stations"]}
    assert (st["WS-A"]["domain"], st["WS-B"]["domain"], st["WS-C"]["domain"]) == ("billing", "auth", "unassigned")
    assert st["WS-A"]["group"] == "IN_PROGRESS" and st["WS-C"]["group"] is None
    assert st["WS-A"]["focus_workpiece_id"] == "pr:260"   # worktree branch
    assert st["WS-B"]["focus_workpiece_id"] == "pr:253"   # latest open pr-link
    assert st["WS-C"]["focus_workpiece_id"] is None


def test_workpiece_world_fields(snapshot):
    w = {x["id"]: x for x in snapshot["workpieces"]}
    assert (w["pr:253"]["domain"], w["pr:253"]["domain_source"]) == ("auth", "ledger")
    assert (w["pr:260"]["domain"], w["pr:260"]["domain_source"]) == ("billing", "branch")
    assert w["pr:253"]["phase"] == "merge" and w["pr:253"]["ball"] == {"who": "owner", "name": None}
    assert w["pr:260"]["phase"] == "build" and w["pr:260"]["ball"]["who"] == "owner"  # owner has a pending question
    assert w["pr:260"]["stuck"] is True                                               # owner stalled
    assert w["pr:300"]["phase"] == "qa" and w["pr:300"]["ball"]["who"] == "testers"
    assert w["pr:171"]["phase"] == "shipped" and w["pr:171"]["postmerge_owed"] and w["pr:171"]["ball"]["who"] == "closeout"
    assert w["pr:172"]["phase"] == "deploy" and w["pr:172"]["ball"]["who"] == "none" and not w["pr:172"]["postmerge_owed"]
    assert w["branch:ft_y"]["kind"] == "branch" and w["branch:ft_y"]["pr"] is None and w["branch:ft_y"]["phase"] == "plan"
    assert all(x["kind"] == "pr" and x["size"] == "M" for k, x in w.items() if k.startswith("pr:"))
    assert all(not any(key.startswith("_") for key in x) for x in w.values())
    assert all(isinstance(x["phase_since"], float) for x in w.values())


def test_domains_list_and_shipped(snapshot):
    assert [(d["id"], d["lane"]) for d in snapshot["domains"]] == [("auth", 0), ("billing", 1), ("unassigned", 2)]
    pf = by(snapshot["domains"], "id", "auth")
    assert pf["code"] == "AU" and pf["color"] == "#E3C04B" and pf["station_ids"] == ["WS-B"]
    assert pf["counts"] == {"live": 2, "owner": 1, "parked": 0}
    assert all("domain" in s for s in snapshot["shipped"])
    assert snapshot["your_move_count"] == len(snapshot["your_move"]) == 3


def test_your_move_rows(snapshot):
    rows = {r["id"]: r for r in snapshot["your_move"]}
    assert rows["merge:253"]["text"] == "Merge #253" and rows["merge:253"]["severity"] == 3
    assert "note:WS-B" not in rows and rows["merge:253"]["also"] == ["note"]
    assert rows["merge:253"]["also_ids"] == ["note:WS-B"]
    assert rows["closeout:171"]["severity"] == 1
    assert set(rows["question:WS-A"]) >= {"id", "kind", "station_id", "pr", "text", "since", "severity"}


def test_reply_rows_and_acks(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["intake"]["support-queue"]["events"] = [{"type": "user_replied", "ts": "2026-10-21T09:30:00+00:00"}]
    snap = build(raw)
    merge = by(snap["your_move"], "id", "merge:253")  # the reply on #253 folds into its merge row
    reply_id = "reply:support-queue:2026-10-21T09:30:00+00:00"
    assert "reply" in merge["also"] and reply_id in merge["also_ids"]
    raw["intake"]["support-queue"]["pr"] = None
    snap = build(raw)
    reply = by(snap["your_move"], "kind", "reply")
    assert reply["id"] == reply_id and reply["pr"] is None and reply["text"].startswith("Reporter replied")
    snap = build(raw, acks={reply_id, "closeout:171", "merge:253"})
    kinds = [r["kind"] for r in snap["your_move"]]
    assert "reply" not in kinds and "closeout" not in kinds and "merge" in kinds  # merge is not ackable


def test_phase_since_persists_and_resets(raw_data, tmp_path):
    mem_path = tmp_path / "phase_since.json"
    first = build(copy.deepcopy(raw_data), PhaseMemory(mem_path), now=NOW)
    since = by(first["workpieces"], "id", "pr:253")["phase_since"]
    assert since == NOW and json.loads(mem_path.read_text())["pr:253"]["phase"] == "merge"
    again = build(copy.deepcopy(raw_data), PhaseMemory(mem_path), now=NOW + 100)
    assert by(again["workpieces"], "id", "pr:253")["phase_since"] == NOW
    raw = copy.deepcopy(raw_data)
    raw["gh_detail"]["253"]["head_at"] = "2026-10-21T09:30:00Z"  # push after approval → no longer ready → review
    moved = build(raw, PhaseMemory(mem_path), now=NOW + 200)
    w = by(moved["workpieces"], "id", "pr:253")
    assert w["phase"] == "review" and w["phase_since"] == NOW + 200


def test_phase_memory_maps_old_names(tmp_path):
    mem_path = tmp_path / "phase_since.json"
    mem_path.write_text(json.dumps({"pr:1": {"phase": "ci", "since": 5.0}, "pr:2": {"phase": "docs", "since": 6.0}}))
    mem = PhaseMemory(mem_path)
    assert mem.since("pr:1", "review", NOW) == 5.0 and mem.since("pr:2", "shipped", NOW) == 6.0


def test_kinds_parked_plan_and_test_phases(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["gh"].append({**raw["gh"][2], "number": 400, "title": "docs(auth): runbook", "branch": "ft_docs",
                      "labels": [], "draft": True, "additions": 0, "deletions": 0})
    raw["gh"].append({**raw["gh"][2], "number": 401, "title": "fix: x", "branch": "ft_backfill_positions",
                      "labels": [], "draft": True, "additions": 900, "deletions": 10})
    raw["ledgers"]["auth"].append({"branch": "ft_backfill", "pr": "", "topic": "backfill fleet", "state": "parked",
                                         "ball": "Dev", "next": "", "worktree": "", "session": "", "pr_numbers": []})
    raw["ledgers"]["auth"].append({"branch": "ft_plan", "pr": "", "topic": "new idea", "state": "brainstorm",
                                         "ball": "", "next": "", "worktree": "", "session": "", "pr_numbers": []})
    raw["ledgers"]["auth"][0]["next"] = "run the test battery"
    snap = build(raw)
    w = {x["id"]: x for x in snap["workpieces"]}
    assert w["pr:400"]["kind"] == "docs" and w["pr:400"]["phase"] == "plan"
    assert w["pr:401"]["kind"] == "data_fix" and w["pr:401"]["size"] == "L"
    assert w["fix:ft-backfill"]["kind"] == "data_fix" and w["fix:ft-backfill"]["parked"] is True
    assert w["fix:ft-backfill"]["ball"] == {"who": "person", "name": "Dev"}
    assert w["plan:ft-plan"]["kind"] == "plan" and w["plan:ft-plan"]["phase"] == "brainstorm"
    assert w["pr:401"]["phase"] == "build"                    # draft with commits, no review signals


def test_issue_without_pr_becomes_item(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["intake"]["new-bug"] = {"slug": "new-bug", "title": "New bug", "state": "intake", "domain": "ios", "pr": None,
                                "session_id": "bbbb2222-0000-0000-0000-000000000000", "events": [],
                                "card_id": None, "card_stage": None}
    snap = build(raw)
    w = by(snap["workpieces"], "id", "issue:new-bug")
    assert (w["kind"], w["domain"], w["domain_source"], w["phase"], w["station_id"]) == \
        ("issue", "mobile", "issue", "plan", "WS-B")
    assert ("issue:new-bug", "issue") in [(l["id"], l["source"]) for l in by(snap["stations"], "id", "WS-B")["links"]]


def test_your_move_one_row_per_pr(raw_data):
    import copy
    snap = build(copy.deepcopy(raw_data))
    rows = snap["your_move"]
    prs = [r["pr"] for r in rows if r["pr"] is not None]
    assert len(prs) == len(set(prs))
    r = next(r for r in rows if r["pr"] == 253)
    assert r["kind"] == "merge" and r["also"] == ["note"]
    assert all(isinstance(r["also"], list) for r in rows)


def test_pipeline_stages_in_snapshot(snapshot):
    assert [(p["id"], p["color"]) for p in snapshot["pipeline_stages"]] == [
        ("brainstorm", "#9aa4b2"), ("plan", "#7c8cf8"), ("build", "#f2b544"), ("qa", "#45c7e0"),
        ("review", "#f28c38"), ("merge", "#a56cf0"), ("deploy", "#3dd68c")]
    live = {w["phase"] for w in snapshot["workpieces"]}
    assert live <= {p["id"] for p in snapshot["pipeline_stages"]} | {"shipped"}


def test_review_needs_a_review_signal(raw_data):
    raw = copy.deepcopy(raw_data)
    quiet = {**raw["gh"][0], "number": 410, "branch": "ft_quiet", "draft": False, "reviews": [], "checks": [], "review_decision": None,
             "labels": [], "additions": 40, "deletions": 2}
    red = {**quiet, "number": 411, "branch": "ft_red", "checks": [{"name": "ci", "conclusion": "FAILURE"}]}
    raw["gh"] += [quiet, red]
    w = {x["id"]: x for x in build(raw)["workpieces"]}
    assert w["pr:410"]["phase"] == "build" and w["pr:411"]["phase"] == "review"
    assert w["pr:260"]["phase"] == "build"  # draft with red CI stays in build


def test_non_pr_item_plan_from_recent_skill(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["intake"]["new-idea"] = {"slug": "new-idea", "title": "Explore fee tiers", "state": "intake", "domain": "fees",
                                 "pr": None, "session_id": "bbbb2222-0000-0000-0000-000000000000", "events": [],
                                 "card_id": None, "card_stage": None}
    assert by(build(raw)["workpieces"], "id", "issue:new-idea")["phase"] == "brainstorm"
    sid = "bbbb2222-0000-0000-0000-000000000000"
    raw["transcripts"][sid] = {**raw["transcripts"][sid], "recent_skills": ["ce-plan"]}
    assert by(build(raw)["workpieces"], "id", "issue:new-idea")["phase"] == "plan"


def test_domain_reasons_and_fallback_last(snapshot):
    w = {x["id"]: x for x in snapshot["workpieces"]}
    assert w["pr:253"]["domain_reason"] == "area ledger `auth`"
    assert w["pr:260"]["domain_reason"].startswith("branch `")
    st = {s["id"]: s for s in snapshot["stations"]}
    assert (st["WS-B"]["domain_source"], st["WS-B"]["domain_reason"]) == ("title", "workspace title `AUTH`")
    assert (st["WS-C"]["domain_source"], st["WS-C"]["domain"]) == ("fallback", "unassigned")
    un = snapshot["domains"][-1]
    assert un["id"] == "unassigned" and un["code"] == "??" and un["label"] == "Unassigned"


def test_fallback_domain_added_and_last_when_config_omits_it(raw_data):
    doms = [d for d in DOMS if d["id"] != "unassigned"]
    doms = doms[:1] + [{"id": "unassigned", "label": "X", "code": "X", "color": "#000", "aliases": []}] + doms[1:]
    snap = enrich(build_snapshot(copy.deepcopy(raw_data), {}, NOW), copy.deepcopy(raw_data), NOW,
                  PhaseMemory(__import__("pathlib").Path("/dev/null")), set(), doms)
    assert snap["domains"][-1]["id"] == "unassigned"
    snap = enrich(build_snapshot(copy.deepcopy(raw_data), {}, NOW), copy.deepcopy(raw_data), NOW,
                  PhaseMemory(__import__("pathlib").Path("/dev/null")), set(), [d for d in DOMS if d["id"] != "unassigned"])
    assert snap["domains"][-1] == {**snap["domains"][-1], "id": "unassigned", "code": "??"}


def test_manual_alias_wins(raw_data):
    doms = copy.deepcopy(DOMS)
    acc = next(d for d in doms if d["id"] == "search")
    acc["manual"] = ["ft_billing_branch", "loose"]
    snap = enrich(build_snapshot(copy.deepcopy(raw_data), {}, NOW), copy.deepcopy(raw_data), NOW,
                  PhaseMemory(__import__("pathlib").Path("/dev/null")), set(), doms)
    w = by(snap["workpieces"], "id", "pr:260")
    assert (w["domain"], w["domain_source"]) == ("search", "manual") and "set by hand" in w["domain_reason"]
    st = by(snap["stations"], "id", "WS-C")
    assert (st["domain"], st["domain_source"]) == ("search", "manual")


@pytest.mark.parametrize("title,cwd,expected", [
    ("Group 5", "/Users/demo/widgets", True), ("", None, True), ("widgets", "/Users/demo/widgets", True),
    ("AUTH X", "/Users/demo/widgets", False),
])
def test_empty_stations(raw_data, title, cwd, expected):
    raw = copy.deepcopy(raw_data)
    ws = next(w for w in raw["terminal"] if w["id"] == "WS-C")
    ws.update(title=title, custom_title=title, current_directory=cwd, description=None)
    st = by(build(raw)["stations"], "id", "WS-C")
    assert st["empty"] is expected
    ws = next(w for w in raw["terminal"] if w["id"] == "WS-B")  # has a session with recent transcript activity
    ws.update(title="Group 9", custom_title="Group 9")
    assert by(build(raw, now=NOW)["stations"], "id", "WS-B")["empty"] is False


def test_phase_descriptions(snapshot):
    d = {p["id"]: p["description"] for p in snapshot["pipeline_stages"]}
    assert d["merge"] == "Ready to merge."
    assert d["deploy"] == "Merged, waiting on the production deploy."
    assert all(d.values())


def test_v41_merge_deploy_shipped_and_closeout(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["gh"][0]["labels"] = ["preview"]                  # ready to merge AND on preview: merge wins
    raw["intake"]["support-queue"]["pr"] = 172          # merged, not deployed, issue still open
    snap = build(raw)
    w = {x["id"]: x for x in snap["workpieces"]}
    assert w["pr:253"]["phase"] == "merge" and w["pr:253"]["ball"]["who"] == "owner"
    assert w["pr:172"]["phase"] == "deploy" and w["pr:172"]["closeout_owed"]
    assert w["pr:172"]["ball"] == {"who": "none", "name": None} and not w["pr:172"]["postmerge_owed"]
    rows = {r["id"] for r in snap["your_move"]}
    assert "closeout:172" not in rows and "closeout:171" in rows   # close-out only once shipped
    assert w["pr:171"]["phase"] == "shipped" and w["pr:171"]["postmerge_owed"] is True


def test_ledger_state_review_maps_to_review_phase(raw_data):
    raw = copy.deepcopy(raw_data)
    assert by(build(raw)["workpieces"], "id", "pr:300")["phase"] == "qa"   # preview label alone reads as QA
    pr = by(raw["gh"], "number", 300)
    raw["ledgers"]["auth"].append({**raw["ledgers"]["auth"][0], "branch": pr["branch"], "pr": "#300",
                                         "state": "Review", "next": "", "pr_numbers": [300]})
    assert by(build(raw)["workpieces"], "id", "pr:300")["phase"] == "review"


def test_ledger_state_review_holds_a_ready_pr_out_of_merge(raw_data):
    raw = copy.deepcopy(raw_data)
    assert by(build(raw)["workpieces"], "id", "pr:253")["phase"] == "merge"
    row = next(r for r in raw["ledgers"]["auth"] if 253 in (r.get("pr_numbers") or []))
    row.update(state="review", next="browser QA on preview")
    w = build(raw)
    assert by(w["workpieces"], "id", "pr:253")["phase"] == "review"
    assert not any(r["kind"] == "merge" and r["pr"] == 253 for r in w["your_move"])
