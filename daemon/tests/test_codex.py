"""Codex harness: rollout parsing, process matching, screen reading, the agent registry and the snapshot fields.
Fixtures are synthetic (tests/fixtures/codex); nothing here reads ~/.codex or runs a real terminal."""

import copy
import json
import shutil
import tomllib

import pytest

from shufler import actions, adapters, config, library, processes, runner, setup_cli
from shufler.adapters import Adapters
from shufler.adapters import agent as agents
from shufler.adapters.agent import ClaudeCodeAdapter, CodexAdapter
from shufler.adapters.agent import codex
from shufler.adapters.agent.codex import (CodexSession, CodexTranscriptIndex, answer_keys, input_draft, match_process,
                                          parse_approval_screen)
from shufler.adapters.terminal import CmuxAdapter, TmuxAdapter
from shufler.adapters.terminal.base import Detection
from shufler.collectors import ScreenProbe, Source
from shufler.conversation import history_summary, read_conversation, search_history
from shufler.processes import ProcessScanner, parse_ps
from shufler.runner import RunResult
from shufler.snapshot import build_snapshot
from shufler.transcripts import MultiIndex, TranscriptIndex
from tests.conftest import FIX, NOW
from tests.test_library import lib, tree  # noqa: F401 - fixtures
from tests.test_world import build, by

ROOT = FIX / "codex" / "sessions"
A = "cccc3333-0000-0000-0000-000000000000"   # finished turn, opened a PR
B = "dddd4444-0000-0000-0000-000000000000"   # waiting on an escalated command
LEGACY = "eeee5555-0000-0000-0000-000000000000"


def scan(wanted=()):
    idx = CodexTranscriptIndex({"codex": ROOT})
    return idx, idx.scan(set(wanted), now=NOW)


# ---------------------------------------------------------------- transcripts

def test_rollout_summary_is_metadata_only():
    idx, out = scan()
    s = out[A]
    assert s["harness"] == "codex" and s["account"] == "codex" and s["session_id"] == A
    assert s["cwd"] == "/Users/demo/gadgets" and s["model"] == "gpt-5.5-codex"
    assert s["turns"] == 1                                   # the environment context is not a prompt
    assert s["tool_calls"] == 3 and s["last_tool"] == "shell"
    assert s["pr_numbers"] == [254]                          # from `gh pr create` output
    assert (s["tokens_in_today"], s["tokens_out_today"]) == (3000, 250)  # token_usage_record repeats add nothing
    assert s["context_tokens"] == 2150 and s["context_window"] == 272000
    assert s["quota"]["five_hour_pct"] == 13.0 and s["compactions"] == 1
    assert s["last_assistant_preview"] == "Opened #254 with the retry and a test."
    assert s["in_turn"] is False and s["pending_question"] is None
    assert s["session_started_at"] == codex.parse_ts("2026-10-21T09:30:00Z")
    assert s["last_at"] == codex.parse_ts("2026-10-21T09:40:00Z")
    assert "PRIVATE" not in json.dumps(s)


def test_escalated_call_is_a_pending_approval_until_its_output():
    _, out = scan()
    q = out[B]["pending_question"]
    assert out[B]["in_turn"] and q["kind"] == "approval" and q["header"] == "Approval"
    assert "make migrate" in q["question"] and q["options"][0]["description"] == "Fetches the schema over the network"
    assert [o["key"] for o in q["options"]] == ["y", "a", "Escape"]
    st = CodexSession(B, "codex", "/x")
    for line in (ROOT / "2026/10/21").glob(f"*{B}.jsonl").__next__().read_text().splitlines():
        st.feed_line(line)
    assert st.pending_question
    st.feed_line('{"timestamp":"2026-10-21T09:56:00Z","type":"response_item","payload":'
                 '{"type":"function_call_output","call_id":"call_b1","output":"done"}}')
    assert st.pending_question is None


def test_never_policy_and_explicit_events():
    st = CodexSession("s", "codex", "/x")
    st.feed_record({"type": "turn_context", "payload": {"approval_policy": "never"}})
    st.feed_record({"type": "response_item", "payload": {"type": "function_call", "name": "shell", "call_id": "c",
                                                         "arguments": '{"command":["ls"],"with_escalated_permissions":true}'}})
    assert st.pending_question is None                       # nobody is asked under approval_policy = never
    st.feed_record({"type": "event_msg", "payload": {"type": "exec_approval_request", "call_id": "c2",
                                                     "command": ["bash", "-lc", "rm -rf build"], "reason": "clean"}})
    assert "rm -rf build" in st.pending_question["question"]
    st.feed_record({"type": "event_msg", "payload": {"type": "turn_aborted", "reason": "interrupted"}})
    assert st.pending_question is None
    st.feed_record({"type": "event_msg", "payload": {"type": "request_user_input", "call_id": "c3", "questions": [
        {"id": "q", "header": "Scope", "question": "Which module?", "options": [{"label": "api"}, {"label": "web"}]}]}})
    assert st.pending_question["kind"] == "input" and [o["label"] for o in st.pending_question["options"]] == ["api", "web"]


def test_partial_lines_and_unknown_records(tmp_path):
    day = tmp_path / "sessions" / "2026" / "10" / "21"
    day.mkdir(parents=True)
    f = day / f"rollout-2026-10-21T09-00-00-{A}.jsonl"
    meta = '{"timestamp":"2026-10-21T09:00:00Z","type":"session_meta","payload":{"id":"%s","cwd":"/w"}}\n' % A
    call = ('{"timestamp":"2026-10-21T09:00:05Z","type":"response_item","payload":{"type":"function_call",'
            '"name":"exec_command","arguments":"{\\"cmd\\":\\"ls\\"}","call_id":"c1"}}\n')
    f.write_text(meta + '{"type":"mystery","payload":{}}\n' + call[:50])
    idx = CodexTranscriptIndex({"codex": tmp_path / "sessions"})
    idx.scan({A}, now=NOW)
    assert idx.sessions[A].last_tool is None and idx.sessions[A].cwd == "/w"
    with open(f, "a") as fh:
        fh.write(call[50:])
    s = idx.scan({A}, now=NOW)[A]
    assert s["last_tool"] == "exec_command" and s["in_turn"]  # an open call counts as mid-turn


def test_large_rollout_is_read_from_its_tail(tmp_path, monkeypatch):
    day = tmp_path / "2026" / "10" / "21"
    day.mkdir(parents=True)
    src = next((ROOT / "2026/10/21").glob(f"*{A}.jsonl"))
    shutil.copy(src, day / src.name)
    monkeypatch.setattr(codex, "FIRST_READ_MAX", 1500)
    s = CodexTranscriptIndex({"codex": tmp_path}).scan({A}, now=NOW)[A]
    assert s["cwd"] == "/Users/demo/gadgets"                 # from the first line, read separately
    assert s["tokens_in_today"] < 3000                       # the first total in the tail is only a baseline
    assert s["last_assistant_preview"].startswith("Opened #254")


def test_old_rollouts_are_skipped_unless_wanted(tmp_path):
    import os
    src = ROOT / f"rollout-2025-05-02-{LEGACY}.json"
    shutil.copy(src, tmp_path / src.name)
    os.utime(tmp_path / src.name, (NOW - 400 * 86400, NOW - 400 * 86400))
    assert LEGACY not in CodexTranscriptIndex({"codex": tmp_path}).scan(set(), now=NOW)
    assert LEGACY in CodexTranscriptIndex({"codex": tmp_path}).scan({LEGACY}, now=NOW)
    assert LEGACY in CodexTranscriptIndex({"codex": tmp_path}).scan(set(), now=NOW, prefixes={"eeee5555"})


def test_legacy_json_session():
    idx, out = scan({LEGACY})
    s = out[LEGACY]
    assert s["turns"] == 1 and s["last_tool"] == "shell" and s["tool_calls"] == 1 and s["cwd"] is None
    convo = read_conversation(idx.sessions[LEGACY].path, 10)
    assert [t["role"] for t in convo["turns"]] == ["user", "assistant", "assistant"]


def test_multi_index_tags_every_summary():
    m = MultiIndex({"claude": TranscriptIndex({"personal": FIX / "projects"}), "codex": CodexTranscriptIndex({"codex": ROOT})})
    out = m.scan({"bbbb2222-0000-0000-0000-000000000000"}, now=NOW)
    assert out["bbbb2222-0000-0000-0000-000000000000"]["harness"] == "claude" and out[A]["harness"] == "codex"
    assert m.sessions[A].path.endswith(f"{A}.jsonl")


# ---------------------------------------------------------------- conversation panel

def test_conversation_turns_tools_and_results():
    path = next((ROOT / "2026/10/21").glob(f"*{A}.jsonl"))
    convo = read_conversation(path, 20, results=True)
    roles = [t["role"] for t in convo["turns"]]
    assert roles == ["user", "assistant", "assistant"] and not convo["has_more"]
    assert convo["turns"][0]["text"].startswith("Add a retry")
    tools = convo["turns"][1]["tools"]
    assert [(t["name"], t["summary"]) for t in tools] == [("shell", "rg -n retry src"), ("apply_patch", "src/sync.py"),
                                                          ("shell", "gh pr create --fill")]
    assert tools[0]["result"] == "src/sync.py:12: PRIVATE OUTPUT" and "pull/254" in tools[2]["result"]
    assert read_conversation(path, 20, pr=254)["filtered_by_pr"] is True
    hits = search_history(path, "retry")["results"]
    assert hits and hits[0]["role"] == "user"
    h = history_summary(path, A)
    assert h["turns"] == 1 and h["pr_links"][0]["pr"] == 254 and h["files_touched_count"] == 1 and len(h["compactions"]) == 1


# ---------------------------------------------------------------- processes

PS = (FIX / "ps_codex.txt").read_text()
MATCHERS = {"claude": processes.match_claude, "codex": match_process}


def test_parse_ps_codex_sessions():
    procs = {p["pid"]: p for p in parse_ps(PS, MATCHERS)}
    assert set(procs) == {71002, 71010, 71020, 71030, 71043, 71050}  # launcher 71001 folds into its child
    assert all(procs[p]["harness"] == "codex" for p in (71002, 71010, 71020, 71030, 71043))
    assert procs[71050]["harness"] == "claude" and procs[71002]["tty"] == "ttys030"
    assert procs[71010]["session_id"] == B and procs[71020]["cwd_arg"] == "/Users/demo/gadgets"
    assert procs[71043]["etime_s"] == 10                     # a lone launcher (child not listed yet) is kept


@pytest.mark.parametrize("line,expect", [
    ("codex", {"session_id": None}),
    ("codex resume --last", {"session_id": None}),
    ("codex fork " + B, {"session_id": None}),             # a fork is a new session
    ("codex exec fix it", None), ("codex e fix it", None), ("codex review", None), ("codex login", None),
    ("codex --profile work mcp", None), ("codex -c a=b exec x", None),
    ("bun /x/codex.js -s read-only", {"session_id": None}),
    ("codexx", None), ("node server.js", None), ("vim codex", None),
])
def test_match_process(line, expect):
    m = match_process(line.split())
    if expect is None:
        assert m is None
    else:
        assert m is not None and m["session_id"] == expect["session_id"]


def test_scanner_resolves_cwd_flag(monkeypatch):
    def fake(argv, timeout=30, env=None):
        if argv[:2] == ["ps", "-axww"]:
            return RunResult(0, "71020 ttys032 05:00 codex -C sub\n71021 ttys033 05:00 codex -C /abs\n", "")
        if argv[0] == "lsof":
            return RunResult(0, "p71020\nfcwd\nn/w/repo\np71021\nfcwd\nn/w/other\n", "")
        return RunResult(0, "71020 codex TMUX_PANE=%4\n", "")
    monkeypatch.setattr(runner, "run", fake)
    out = {p["pid"]: p for p in ProcessScanner(MATCHERS)()}
    assert out[71020]["cwd"] == "/w/repo/sub" and out[71021]["cwd"] == "/abs" and out[71020]["workspace_id"] == "%4"
    assert "cwd_arg" not in out[71020] and out[71020]["harness"] == "codex"


# ---------------------------------------------------------------- snapshot (contract: station.harness)

def _proc(pid, harness="codex", sid=None, cwd=None, ws=None, etime=100, tty="ttys001"):
    return {"pid": pid, "tty": tty, "etime_s": etime, "since": NOW - etime, "session_id": sid, "cwd": cwd,
            "workspace_id": ws, "harness": harness}


@pytest.fixture
def mixed(raw_data):
    """The fixture floor with the Codex rollouts added to its transcripts."""
    raw = copy.deepcopy(raw_data)
    _, cx = scan()
    raw["transcripts"] = {**raw["transcripts"], **cx}
    return raw


def test_every_station_has_a_harness(snapshot):
    assert all("harness" in s for s in snapshot["stations"])
    assert {s["harness"] for s in snapshot["stations"] if s["session_id"]} == {"claude"}


def test_codex_process_joins_its_own_rollout_by_cwd(mixed):
    raw = copy.deepcopy(mixed)
    raw["terminal"][2]["current_directory"] = "/Users/demo/gadgets"            # WS-C runs Codex in gadgets
    raw["processes"] = [_proc(1, cwd="/Users/demo/gadgets", ws="WS-C"),
                        _proc(2, harness="claude", ws="WS-A", sid="aaaa1111-0000-0000-0000-000000000000")]
    snap = build(raw)
    c, a = by(snap["stations"], "id", "WS-C"), by(snap["stations"], "id", "WS-A")
    assert c["harness"] == "codex" and c["session_id"] == A and c["claude"]["running"]
    assert c["telemetry"]["model"] == "gpt-5.5-codex" and c["telemetry"]["context_window"] == 272000
    assert c["telemetry"]["rate_limit"]["used_pct"] == 13.0 and c["telemetry"]["account_label"] is None
    assert a["harness"] == "claude"


def test_harnesses_never_take_each_others_transcripts(mixed):
    raw = copy.deepcopy(mixed)
    b_cwd = "/Users/demo/widgets"                           # Codex B and the Claude sessions share this cwd
    raw["transcripts"][B]["last_at"] = NOW - 30
    raw["processes"] = [_proc(1, harness="claude", cwd=b_cwd, ws="WS-B"), _proc(2, cwd=b_cwd, ws="WS-C")]
    snap = build(raw)
    b, c = by(snap["stations"], "id", "WS-B"), by(snap["stations"], "id", "WS-C")
    assert c["harness"] == "codex" and c["session_id"] == B
    assert b["harness"] == "claude" and b["session_id"] != B
    assert c["pending_question"]["kind"] == "approval"
    assert "question:WS-C" in {r["id"] for r in snap["your_move"]}


def test_codex_alone_drops_a_stale_claude_join(mixed):
    raw = copy.deepcopy(mixed)
    raw["processes"] = [_proc(1, cwd="/nowhere", ws="WS-B")]
    st = by(build(raw)["stations"], "id", "WS-B")
    assert st["harness"] == "codex" and st["session_id"] is None and st["claude"]["running"]


def test_screen_question_wins(mixed):
    raw = copy.deepcopy(mixed)
    raw["processes"] = [_proc(1, ws="WS-C", cwd="/nowhere")]
    raw["screens"] = {"WS-C": {**parse_approval_screen(APPROVAL_SCREEN), "session_id": None}}
    st = by(build_snapshot(raw, {}, NOW)["stations"], "id", "WS-C")
    assert st["pending_question"]["source"] == "screen" and "session_id" not in st["pending_question"]


# ---------------------------------------------------------------- screen

APPROVAL_SCREEN = """\
› Run the migrations
• I need to run the migration outside the sandbox.

  Would you like to run the following command?

  Reason: Fetches the schema over the network

  $ make migrate

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `make` (p)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
"""
COMPOSER = "• Done.\n\n› {}\n\n  gpt-5.5-codex high · ~/widgets\n"


def test_parse_approval_screen():
    q = parse_approval_screen(APPROVAL_SCREEN)
    assert q["question"] == "Would you like to run the following command? $ make migrate"
    assert [(o["label"][:12], o["key"]) for o in q["options"]] == [("Yes, proceed", "y"), ("Yes, and don", "p"),
                                                                   ("No, and tell", "Escape")]
    assert q["options"][0]["description"] == "Fetches the schema over the network" and q["kind"] == "approval"
    assert parse_approval_screen(COMPOSER.format("")) is None
    assert parse_approval_screen("Would you like to run the following command?\n  $ ls\n") is None  # no options yet


def test_codex_input_draft_and_answer_keys():
    assert input_draft(COMPOSER.format("Ask Codex to do anything")) == ""   # the stock placeholder
    assert input_draft(COMPOSER.format("")) == ""
    assert input_draft(COMPOSER.format("half typed")) == "half typed"
    assert input_draft(APPROVAL_SCREEN) is None and input_draft("$ zsh\n") is None
    q = parse_approval_screen(APPROVAL_SCREEN)
    assert answer_keys(q, "Yes, proceed") == [("text", "y")] and answer_keys(q, "2") == [("text", "p")]
    assert answer_keys(q, "No, and tell Codex what to do differently") == [("key", "Escape")]
    assert answer_keys(q, "use the staging db") == [("key", "Escape"), ("text", "use the staging db"), ("key", "Return")]
    assert answer_keys({"kind": "input", "options": []}, "api") is None and answer_keys(None, "x") is None


class ScreenRunner:
    def __init__(self, screen):
        self.screen, self.calls = screen, []

    def __call__(self, argv, timeout=30, env=None):
        self.calls.append(argv)
        if "list-panes" in argv:
            return RunResult(0, "%3\x1f1\n", "")
        if "capture-pane" in argv:
            return RunResult(0, self.screen, "")
        return RunResult(0, "", "")


def test_screen_probe_reads_only_quiet_mid_turn_codex_sessions(monkeypatch):
    term = TmuxAdapter()
    ad = Adapters(terminal=term, agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None,
                  agents={"claude": ClaudeCodeAdapter({}, {}), "codex": CodexAdapter(FIX / "codex")})
    _, cx = scan()
    src = lambda data: Source("x", 1, lambda: data, data=data)  # noqa: E731
    procs = [_proc(1, ws="%3", cwd="/Users/demo/widgets"), _proc(2, ws="%4", cwd="/Users/demo/gadgets"),
             _proc(3, harness="claude", ws="%5", cwd="/Users/demo/widgets")]
    terminal = [{"id": "%3"}, {"id": "%4"}, {"id": "%5"}]
    fake = ScreenRunner(APPROVAL_SCREEN)
    monkeypatch.setattr(runner, "run", fake)
    monkeypatch.setattr(term, "first_terminal_surface", lambda out: "%3")
    out = ScreenProbe(ad, src(procs), src(cx), src(terminal))()
    assert list(out) == ["%3"] and out["%3"]["session_id"] == B   # gadgets' turn is over; Claude is never probed
    assert out["%3"]["options"][0]["key"] == "y"
    assert sum(1 for c in fake.calls if "capture-pane" in c) == 1


# ---------------------------------------------------------------- actions

@pytest.fixture
def codex_floor(snapshot, monkeypatch):
    snap = copy.deepcopy(snapshot)
    st = by(snap["stations"], "id", "WS-B")
    st.update(harness="codex", pending_question=parse_approval_screen(APPROVAL_SCREEN))
    adapters.set_current(Adapters(terminal=CmuxAdapter("/c/cmux"), agent=ClaudeCodeAdapter({}, {}), scm=None,
                                  reviewer=None, agents={"claude": ClaudeCodeAdapter({}, {}),
                                                         "codex": CodexAdapter(FIX / "codex")}))
    yield snap
    adapters.set_current(None)


def test_answer_codex_approval_with_its_key(codex_floor, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "a.jsonl")
    p = actions.preview("answer_question", {"station_id": "WS-B", "text": "Yes, proceed"}, codex_floor)
    lines = p["command"].splitlines()
    assert lines[1] == "/c/cmux send --workspace WS-B --surface '<first-terminal-surface>' y"
    assert "send-key" not in p["command"] and any("keys" in w for w in p["warnings"])
    p = actions.preview("answer_question", {"station_id": "WS-B", "text": "run it against staging"}, codex_floor)
    assert [l.split()[1] for l in p["command"].splitlines()] == ["list-pane-surfaces", "send-key", "send", "send-key",
                                                                 "read-screen"]
    calls = []

    def fake(argv, timeout=30, env=None):
        calls.append(argv)
        if argv[1] == "list-pane-surfaces":
            return RunResult(0, json.dumps({"surfaces": [{"ref": "surface:5", "type": "terminal"}]}), "")
        return RunResult(0, "", "")
    monkeypatch.setattr(actions, "run", fake)
    monkeypatch.setattr(actions.time, "sleep", lambda s: None)
    r = actions.execute("answer_question", {"station_id": "WS-B", "text": "No, and tell Codex what to do differently"},
                        codex_floor)
    assert r["ok"] and [c[1] for c in calls] == ["list-pane-surfaces", "send-key", "read-screen"]
    assert calls[1][-1] == "Escape"


def test_dispatch_to_codex_uses_its_input_box(codex_floor, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "a.jsonl")
    monkeypatch.setattr(actions.time, "sleep", lambda s: None)
    sent = []

    def fake(argv, timeout=30, env=None):
        if argv[1] == "list-pane-surfaces":
            return RunResult(0, json.dumps({"surfaces": [{"ref": "surface:5", "type": "terminal"}]}), "")
        if argv[1] == "read-screen":
            return RunResult(0, COMPOSER.format(sent[-1] if sent else "fix the flaky test"), "")
        if argv[1] == "send":
            sent.append(argv[-1])
        return RunResult(0, "", "")
    monkeypatch.setattr(actions, "run", fake)
    r = actions.execute("dispatch", {"station_id": "WS-B", "text": "Status?"}, codex_floor)
    assert not r["ok"] and r["draft"] == "fix the flaky test" and not sent


# ---------------------------------------------------------------- library

def test_codex_message_format():
    items = [{"name": "Specs", "paths": ["/r/docs", "/shared/My Specs/a.md"]}]
    assert library.compose("codex", items, "/r") == [
        'Context from the library: Specs: /r/docs "/shared/My Specs/a.md". Read these before continuing.']
    assert not any(l.startswith("/add-dir") or "@" in l for l in library.compose("codex", items, "/elsewhere"))
    assert library.harness_for({"harness": "codex", "title": "BILLING"}) == "codex"
    assert library.harness_for({"harness": "claude", "title": "CODEX"}) == "claude-code"
    assert library.harness_for({"title": "codex review"}) == "codex"


def test_library_send_to_a_codex_station(lib, tree, snapshot):
    it = lib.upsert_item({"name": "Ctx", "paths": [str(tree / "repo" / "notes.md"), str(tree / "worktrees" / "wt1" / "docs")]})
    snap = copy.deepcopy(snapshot)
    st = by(snap["stations"], "id", "WS-B")
    st.update(harness="codex", cwd=str(tree / "repo"))
    p = actions.preview("library_send", {"station_id": "WS-B", "item_ids": it["id"]}, snap)
    assert p["facts"]["harness"] == "codex" and "/add-dir" not in p["facts"]["message"]
    assert str(tree / "repo" / "notes.md") in p["facts"]["message"] and p["command"].count("send-key") == 1


# ---------------------------------------------------------------- registry and config

def test_setting_parses_lists_and_auto(monkeypatch):
    monkeypatch.delenv("SHUFLER_AGENTS", raising=False)
    assert agents.setting({}) == "auto" and agents.setting({"agents": {"enabled": "auto"}}) == "auto"
    assert agents.setting({"agents": {"enabled": ["Claude", "codex"]}}) == ["claude", "codex"]
    monkeypatch.setenv("SHUFLER_AGENTS", "codex")
    assert agents.setting({"agents": {"enabled": ["claude"]}}) == ["codex"]


def test_enabled_auto_keeps_claude_and_adds_detected(monkeypatch):
    monkeypatch.delenv("SHUFLER_AGENTS", raising=False)
    monkeypatch.setattr(CodexAdapter, "detect", classmethod(lambda cls, cfg=None: Detection(False, False, "x")))
    assert agents.enabled({}, fresh=True) == ["claude"]                  # an existing config: unchanged
    monkeypatch.setattr(CodexAdapter, "detect", classmethod(lambda cls, cfg=None: Detection(True, False, "x")))
    assert agents.enabled({}, fresh=True) == ["claude", "codex"]
    assert agents.enabled({"agents": {"enabled": ["codex", "emacs"]}}) == ["codex"]   # unknown ids dropped


def test_entry_point_harness(monkeypatch):
    class EP:
        name, group = "aider", "shufler.agents"

        def load(self):
            return CodexAdapter
    monkeypatch.setattr(agents.importlib.metadata, "entry_points", lambda group=None: [EP()] if group == "shufler.agents" else [])
    assert "aider" in agents.registered() and agents.REGISTRY.keys() == {"claude", "codex"}


def test_adapters_route_by_harness():
    cl, cx = ClaudeCodeAdapter({}, {}), CodexAdapter(FIX / "codex")
    a = Adapters(terminal=CmuxAdapter("cmux"), agent=cl, scm=None, reviewer=None, agents={"claude": cl, "codex": cx})
    assert a.agent_for("codex") is cx and a.agent_for(None) is cl and a.agent_for("nope") is cl
    assert isinstance(a.transcript_index(), MultiIndex) and "codex" in a.accounts()
    solo = Adapters(terminal=CmuxAdapter("cmux"), agent=cl, scm=None, reviewer=None)
    assert isinstance(solo.transcript_index(), TranscriptIndex) and solo.all_agents() == {"claude": cl}
    built = adapters.from_config()
    assert set(built.agents) == {"claude", "codex"} and built.agent is built.agents["claude"]


def test_capabilities_list_agents(snapshot):
    assert snapshot["capabilities"]["agents"] == ["claude", "codex"]
    assert snapshot["capabilities"]["agent"] == "claude-code"           # unchanged


def test_setup_writes_agents_and_status_reports_them(tmp_path, monkeypatch):
    from shufler.adapters.terminal import REGISTRY
    for kind in REGISTRY:
        monkeypatch.setattr(REGISTRY[kind], "detect", classmethod(lambda cls, cfg=None: Detection(True, True, "x")))
    monkeypatch.setattr("shufler.adapters.terminal.base.find_bin", lambda *c: "/opt/cmux")
    path = tmp_path / "config.toml"
    path.write_text('[terminal]\nkind = "tmux"\n')
    out = []
    assert setup_cli.setup(["--config", str(path), "--yes", "--agents", "claude,codex"], out=out.append) == 0
    assert tomllib.loads(path.read_text())["agents"] == {"enabled": ["claude", "codex"]}
    assert any(l.startswith("Agent harnesses") for l in out) and any("codex" in l and "Codex" in l for l in out)
    assert setup_cli.setup(["--config", str(path), "--yes", "--agents", "codex,emacs"], out=out.append) == 2
    assert setup_cli.setup(["--config", str(path), "--yes", "--agents", "auto"], out=out.append) == 0
    assert tomllib.loads(path.read_text())["agents"]["enabled"] == "auto"
    out.clear()
    setup_cli.status([], out=out.append)
    assert any(l.startswith("agents: claude, codex") for l in out)
