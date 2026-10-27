"""iTerm2 and tmux adapters (subprocess mocked), the terminal registry, capability gating, tty process
mapping, the neutral snapshot path and `shufler setup`. No real terminal is ever called here."""

import copy
import tomllib

import pytest

from shufler import actions, adapters, runner, setup_cli
from shufler.adapters import Adapters
from shufler.adapters.agent import ClaudeCodeAdapter
from shufler.adapters.terminal import (
    REGISTRY, CmuxAdapter, Detection, ITerm2Adapter, TmuxAdapter, auto_kind, build, caps_of, registered,
)
from shufler.adapters.terminal import iterm2 as iterm2_mod
from shufler.adapters.terminal import tmux as tmux_mod
from shufler.collectors import Collectors
from shufler.processes import parse_env, parse_env_workspace
from shufler.runner import RunResult
from shufler.snapshot import build_snapshot
from tests.conftest import NOW

US = "\x1f"
A = "AAAAAAAA-1111-2222-3333-444444444444"
B = "BBBBBBBB-1111-2222-3333-444444444444"
C = "CCCCCCCC-1111-2222-3333-444444444444"
D = "DDDDDDDD-1111-2222-3333-444444444444"


def _line(wid, wname, tab, ttitle, pane, sid, name, tty, path, sel=False):
    return US.join(map(str, [wid, wname, tab, ttitle, pane, sid, name, tty, path, "true" if sel else "false"]))


# Window 90 is listed first (front-most) but was created after window 12: rows follow creation order.
ITERM_LIST = "\n".join([
    _line(90, "AUTH · login", 1, "AUTH · login", 1, D, "claude", "/dev/ttys009", "/w/auth", sel=True),
    _line(12, "main", 2, "PAY · refunds", 1, C, "", "/dev/ttys007", ""),
    _line(12, "main", 1, "AUTH · api", 1, A, "CONTROL", "/dev/ttys003", "/w/a"),
    _line(12, "main", 1, "AUTH · api", 2, B, "tests", "/dev/ttys004", "/w/b"),
]) + "\n"


def iterm_runner(calls, list_out=ITERM_LIST, list_rc=0, list_err=""):
    def fake(argv, timeout=30, env=None):
        calls.append(argv)
        if argv[0] == "osascript" and argv[2] == "list":
            return RunResult(list_rc, list_out if list_rc == 0 else "", list_err)
        if argv[0] == "osascript" and argv[2] == "ping":
            return RunResult(list_rc, "3\n" if list_rc == 0 else "", list_err)
        if argv[:2] == ["ps", "-axo"]:
            return RunResult(0, "  700 ttys007 Ss\n  701 ttys007 S+\n  800 ttys003 S+\n", "")
        if argv[0] == "lsof":
            return RunResult(0, "p701\nfcwd\nn/w/pay\n", "")
        return RunResult(0, "", "")
    return fake


# ---------------------------------------------------------------- iTerm2

def test_iterm2_rows_order_title_cwd_and_tty(monkeypatch):
    calls = []
    monkeypatch.setattr(runner, "run", iterm_runner(calls))
    a = ITerm2Adapter()
    ws = a.list_workspaces()
    assert [w["id"] for w in ws] == [A, B, C, D]              # window creation order, then tab, then pane
    assert [w["index"] for w in ws] == [0, 1, 2, 3]
    assert ws[0]["title"] == "CONTROL" and ws[2]["title"] == "PAY · refunds"  # session name, else tab title
    assert ws[0]["ttys"] == ["ttys003"] and ws[0]["current_directory"] == "/w/a"
    assert ws[2]["current_directory"] == "/w/pay"             # no path variable: foreground process cwd on its tty
    assert [w["selected"] for w in ws] == [False, False, False, True]
    assert all(w["ref"] == w["id"] for w in ws)
    lsofs = [c for c in calls if c[0] == "lsof"]
    assert lsofs == [["lsof", "-a", "-d", "cwd", "-Fn", "-p", "701"]]
    calls.clear()
    a.list_workspaces()
    assert not [c for c in calls if c[0] == "lsof"]           # cached per (tty, pid)


def test_iterm2_groups_by_window_and_by_tab_prefix(monkeypatch):
    monkeypatch.setattr(runner, "run", iterm_runner([], list_out=ITERM_LIST + _line(95, "main", 1, "x", 1,
                        "EEEEEEEE-1111-2222-3333-444444444444", "x", "/dev/ttys010", "/w") + "\n"))
    g = ITerm2Adapter().list_groups()
    assert [(x["name"], x["members"]) for x in g] == [
        ("main", [A, B, C]), ("AUTH · login", [D]), ("main (2)", ["EEEEEEEE-1111-2222-3333-444444444444"])]
    assert all(x["anchor"] is None and x["pinned"] is False for x in g)
    monkeypatch.setattr(runner, "run", iterm_runner([]))
    g = ITerm2Adapter(group_by="tab_prefix").list_groups()
    assert [(x["name"], x["members"]) for x in g] == [("AUTH", [A, B, D]), ("PAY", [C])]
    with pytest.raises(ValueError, match="group_by"):
        ITerm2Adapter(group_by="color")


def test_iterm2_argv_builders_and_parsers():
    a = ITerm2Adapter(osascript="osascript", script="/s/iterm2.applescript")
    assert a.focus_argv(A) == ["osascript", "/s/iterm2.applescript", "focus", A]
    assert a.list_surfaces_argv(A)[2:] == ["surface", A]
    assert a.send_text_argv(A, B, "hi there")[2:] == ["write", B, "hi there"]
    assert a.send_key_argv(A, B, "Return")[2:] == ["key", B, "13"]
    assert a.read_screen_argv(A, B, 20)[2:] == ["read", B, "20"]
    assert a.open_surface_argv(A)[2:] == ["open", A]
    assert a.first_terminal_surface(A.lower() + "\n") == A.lower() and a.first_terminal_surface("") is None
    assert a.new_surface_ref("") is None and a.new_surface_ref(f"{B}\n") == B
    with pytest.raises(ValueError, match="no key"):
        a.send_key_argv(A, B, "F13")
    assert iterm2_mod.SCRIPT.is_file()
    assert iterm2_mod.tab_prefix("AUTH · login", " · ") == "AUTH" and iterm2_mod.tab_prefix("plain", " · ") is None
    assert iterm2_mod.parse_ps_tty("  1 ttys001 Ss\n  2 ttys001 S+\n  3 ?? S+\n") == {"ttys001": 2}


def test_iterm2_permission_denied_is_reported(monkeypatch):
    err = "execution error: Not authorized to send Apple events to iTerm. (-1743)"
    monkeypatch.setattr(runner, "run", iterm_runner([], list_rc=1, list_err=err))
    a = ITerm2Adapter()
    with pytest.raises(RuntimeError, match="Automation permission denied"):
        a.list_workspaces()
    ok, detail = a.check()
    assert not ok and "Automation" in detail
    monkeypatch.setattr(runner, "run", iterm_runner([]))
    assert a.check() == (True, "3 windows, Automation permission granted")


# ---------------------------------------------------------------- tmux

def _pane(sid, sname, att, last, wid, widx, wname, wact, pid, pidx, pact, tty, path, ppid):
    return tmux_mod.SEP_OUT.join(map(str, [sid, sname, att, last, wid, widx, wname, wact, pid, pidx, pact, tty,
                                           path, ppid]))


TMUX_LIST = "\n".join([
    _pane("$1", "beta", 0, 0, "@5", 0, "main", 1, "%7", 0, 1, "/dev/ttys030", "/w/b", 300),
    _pane("$0", "alpha", 1, 50, "@1", 1, "logs", 0, "%2", 0, 1, "/dev/ttys021", "/w/logs", 201),
    _pane("$0", "alpha", 1, 50, "@0", 0, "editor", 1, "%1", 1, 1, "/dev/ttys020", "/w/a", 200),
    _pane("$0", "alpha", 1, 50, "@0", 0, "editor", 1, "%0", 0, 0, "/dev/ttys019", "/w/a", 199),
]) + "\n"


def tmux_runner(calls, out=TMUX_LIST):
    def fake(argv, timeout=30, env=None):
        calls.append(argv)
        if "list-panes" in argv:
            return RunResult(0, out, "")
        return RunResult(0, "", "")
    return fake


def test_tmux_rows_per_pane(monkeypatch):
    calls = []
    monkeypatch.setattr(runner, "run", tmux_runner(calls))
    a = TmuxAdapter(socket_name="og")
    ws = a.list_workspaces()
    assert calls[0][:4] == ["tmux", "-L", "og", "list-panes"]
    # session order as tmux lists them (beta first here), then window index, then pane index
    assert [w["id"] for w in ws] == ["%7", "%0", "%1", "%2"]
    assert [w["title"] for w in ws] == ["main", "editor.0", "editor.1", "logs"]
    assert ws[1]["ttys"] == ["ttys019"] and ws[1]["current_directory"] == "/w/a"
    assert [w["selected"] for w in ws] == [False, False, True, False]   # attached session, active window and pane
    g = a.list_groups()
    assert [(x["name"], x["members"]) for x in g] == [("beta", ["%7"]), ("alpha", ["%0", "%1", "%2"])]


def test_tmux_rows_per_window(monkeypatch):
    monkeypatch.setattr(runner, "run", tmux_runner([]))
    ws = TmuxAdapter(rows="window", socket_path="/tmp/t.sock").list_workspaces()
    assert [(w["id"], w["title"], w["ttys"]) for w in ws] == [
        ("@5", "main", ["ttys030"]), ("@0", "editor", ["ttys019", "ttys020"]), ("@1", "logs", ["ttys021"])]
    assert [w["selected"] for w in ws] == [False, True, False]
    with pytest.raises(ValueError, match="rows"):
        TmuxAdapter(rows="session")


def test_tmux_parses_unescaped_separator_too():
    raw = TMUX_LIST.replace(tmux_mod.SEP_OUT, "\x1f")
    assert [p["pane_id"] for p in tmux_mod.parse_panes(raw)] == ["%7", "%0", "%1", "%2"]


def test_tmux_argv_builders():
    a = TmuxAdapter(socket_name="og")
    assert a.focus_argv("%3") == ["tmux", "-L", "og", "select-window", "-t", "%3", ";", "select-pane", "-t", "%3"]
    assert a.list_surfaces_argv("@1") == ["tmux", "-L", "og", "display-message", "-p", "-t", "@1", "#{pane_id}"]
    assert a.send_text_argv("%3", "%3", "-x hi") == ["tmux", "-L", "og", "send-keys", "-t", "%3", "-l", "--", "-x hi"]
    assert a.send_key_argv("%3", "%3", "Return")[-1] == "Enter"
    assert a.read_screen_argv("%3", "%3", 20)[-2:] == ["-S", "-20"]
    assert a.open_surface_argv("%3")[3:6] == ["split-window", "-t", "%3"]
    assert a.first_terminal_surface("%12\n") == "%12" and a.new_surface_ref("nope") is None
    assert TmuxAdapter(socket_path="/s").server == ["-S", "/s"] and TmuxAdapter().server == []


# ---------------------------------------------------------------- registry and config

def test_registry_lists_every_adapter_with_the_contract():
    reg = registered()
    assert list(REGISTRY) == ["cmux", "iterm2", "tmux"] and set(REGISTRY) <= set(reg)
    for kind, cls in REGISTRY.items():
        assert cls.name == kind and cls.label and isinstance(cls.CONFIG_DEFAULTS, dict)
        assert callable(cls.detect) and callable(cls.from_config)
        for m in ("list_workspaces", "list_groups", "focus_argv", "list_surfaces_argv", "send_text_argv",
                  "send_key_argv", "read_screen_argv", "open_surface_argv", "first_terminal_surface",
                  "new_surface_ref", "check"):
            assert callable(getattr(cls, m)), (kind, m)


def test_registry_reads_the_entry_point_group(monkeypatch):
    import importlib.metadata as md

    class EP:
        def __init__(self, name, cls):
            self.name, self._cls = name, cls

        def load(self):
            return self._cls

    class New: ...
    class Old: ...
    class OldDup: ...
    groups = {"shufler.terminals": [EP("wez", New), EP("kitty", Old), EP("cmux", OldDup)]}
    seen = []
    monkeypatch.setattr(md, "entry_points", lambda group: seen.append(group) or groups.get(group, []))
    reg = registered()
    assert seen == ["shufler.terminals"]
    assert reg["wez"] is New and reg["kitty"] is Old and reg["cmux"] is CmuxAdapter


def test_build_from_config_sections():
    cfg = {"terminal": {"kind": "iterm2"}, "iterm2": {"group_by": "tab_prefix", "prefix_separator": " / "},
           "tmux": {"socket_name": "w", "rows": "window"}, "cmux": {"bin": "/x/cmux"}}
    it = build("iterm2", cfg)
    assert isinstance(it, ITerm2Adapter) and it.group_by == "tab_prefix" and it.sep == " / "
    tm = build("tmux", cfg)
    assert tm.server == ["-L", "w"] and tm.rows == "window"
    assert build("cmux", cfg).bin == "/x/cmux"
    with pytest.raises(ValueError, match="unknown terminal kind"):
        build("wezterm", cfg)


def test_auto_detect_prefers_running_then_installed(monkeypatch):
    def fake(states):
        for kind, (inst, run) in states.items():
            monkeypatch.setattr(REGISTRY[kind], "detect", classmethod(lambda cls, cfg=None, i=inst, r=run: Detection(i, r)))
    fake({"cmux": (True, False), "iterm2": (True, True), "tmux": (True, True)})
    assert auto_kind({}) == "iterm2"
    fake({"cmux": (True, True), "iterm2": (True, True), "tmux": (False, False)})
    assert auto_kind({}) == "cmux"
    fake({"cmux": (False, False), "iterm2": (False, False), "tmux": (True, False)})
    assert auto_kind({}) == "tmux"
    fake({"cmux": (False, False), "iterm2": (False, False), "tmux": (False, False)})
    assert auto_kind({}) == "cmux"


# ---------------------------------------------------------------- capability gating and health

class NoSendTerminal(CmuxAdapter):
    name, label = "readonly", "ReadOnlyTerm"
    caps = {"can_send": False, "can_focus": False, "can_read_screen": True, "can_open": False, "has_groups": False}


def test_actions_refuse_levers_the_terminal_lacks(snapshot):
    adapters.set_current(Adapters(terminal=NoSendTerminal("cmux"), agent=ClaudeCodeAdapter({}, {}), scm=None,
                                  reviewer=None))
    try:
        for action, params, what in (("dispatch", {"station_id": "WS-A", "text": "hi"}, "type into a session"),
                                     ("focus", {"station_id": "WS-A"}, "focus a session"),
                                     ("open_tab", {"station_id": "WS-A"}, "open a new tab")):
            with pytest.raises(actions.ActionError, match=f"ReadOnlyTerm adapter cannot {what}"):
                actions.plan(action, params, snapshot)
        r = actions.execute("dispatch", {"station_id": "WS-A", "text": "hi"}, snapshot)
        assert not r["ok"] and "cannot type" in r["error"]
    finally:
        adapters.set_current(None)
    assert caps_of(object()) == {f: True for f in caps_of(NoSendTerminal("x"))}  # undeclared flags count as on


def test_iterm2_dispatch_plan_and_unsent_text_wording(snapshot, monkeypatch):
    adapters.set_current(Adapters(terminal=ITerm2Adapter(script="/s/it.applescript"), agent=ClaudeCodeAdapter({}, {}),
                                  scm=None, reviewer=None))
    try:
        p = actions.preview("dispatch", {"station_id": "WS-B", "text": "status"}, snapshot)
        assert p["command"].splitlines()[0] == "osascript /s/it.applescript surface WS-B"
        assert "key '<first-terminal-surface>' 13" in p["command"]

        def fake(argv, timeout=30, env=None):
            if argv[2] == "surface":
                return RunResult(0, A + "\n", "")
            if argv[2] == "read":
                from tests.test_actions import DRAFT_BOX
                return RunResult(0, DRAFT_BOX, "")
            return RunResult(0, "", "")
        monkeypatch.setattr(actions, "run", fake)
        r = actions.execute("dispatch", {"station_id": "WS-B", "text": "status"}, snapshot)
        assert r["error"] == "that session has unsent text in its input; finish or clear it in iTerm2 first"
    finally:
        adapters.set_current(None)


def test_health_reports_the_terminal_source_under_the_adapter_name():
    c = Collectors(Adapters(terminal=ITerm2Adapter(), agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None))
    assert "terminal" in c.sources and c.sources["terminal"].interval == ITerm2Adapter.poll_interval
    h = c.health(NOW)
    assert "iterm2" in h and "terminal" not in h


# ---------------------------------------------------------------- processes by tty and env

def test_parse_env_reads_iterm2_and_tmux_ids():
    env = (f"  7 claude ITERM_SESSION_ID=w0t1p0:{A.lower()} X=1\n"
           "  8 claude TMUX=/tmp/x,1,0 TMUX_PANE=%12 Y=2\n"
           f"  9 claude CMUX_WORKSPACE_ID={B} ITERM_SESSION_ID=w0t0p0:{C}\n")
    assert parse_env_workspace(env) == {7: A, 8: "%12", 9: B}       # cmux id wins when both are present
    assert parse_env(env)[8]["ledger_area"] is None


def _iterm_raw(raw_data, monkeypatch):
    monkeypatch.setattr(runner, "run", iterm_runner([]))
    a = ITerm2Adapter()
    raw = copy.deepcopy(raw_data)
    raw["terminal"], raw["groups"] = a.list_workspaces(), a.list_groups()
    return raw


def _proc(pid, tty, ws=None, sid=None, cwd=None):
    return {"pid": pid, "tty": tty, "etime_s": 100, "since": NOW - 100, "session_id": sid, "cwd": cwd,
            "workspace_id": ws, "name": None}


def test_neutral_snapshot_from_iterm2_rows_halls_and_tty_mapping(raw_data, monkeypatch):
    raw = _iterm_raw(raw_data, monkeypatch)
    raw["processes"] = [
        _proc(1, "ttys004"),                            # by tty → B
        _proc(2, "ttys099", ws=D),                      # by ITERM_SESSION_ID env → D, tty unknown to iTerm2
        _proc(3, "ttys555", cwd="/w/pay"),              # tty that no iTerm2 session owns: another terminal's
    ]
    snap = build_snapshot(raw, {"iterm2": {"ok": True, "age": 1}}, NOW)
    st = {s["id"]: s for s in snap["stations"]}
    assert [s["id"] for s in sorted(snap["stations"], key=lambda s: s["row_order"])] == [A, B, C, D]
    assert st[A]["hall_id"] == "main" and st[D]["hall_id"] == "AUTH · login"
    assert [(g["name"], g["index"]) for g in snap["groups"]] == [("main", 0), ("AUTH · login", 1)]
    assert st[B]["claude"]["running"] and st[B]["claude"]["pid"] == 1
    assert st[D]["claude"]["pid"] == 2
    assert not st[C]["claude"]["running"] and not st[A]["claude"]["running"]
    assert snap["focused_station_id"] == D                    # the selected iTerm2 session drives Follow


def test_cmux_snapshot_unchanged_without_ttys(raw_data):
    """cmux reports no ttys, so a process tty never filters or maps there (the old behaviour)."""
    raw = copy.deepcopy(raw_data)
    assert all(not w.get("ttys") for w in raw["terminal"])
    raw["processes"] = [_proc(1, "ttys001", ws="ws-a")]
    st = {s["id"]: s for s in build_snapshot(raw, {}, NOW)["stations"]}
    assert st["WS-A"]["claude"]["running"]


# ---------------------------------------------------------------- setup

def _answers(*xs):
    it = iter(xs)
    return lambda prompt="": next(it)


@pytest.fixture
def no_detect(monkeypatch):
    for kind, (inst, run) in {"cmux": (True, True), "iterm2": (True, True), "tmux": (False, False)}.items():
        monkeypatch.setattr(REGISTRY[kind], "detect", classmethod(lambda cls, cfg=None, i=inst, r=run: Detection(i, r, "x")))
    monkeypatch.setattr("shufler.adapters.terminal.base.find_bin", lambda *c: "/opt/cmux")


def test_setup_non_interactive_creates_and_rewrites_config(tmp_path, no_detect, monkeypatch):
    monkeypatch.setenv("SHUFLER_CONFIG", str(tmp_path / "unused.toml"))
    path = tmp_path / "config.toml"
    out = []
    assert setup_cli.setup(["--config", str(path), "--yes"], out=out.append) == 0
    cfg = tomllib.loads(path.read_text())
    assert cfg["terminal"]["kind"] == "cmux"                                         # created from the example
    assert cfg["cmux"]["bin"] == "/Applications/cmux.app/Contents/Resources/bin/cmux"  # the example's value kept
    assert "command_titles" in cfg["terminal"]                                       # rest of the example kept
    assert setup_cli.setup(["--config", str(path), "--terminal", "tmux", "--set", "rows=window"], out=out.append) == 0
    cfg = tomllib.loads(path.read_text())
    assert cfg["terminal"]["kind"] == "tmux" and cfg["tmux"]["rows"] == "window"
    assert setup_cli.setup(["--config", str(path), "--terminal", "tmux", "--set", "rows=session"], out=out.append) == 2
    assert setup_cli.setup(["--config", str(path), "--terminal", "nope"], out=out.append) == 2
    assert any("current" in line and "tmux" in line for line in out)


def test_setup_interactive_shows_current_and_changes_it(tmp_path, no_detect):
    path = tmp_path / "config.toml"
    path.write_text('[terminal]\nkind = "cmux"\n')
    out = []
    assert setup_cli.setup(["--config", str(path)], inp=_answers("2", "tab_prefix", ""), out=out.append) == 0
    cfg = tomllib.loads(path.read_text())
    assert cfg["terminal"] == {"kind": "iterm2"}
    assert cfg["iterm2"] == {"group_by": "tab_prefix", "prefix_separator": " · "}
    assert any("1. cmux" in line and "current" in line for line in out)
    # re-run: Enter keeps everything
    assert setup_cli.setup(["--config", str(path)], inp=_answers("", "", ""), out=out.append) == 0
    assert tomllib.loads(path.read_text())["iterm2"]["group_by"] == "tab_prefix"
