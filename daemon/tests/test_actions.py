import json

import pytest

from shufler import actions, config
from shufler.actions import ActionError, plan, preview
from shufler.runner import RunResult

BIN = "/opt/shufler-test/bin"


@pytest.fixture(autouse=True)
def tmp_log(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "actions.jsonl")
    return tmp_path / "actions.jsonl"


# ---------------------------------------------------------------- previews

def test_focus_preview(snapshot):
    p = preview("focus", {"station_id": "WS-B"}, snapshot)
    assert p["command"] == f"{config.CMUX} select-workspace --workspace WS-B"


def test_dispatch_preview(snapshot):
    p = preview("dispatch", {"station_id": "WS-B", "text": "Status? One\nparagraph"}, snapshot)
    lines = p["command"].splitlines()
    assert lines[0].endswith("list-pane-surfaces --workspace WS-B --json")
    assert "send --workspace WS-B --surface '<first-terminal-surface>' 'Status? One paragraph'" in lines[1]
    assert lines[2].endswith("Return")
    assert "read-screen" in lines[3] and "--lines 20" in lines[3]
    assert any("newlines" in w for w in p["warnings"])
    assert any("active" in w for w in p["warnings"])


def test_pr_action_previews(snapshot):
    assert preview("reviewer_retrigger", {"pr": 253}, snapshot)["command"] == f"{BIN}/review-watch retrigger 253"
    assert preview("ci_rerun", {"pr": "260"}, snapshot)["command"] == "gh run rerun 777 --failed --repo acme/widgets"
    assert preview("pr_ready", {"pr": 260}, snapshot)["command"] == "gh pr ready 260 --repo acme/widgets"
    assert preview("pr_draft", {"pr": 260}, snapshot)["command"] == "gh pr ready 260 --undo --repo acme/widgets"
    assert preview("open_pr", {"pr": 171}, snapshot)["url"].endswith("/pull/171")
    assert preview("open_preview", {"pr": 253}, snapshot)["url"] == "https://pr-253.preview.example.test"


def test_merge_preview_shows_facts(snapshot):
    ok = preview("merge", {"pr": 253}, snapshot)
    assert ok["command"] == "gh pr merge 253 --repo acme/widgets --squash"
    assert ok["facts"]["ci"] == "success" and ok["facts"]["reviewer"] == "approved" and ok["facts"]["blocked"] == []
    assert ok["confirm"] == "typed" and ok["facts"]["reviewer_at_head"] is True
    bad = preview("merge", {"pr": 260}, snapshot)
    assert len(bad["facts"]["blocked"]) == 4  # CI, review bot, draft, conflicts


def test_other_previews(snapshot):
    assert preview("board_stage", {"card_id": "5383072", "stage": "in_review"}, snapshot)["command"] == f"{BIN}/board stage 5383072 in_review"
    assert preview("board_note", {"card_id": "abc-1", "text": "shipped"}, snapshot)["command"] == f"{BIN}/board note abc-1 shipped"
    assert preview("issue_set", {"slug": "support-queue", "key": "state", "value": "pr_open"}, snapshot)["command"] == f"{BIN}/intake set support-queue state=pr_open"


# ---------------------------------------------------------------- custom commands

def test_station_command_fills_inputs_and_env(snapshot):
    p = preview("run_command", {"command": "session_note", "station_id": "WS-B",
                                "values": {"state": "waiting", "text": "Sam testing #253"}}, snapshot)
    assert p["command"] == ("AGENT_SESSION_ID=bbbb2222-0000-0000-0000-000000000000 WORKSPACE_ID=WS-B "
                            f"{BIN}/session-label waiting 'Sam testing #253'")
    assert p["confirm"] == "tap" and p["facts"]["command_id"] == "session_note"


def test_global_command_flag_and_prod(snapshot):
    p = preview("run_command", {"command": "query", "values": {"text": "SELECT 1", "raw": True}}, snapshot)
    assert p["command"] == f"{BIN}/query --raw 'SELECT 1'"
    assert p["facts"]["prod"] is True and any(w.startswith("PROD") for w in p["warnings"])
    p = preview("run_command", {"command": "query", "values": {"text": "SELECT 1\nFROM t"}}, snapshot)
    assert p["command"] == f"{BIN}/query 'SELECT 1\nFROM t'"  # an unset flag drops its argument
    typed = preview("run_command", {"command": "log_note", "values": {"text": "hello"}}, snapshot)
    assert typed["confirm"] == "typed" and typed["facts"]["requires_typed_confirmation"] == "log_note"


def test_commands_are_public_without_argv(snapshot):
    cmds = {c["id"]: c for c in snapshot["capabilities"]["commands"]}
    assert set(cmds) == {"session_note", "query", "log_note"}
    assert "argv" not in cmds["query"] and "env" not in cmds["session_note"]
    assert cmds["session_note"]["scope"] == "station" and cmds["query"]["prod"] is True
    assert [i["type"] for i in cmds["query"]["inputs"]] == ["text", "flag"]


@pytest.mark.parametrize("action,params,msg", [
    ("focus", {"station_id": "nope"}, "unknown station"),
    ("dispatch", {"station_id": "WS-B", "text": "  "}, "required"),
    ("dispatch", {"station_id": "WS-B", "text": "x\x1b[2J"}, "control"),
    ("merge", {"pr": 99999}, "not one of your"),
    ("pr_ready", {"pr": 171}, "not one of your open"),
    ("pr_ready", {"pr": "abc"}, "must be a number"),
    ("ci_rerun", {"pr": 253}, "no failed check"),
    ("run_command", {"command": "session_note", "station_id": "WS-C", "values": {"state": "me", "text": "x"}},
     "no known agent session"),
    ("run_command", {"command": "session_note", "station_id": "WS-B", "values": {"state": "bogus", "text": "x"}},
     "must be one of"),
    ("run_command", {"command": "session_note", "station_id": "WS-B", "values": {"state": "me", "text": "x" * 81}},
     "longer than 80"),
    ("run_command", {"command": "session_note", "values": {"state": "me", "text": "x"}}, "unknown station"),
    ("run_command", {"command": "log_note", "values": {"text": "a\nb"}}, "one line"),
    ("run_command", {"command": "query", "values": {}}, "SQL is required"),
    ("run_command", {"command": "nope"}, "unknown command"),
    ("board_stage", {"card_id": "12; rm", "stage": "done"}, "card_id must be"),
    ("board_stage", {"card_id": "12", "stage": "won"}, "stage must be"),
    ("issue_set", {"slug": "../etc", "key": "state", "value": "x"}, "slug"),
    ("issue_set", {"slug": "support-queue", "key": "a b", "value": "x"}, "key"),
    ("rm_rf", {}, "unknown action"),
])
def test_plan_validation(snapshot, action, params, msg):
    with pytest.raises(ActionError) as e:
        plan(action, params, snapshot)
    assert msg in str(e.value)


# ---------------------------------------------------------------- execution (no real commands)

class Recorder:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = responses or {}

    def __call__(self, argv, timeout=30, env=None):
        self.calls.append({"argv": argv, "timeout": timeout, "env": env})
        for key, res in self.responses.items():
            if key in argv:
                return res
        return RunResult(0, "ok", "")


def test_merge_refused_without_typed_confirmation(snapshot, monkeypatch, tmp_log):
    rec = Recorder()
    monkeypatch.setattr(actions, "run", rec)
    r = actions.execute("merge", {"pr": 253, "typed_confirmation": "2225"}, snapshot)
    assert not r["ok"] and "typed confirmation" in r["error"] and rec.calls == []
    r = actions.execute("merge", {"pr": 260, "typed_confirmation": "260"}, snapshot)
    assert not r["ok"] and "CI is failure" in r["error"] and rec.calls == []
    r = actions.execute("merge", {"pr": 253, "typed_confirmation": "253"}, snapshot)
    assert r["ok"] and rec.calls[0]["argv"] == ["gh", "pr", "merge", "253", "--repo", "acme/widgets", "--squash"]
    logged = [json.loads(l) for l in tmp_log.read_text().splitlines()]
    assert [l["result"]["ok"] for l in logged] == [False, False, True]
    assert all({"ts", "action", "params", "result"} <= set(l) for l in logged)


RULE = "─" * 40
EMPTY_BOX = f"⏺ Done.\n{RULE}\n❯\xa0\n{RULE}\n  status line\n"
DRAFT_BOX = f"⏺ Done.\n{RULE}\n❯ half-typed thought about\n  the migration\n{RULE}\n  status line\n"
AFTER_BOX = f"❯ Status?\n⏺ Working…\n{RULE}\n❯\xa0\n{RULE}\n"


class ScreenRun:
    """Fake runner whose read-screen output changes once text has been sent."""

    def __init__(self, before):
        self.before, self.sent, self.calls = before, False, []
        self.surfaces = json.dumps({"surfaces": [{"ref": "surface:9", "type": "browser"}, {"ref": "surface:5", "type": "terminal"}]})

    def __call__(self, argv, timeout=30, env=None):
        self.calls.append({"argv": argv, "env": env or {}})
        verb = argv[1]
        if verb == "list-pane-surfaces":
            return RunResult(0, self.surfaces, "")
        if verb == "read-screen":
            return RunResult(0, AFTER_BOX if self.sent else self.before, "")
        if verb == "send":
            self.sent = True
        return RunResult(0, "", "")


def test_dispatch_execution_flow(snapshot, monkeypatch):
    rec = ScreenRun(EMPTY_BOX)
    monkeypatch.setattr(actions, "run", rec)
    monkeypatch.setattr(actions.time, "sleep", lambda s: None)
    r = actions.execute("dispatch", {"station_id": "WS-B", "text": "Status?"}, snapshot)
    assert r["ok"], r
    argvs = [c["argv"][1:] for c in rec.calls]
    assert [a[0] for a in argvs] == ["list-pane-surfaces", "read-screen", "send", "send-key", "read-screen"]
    assert argvs[2] == ["send", "--workspace", "WS-B", "--surface", "surface:5", "Status?"]
    assert argvs[3] == ["send-key", "--workspace", "WS-B", "--surface", "surface:5", "Return"]
    assert r["landed"] is True and r["echo"] == "❯ Status?"
    assert all("CMUX_SURFACE_ID" not in c["env"] for c in rec.calls)


def test_dispatch_refuses_when_input_has_a_draft(snapshot, monkeypatch):
    rec = ScreenRun(DRAFT_BOX)
    monkeypatch.setattr(actions, "run", rec)
    r = actions.execute("dispatch", {"station_id": "WS-B", "text": "Status?"}, snapshot)
    assert not r["ok"] and "unsent text" in r["error"]
    assert r["draft"] == "half-typed thought about the migration"
    assert not any(c["argv"][1] in ("send", "send-key") for c in rec.calls)


def test_dispatch_without_input_box_still_sends(snapshot, monkeypatch):
    rec = ScreenRun("$ plain shell prompt\n")
    monkeypatch.setattr(actions, "run", rec)
    monkeypatch.setattr(actions.time, "sleep", lambda s: None)
    r = actions.execute("run_skill", {"station_id": "WS-B", "skill": "pr-pre-review", "args": "253"}, snapshot)
    assert r["ok"] and "no Claude Code input box" in r["output"] and rec.sent


def test_input_draft_and_echo_parsers():
    from shufler.adapters.agent.claude_code import echo_line, input_draft
    assert input_draft(EMPTY_BOX) == ""
    assert input_draft(DRAFT_BOX) == "half-typed thought about the migration"
    assert input_draft("no box here") is None
    assert echo_line(AFTER_BOX, "Status?") == "❯ Status?"
    assert echo_line(EMPTY_BOX, "something else") is None


def test_dispatch_without_terminal_surface(snapshot, monkeypatch):
    rec = Recorder({"list-pane-surfaces": RunResult(0, '{"surfaces": []}', "")})
    monkeypatch.setattr(actions, "run", rec)
    r = actions.execute("dispatch", {"station_id": "WS-B", "text": "hi"}, snapshot)
    assert not r["ok"] and "no terminal surface" in r["error"] and len(rec.calls) == 1


def test_command_env_scrub_and_timeout(snapshot, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(actions, "run", rec)
    monkeypatch.setenv("CMUX_WORKSPACE_ID", "SOMEONE-ELSE")
    r = actions.execute("run_command", {"command": "session_note", "station_id": "WS-B",
                                        "values": {"state": "me", "text": "me: merge #253"}}, snapshot)
    assert r["ok"], r
    env = rec.calls[0]["env"]
    assert env["AGENT_SESSION_ID"] == "bbbb2222-0000-0000-0000-000000000000"
    assert env["WORKSPACE_ID"] == "WS-B" and "CMUX_WORKSPACE_ID" not in env
    actions.execute("run_command", {"command": "query", "values": {"text": "SELECT 1"}}, snapshot)
    assert rec.calls[1]["timeout"] == 15 and rec.calls[1]["argv"][-1] == "SELECT 1"
    r = actions.execute("run_command", {"command": "log_note", "values": {"text": "hi"}}, snapshot)
    assert not r["ok"] and "type log_note" in r["error"] and len(rec.calls) == 2


def test_failed_step_reports_error(snapshot, monkeypatch):
    rec = Recorder({"ready": RunResult(1, "", "GraphQL: not allowed")})
    monkeypatch.setattr(actions, "run", rec)
    r = actions.execute("pr_ready", {"pr": 260}, snapshot)
    assert not r["ok"] and "not allowed" in r["output"]


# ---------------------------------------------------------------- round 2

def test_confirm_levels(snapshot):
    assert preview("focus", {"station_id": "WS-B"}, snapshot)["confirm"] == "none"
    assert preview("open_pr", {"pr": 253}, snapshot)["confirm"] == "none"
    assert preview("run_command", {"command": "query", "values": {"text": "SELECT 1"}}, snapshot)["confirm"] == "tap"
    assert preview("reviewer_retrigger", {"pr": 253}, snapshot)["confirm"] == "tap"
    assert preview("board_note", {"card_id": "5", "text": "progress"}, snapshot)["confirm"] == "tap"


def test_postmerge_and_new_item(snapshot):
    import copy
    with pytest.raises(ActionError, match="not merged"):
        plan("postmerge", {"pr": 253}, snapshot)
    with pytest.raises(ActionError, match="no station"):
        plan("postmerge", {"pr": 171}, snapshot)
    snap = copy.deepcopy(snapshot)
    next(w for w in snap["workpieces"] if w["pr"] == 171)["station_id"] = "WS-A"
    p = preview("postmerge", {"pr": 171}, snap)
    assert "--workspace WS-A" in p["command"]
    assert p["facts"]["text"].startswith("#171 is merged and deploying.")
    with pytest.raises(ActionError, match="CONTROL"):
        plan("new_item", {"text": "https://example.test/t/1"}, snapshot)
    next(s for s in snap["stations"] if s["id"] == "WS-C")["title"] = "CONTROL"
    p = preview("new_item", {"text": "https://example.test/t/1"}, snap)
    assert "--workspace WS-C" in p["command"] and "'/intake https://example.test/t/1'" in p["command"]


def test_answer_question(snapshot):
    p = preview("answer_question", {"station_id": "WS-A", "text": "Narrow it."}, snapshot)
    assert p["facts"]["question"].startswith("Narrow the cache") and "'Narrow it.'" in p["command"]
    p = preview("answer_question", {"station_id": "WS-B", "text": "Yes"}, snapshot)
    assert any("no open question" in w for w in p["warnings"])


def test_board_note(snapshot):
    p = preview("board_note", {"card_id": "5383072", "text": "Fix merged, deploying"}, snapshot)
    assert p["command"] == f"{BIN}/board note 5383072 'Fix merged, deploying'"


@pytest.mark.parametrize("text", [
    "git reset --hard origin/main",
    "git push --force origin feature-x",
    "git push -f",
    "git push --force-with-lease",
    "git worktree remove ~/worktrees/widgets/feature-x",
    "pkill -f node",
    "run killall node",
    "kill -9 1234",
    "curl https://slack.com/api/chat.postMessage",
])
def test_never_do_guard_on_dispatch(snapshot, text):
    with pytest.raises(ActionError, match="never-do"):
        plan("dispatch", {"station_id": "WS-B", "text": text}, snapshot)


def test_never_do_guard_allows_normal_prompts(snapshot):
    for text in CANNED_TEXTS:
        plan("dispatch", {"station_id": "WS-B", "text": text}, snapshot)


def _example_canned():
    import tomllib
    from pathlib import Path
    ex = tomllib.loads((Path(__file__).resolve().parents[1] / "config.example.toml").read_text())
    return [c["text"].replace("{pr}", "#253").replace("{person}", "Priya").replace("{topic}", "the rollout")
            .replace("{url}", "https://example.test/t/1") for c in config._canned(ex["prompts"]["canned"])]


CANNED_TEXTS = [c["text"] for c in actions.CANNED_DISPATCH] + _example_canned() + [
    "Get #253 ready to merge. Resolve conflicts, address the review bot's requested changes, push, ask for a "
    "re-review, monitor to green CI and approved. Tell me when I can merge.",
    "I asked for a review of #253. Monitor it and fix any requested changes until approved and green CI.",
    "Give me a short message I can send to Priya about the fix. No opening line, no sign-off.",
]


def test_merge_requires_reviewer_at_head(snapshot, monkeypatch):
    import copy
    rec = Recorder()
    monkeypatch.setattr(actions, "run", rec)
    snap = copy.deepcopy(snapshot)
    next(w for w in snap["workpieces"] if w["pr"] == 253)["reviewer_at_head"] = False
    r = actions.execute("merge", {"pr": 253, "typed_confirmation": "253"}, snap)
    assert not r["ok"] and "older than the head commit" in r["error"] and rec.calls == []


def test_open_tab(snapshot, monkeypatch):
    p = preview("open_tab", {"station_id": "WS-B", "command": "./bin/console"}, snapshot)
    lines = p["command"].splitlines()
    assert lines[0].endswith("new-surface --type terminal --workspace WS-B --focus true")
    assert lines[1].endswith("send --workspace WS-B --surface '<new-surface>' ./bin/console")
    with pytest.raises(ActionError, match="never-do"):
        plan("open_tab", {"station_id": "WS-B", "command": "git reset --hard"}, snapshot)
    rec = Recorder({"new-surface": RunResult(0, "OK surface:42 pane:7", "")})
    monkeypatch.setattr(actions, "run", rec)
    r = actions.execute("open_tab", {"station_id": "WS-B", "command": "./bin/console"}, snapshot)
    assert r["ok"] and rec.calls[1]["argv"][1:] == ["send", "--workspace", "WS-B", "--surface", "surface:42", "./bin/console"]
    assert not any("Return" in c["argv"] for c in rec.calls)
