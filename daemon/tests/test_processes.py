import copy

from shufler import processes, runner
from shufler.processes import ProcessScanner, parse_env_workspace, parse_etime, parse_lsof_cwd, parse_ps
from shufler.runner import RunResult
from shufler.snapshot import build_snapshot
from tests.conftest import FIX, NOW
from tests.test_world import build, by

PS = (FIX / "ps_claude.txt").read_text()


def test_parse_ps_keeps_interactive_claude_only():
    procs = {p["pid"]: p for p in parse_ps(PS)}
    assert set(procs) == {51460, 34319, 51630, 56300, 64151, 28835, 51021, 49690, 49711, 35005}
    assert procs[51460]["session_id"] == "e0d2cdd3-ad36-40c3-b688-b1741d3d5d3d" and procs[51460]["tty"] == "ttys005"
    assert procs[49690]["session_id"] == "db52364d-69c5-404b-bcea-1cea922a934e"           # --session-id
    assert procs[34319]["session_id"] is None and procs[35005]["session_id"] is None
    assert procs[49690]["etime_s"] == ((13 * 24 + 3) * 60 + 2) * 60 + 2 and procs[35005]["etime_s"] == 216


def test_parse_helpers():
    assert parse_etime("01:02") == 62 and parse_etime("1-00:00:01") == 86401 and parse_etime("x") is None
    assert parse_lsof_cwd("p1\nfcwd\nn/a/b\np2\nfcwd\nn/c d\n") == {1: "/a/b", 2: "/c d"}
    env = "  7 claude --x FOO=1 CMUX_WORKSPACE_ID=68f9a312-213f-4961-99bc-8dbaff1c26f2 BAR=2\n  8 claude HOME=/x\n"
    assert parse_env_workspace(env) == {7: "68F9A312-213F-4961-99BC-8DBAFF1C26F2"}


def test_scanner_caches_cwd_and_env_per_process(monkeypatch):
    calls = []

    def fake(argv, timeout=30, env=None):
        calls.append(argv[:2])
        if argv[:2] == ["ps", "-axww"]:
            return RunResult(0, PS, "")
        if argv[0] == "lsof":
            pids = argv[-1].split(",")
            return RunResult(0, "".join(f"p{p}\nfcwd\nn/w/{p}\n" for p in pids), "")
        return RunResult(0, "49711 claude CMUX_WORKSPACE_ID=68F9A312-213F-4961-99BC-8DBAFF1C26F2\n", "")
    monkeypatch.setattr(runner, "run", fake)
    sc = ProcessScanner()
    out = {p["pid"]: p for p in sc()}
    assert out[49711]["workspace_id"] == "68F9A312-213F-4961-99BC-8DBAFF1C26F2" and out[28835]["cwd"] == "/w/28835"
    assert out[51460]["workspace_id"] is None
    calls.clear()
    sc()
    assert calls == [["ps", "-axww"]]                       # steady fleet: one ps per tick


def _proc(pid, sid=None, cwd=None, ws=None, etime=100):
    return {"pid": pid, "tty": "ttys001", "etime_s": etime, "since": NOW - etime, "session_id": sid, "cwd": cwd,
            "workspace_id": ws}


def test_mapping_by_env_session_and_cwd(raw_data):
    raw = copy.deepcopy(raw_data)
    a_sid = by(build(copy.deepcopy(raw_data))["stations"], "id", "WS-A")["session_id"]
    raw["terminal"][2]["current_directory"] = "/Users/demo/loose"                      # WS-C gets a unique cwd
    raw["processes"] = [
        _proc(1, sid=a_sid),                                                     # by joined session id
        _proc(2, sid="db52364d-69c5-404b-bcea-1cea922a934e", ws="ws-a", etime=10**6),  # by cmux env id
        _proc(3, cwd="/Users/demo/loose"),                                          # by unique cwd
        _proc(4, cwd="/nowhere"),                                                # no workspace, no transcript
    ]
    snap = build(raw)
    st = {s["id"]: s for s in snap["stations"]}
    a = st["WS-A"]["claude"]
    assert a["running"] and a["count"] == 2 and a["pid"] == 1
    assert a["sessions"] == [a_sid, "db52364d-69c5-404b-bcea-1cea922a934e"]     # joined one first
    assert st["WS-C"]["claude"]["running"] and st["WS-C"]["claude"]["count"] == 1
    assert st["WS-B"]["claude"] == {"running": False, "pid": None, "since": None, "sessions": [], "count": 0}
    assert st["WS-B"]["activity"]["status"] == "closed"


def test_closed_station_raises_no_your_move(raw_data):
    raw = copy.deepcopy(raw_data)
    before = {r["id"] for r in build(copy.deepcopy(raw))["your_move"]}
    assert "question:WS-A" in before
    raw["processes"] = []                                                        # nothing running anywhere
    snap = build(raw)
    ids = {r["id"] for r in snap["your_move"]}
    assert not any(i.startswith(("note:", "question:")) for i in ids)
    assert all(s["activity"]["status"] == "closed" for s in snap["stations"])
    assert by(snap["workpieces"], "id", "pr:260")["ball"]["who"] != "owner" or \
        by(snap["workpieces"], "id", "pr:260")["phase"] == "merge"


def test_no_process_source_changes_nothing(raw_data):
    snap = build(copy.deepcopy(raw_data))
    assert all(s["claude"] is None and s["activity"]["status"] != "closed" for s in snap["stations"])


def test_process_session_replaces_a_stale_join(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["processes"] = [_proc(9, sid="99999999-0000-0000-0000-000000000000", ws="WS-B")]
    st = by(build(raw)["stations"], "id", "WS-B")
    assert st["session_id"] == "99999999-0000-0000-0000-000000000000" and st["session_id_source"] == "process"


def test_note_ws_ref_needs_matching_cwd(raw_data):
    raw = copy.deepcopy(raw_data)
    base = build_snapshot(copy.deepcopy(raw), {}, NOW)
    joined = {s["id"]: (s["session_id"], s["session_id_source"]) for s in base["stations"]}
    note_joined = [sid for sid, (_, src) in joined.items() if src == "note"]
    assert note_joined, "fixture has a note-joined station"
    wid = note_joined[0]
    sid = joined[wid][0]
    raw["notes"][sid]["cwd"] = "/somewhere/else"                                 # ref renumbered: cwd disagrees
    after = {s["id"]: s for s in build_snapshot(raw, {}, NOW)["stations"]}
    assert after[wid]["session_id_source"] != "note"


def test_utility_stations_reachable_for_terminals(snapshot):
    from shufler import actions
    snap = copy.deepcopy(snapshot)
    snap["utility_stations"] = [{"id": "WS-U", "ref": "workspace:9", "title": "SHARED", "utility": True}]
    assert actions._station(snap, {"station_id": "WS-U"})["title"] == "SHARED"


def test_no_arg_process_takes_newest_recent_transcript_in_its_cwd(raw_data):
    raw = copy.deepcopy(raw_data)
    b = by(build(copy.deepcopy(raw_data))["stations"], "id", "WS-B")
    raw["processes"] = [_proc(5, cwd=b["cwd"])]       # cwd shared by two workspaces: the session decides
    st = by(build(raw)["stations"], "id", "WS-B")
    assert st["claude"]["running"] and st["claude"]["sessions"] == [b["session_id"]]


def test_process_named_like_the_workspace_is_the_joined_one(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["terminal"][1]["title"] = raw["terminal"][1]["custom_title"] = "INFRA"
    raw["processes"] = [{**_proc(1, sid="db52364d-69c5-404b-bcea-1cea922a934e", ws="WS-B", etime=10**6)},
                        {**_proc(2, sid="2dcf0883-dce2-4812-a91b-55d0c6afe4f4", ws="WS-B"), "name": "INFRA"}]
    st = by(build(raw)["stations"], "id", "WS-B")
    assert st["session_id"] == "2dcf0883-dce2-4812-a91b-55d0c6afe4f4" and st["session_id_source"] == "process_name"
    assert st["claude"]["sessions"][0] == st["session_id"] and st["claude"]["count"] == 2
    assert {p["pid"]: p["name"] for p in parse_ps(PS)}[49711] == "INFRA"


def test_parse_env_reads_the_ledger_area():
    from shufler.processes import parse_env
    env = ("  7 claude A=1 CMUX_WORKSPACE_ID=68f9a312-213f-4961-99bc-8dbaff1c26f2 LEDGER_AREA=Mobile B=2\n"
           "  8 claude HOME=/x\n  9 claude LEDGER_AREA=bad;rm\n")
    assert parse_env(env) == {
        7: {"workspace_id": "68F9A312-213F-4961-99BC-8DBAFF1C26F2", "ledger_area": "mobile"},
        8: {"workspace_id": None, "ledger_area": None},
        9: {"workspace_id": None, "ledger_area": None}}


def test_ledger_area_and_row_order(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["terminal"][1]["title"] = raw["terminal"][1]["custom_title"] = "CONTROL"            # WS-B
    raw["processes"] = [
        {**_proc(1, ws="WS-A"), "ledger_area": None},
        {**_proc(2, ws="WS-A", etime=50), "ledger_area": "billing"},                         # second session carries it
        {**_proc(3, ws="WS-C"), "ledger_area": "auth"},
        {**_proc(4, ws="WS-B"), "name": "CONTROL"},
    ]
    st = {s["id"]: s for s in build(raw)["stations"]}
    assert (st["WS-A"]["ledger_area"], st["WS-C"]["ledger_area"], st["WS-B"]["ledger_area"]) == ("billing", "auth", None)
    assert all(s["row_order"] == s["sidebar_index"] for s in st.values())      # area sessions get no special rank
    assert sorted(s["sidebar_index"] for s in st.values()) == [0, 1, 2]
    assert all("_names" not in s for s in st.values())


def test_row_order_follows_the_sidebar(snapshot):
    st = sorted(snapshot["stations"], key=lambda s: s["row_order"])
    assert [s["row_order"] for s in st] == [0, 1, 2]
    assert [s["id"] for s in st] == [s["id"] for s in sorted(snapshot["stations"], key=lambda s: s["sidebar_index"])]
    assert all(s["ledger_area"] is None for s in st)


def test_control_keeps_its_sidebar_position(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["processes"] = [{**_proc(4, ws="WS-C"), "name": "CONTROL"}]   # WS-C is last in the sidebar
    st = {s["id"]: s for s in build(raw)["stations"]}
    assert st["WS-C"]["sidebar_index"] == 2 and st["WS-C"]["row_order"] == 2
    assert all(s["row_order"] == s["sidebar_index"] for s in st.values())


def test_ledger_rows_go_to_the_running_area_session_only(raw_data):
    raw = copy.deepcopy(raw_data)
    raw["terminal"][2]["title"] = raw["terminal"][2]["custom_title"] = "AUTH_NOTES"       # WS-C also maps to auth
    owners = lambda r: by(build(r)["workpieces"], "id", "pr:253")["station_ids"]
    assert sorted(owners(copy.deepcopy(raw))) == ["WS-B", "WS-C"]                     # no area session running: title fallback
    raw["processes"] = [{**_proc(1, ws="WS-B"), "ledger_area": "auth"}, _proc(2, ws="WS-C")]
    assert owners(raw) == ["WS-B"]
