"""`[terminal] kind = "none"`: rows straight from running agent sessions, every terminal lever off and refused
cleanly, the capability flags in the snapshot, and `shufler setup`. No real `ps` or terminal is called here."""

import copy
import tomllib

import pytest

from shufler import actions, adapters, config, setup_cli
from shufler.adapters import Adapters
from shufler.adapters.agent import ClaudeCodeAdapter
from shufler.adapters.terminal import CAPABILITY_FLAGS, NoTerminalAdapter, build, caps_of
from shufler.collectors import Collectors
from shufler.snapshot import build_snapshot
from tests.conftest import NOW

A = "aaaa1111-0000-0000-0000-000000000000"
WT = "/Users/demo/worktrees/widgets/ft_billing_branch"


def _p(pid, tty, since, cwd=None, sid=None, name=None, harness="claude"):
    return {"pid": pid, "tty": tty, "etime_s": NOW - since, "since": since, "session_id": sid, "name": name,
            "harness": harness, "cwd": cwd, "workspace_id": None, "ledger_area": None}


PROCS = [
    _p(30, "ttys007", NOW - 50, cwd="/w/api"),
    _p(10, "ttys003", NOW - 900, cwd=WT, sid=A),
    _p(11, "ttys003", NOW - 60, cwd=WT),               # a second session on the same tty: same row
    _p(20, "ttys005", NOW - 400, cwd="/w/api", harness="codex"),
    _p(40, None, NOW - 30, name="nightly"),            # no tty: a row of its own, titled by --name
]


class Scanner:
    def __init__(self, procs=PROCS):
        self.procs, self.calls = procs, 0

    def __call__(self):
        self.calls += 1
        return copy.deepcopy(self.procs)


def test_rows_come_from_the_running_sessions():
    rows = NoTerminalAdapter(Scanner()).list_workspaces()
    assert [r["id"] for r in rows] == ["tty-ttys003", "tty-ttys005", "tty-ttys007", "pid-40"]  # oldest first
    assert [r["index"] for r in rows] == [0, 1, 2, 3]
    assert [r["title"] for r in rows] == ["ft_billing_branch", "api", "api.2", "nightly"]
    first = rows[0]
    assert first["ref"] == first["id"] and first["ttys"] == ["ttys003"] and first["current_directory"] == WT
    assert rows[3]["ttys"] == [] and not any(r["selected"] for r in rows)
    assert NoTerminalAdapter(Scanner()).list_groups() == []


def test_one_scan_serves_rows_and_processes():
    sc = Scanner()
    t = NoTerminalAdapter(sc)
    t.list_workspaces()
    procs = t.agent_processes()
    assert sc.calls == 1                                                   # within half a poll: cached
    assert {p["pid"]: p["workspace_id"] for p in procs} == {30: "tty-ttys007", 10: "tty-ttys003", 11: "tty-ttys003",
                                                             20: "tty-ttys005", 40: "pid-40"}
    t._at -= t.poll_interval
    t.agent_processes()
    assert sc.calls == 2


def test_snapshot_rows_keep_state_session_and_prs(raw_data):
    cmux_snap = build_snapshot(copy.deepcopy(raw_data), {}, NOW)
    want = next(s for s in cmux_snap["stations"] if s["session_id"] == A)
    t = NoTerminalAdapter(Scanner())
    raw = {**copy.deepcopy(raw_data), "terminal": t.list_workspaces(), "groups": [], "processes": t.agent_processes()}
    snap = build_snapshot(raw, {"none": {"ok": True, "age": 1.0}}, NOW)
    st = {s["id"]: s for s in snap["stations"]}
    a = st["tty-ttys003"]
    assert a["session_id"] == A and a["claude"]["running"] and a["claude"]["count"] == 2
    assert a["pr_numbers"] == want["pr_numbers"] and a["pending_question"] == want["pending_question"]
    assert a["harness"] == "claude" and st["tty-ttys005"]["harness"] == "codex"
    assert all(s["claude"]["running"] for s in snap["stations"])  # every row has its process
    assert snap["focused_station_id"] is None


def test_every_terminal_lever_is_refused_cleanly(snapshot):
    t = NoTerminalAdapter(Scanner())
    adapters.set_current(Adapters(terminal=t, agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None))
    try:
        for action, params in (("focus", {"station_id": "WS-A"}),
                               ("open_tab", {"station_id": "WS-A"}),
                               ("dispatch", {"station_id": "WS-A", "text": "hi"}),
                               ("answer_question", {"station_id": "WS-A", "text": "yes"}),
                               ("run_skill", {"station_id": "WS-A", "skill": "status"}),
                               ("library_send", {"station_id": "WS-A", "item_ids": "lib_1"}),
                               ("new_item", {"text": "x"}),
                               ("postmerge", {"pr": "171"})):
            with pytest.raises(actions.ActionError, match="no supported terminal is configured"):
                actions.plan(action, params, snapshot)
            r = actions.execute(action, params, snapshot)
            assert r["ok"] is False and "shufler setup" in r["error"], action
    finally:
        adapters.set_current(None)
    with pytest.raises(RuntimeError, match="cannot focus a session"):
        t.focus_argv("tty-ttys003")  # a builder called past the gate fails loudly, never runs anything
    assert caps_of(t) == {f: False for f in CAPABILITY_FLAGS}


def test_api_rejects_with_422_and_the_reason(snapshot, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from shufler.app import Hub, create_app
    from tests.test_api import GOOD, StubCollectors

    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "actions.jsonl")
    monkeypatch.setattr(config, "WEB_DIST", tmp_path / "dist")
    hub = Hub(StubCollectors())
    hub.snapshot = snapshot
    adapters.set_current(Adapters(terminal=NoTerminalAdapter(Scanner()), agent=ClaudeCodeAdapter({}, {}), scm=None,
                                  reviewer=None))
    try:
        with TestClient(create_app(hub, start_loop=False, testing=True)) as c:
            r = c.post("/api/actions", json={"action": "focus", "params": {"station_id": "WS-A"}}, headers=GOOD)
            assert r.status_code == 422 and "cannot focus a session" in r.json()["error"]
            r = c.get("/api/actions/preview", params={"action": "dispatch", "station_id": "WS-A", "text": "hi"})
            assert r.status_code == 400 and "cannot type into a session" in r.json()["error"]
    finally:
        adapters.set_current(None)


def test_collectors_share_the_scan_and_skip_the_screen_probe():
    t = NoTerminalAdapter(Scanner())
    c = Collectors(Adapters(terminal=t, agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None))
    assert c.sources["processes"].fn == t.agent_processes
    assert c.sources["processes"].interval == t.poll_interval
    assert "screens" not in c.sources
    assert "none" in c.health(NOW)


def test_capabilities_carry_the_terminal_flags(monkeypatch):
    assert config.capabilities()["terminal_caps"] == {f: True for f in CAPABILITY_FLAGS}  # the fixture's cmux
    monkeypatch.setattr(config, "TERMINAL_KIND", "none")
    caps = config.capabilities()
    assert caps["terminal"] == "none" and caps["terminal_caps"] == {f: False for f in CAPABILITY_FLAGS}
    assert isinstance(build("none", {}), NoTerminalAdapter)


def test_setup_can_pick_none(tmp_path, monkeypatch):
    from shufler.adapters.terminal import REGISTRY, Detection
    for kind in ("cmux", "iterm2", "tmux"):
        monkeypatch.setattr(REGISTRY[kind], "detect", classmethod(lambda cls, cfg=None: Detection(False, False, "x")))
    path = tmp_path / "config.toml"
    path.write_text('[terminal]\nkind = "cmux"\n')
    out = []
    assert setup_cli.setup(["--config", str(path), "--terminal", "none"], out=out.append) == 0
    assert tomllib.loads(path.read_text()) == {"terminal": {"kind": "none"}}
    assert any("4. none" in line and "detected" in line for line in out)  # nothing found: none is the detected one
    assert any("Focus and new tabs are off" in line for line in out)
