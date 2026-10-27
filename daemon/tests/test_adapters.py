import os
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from shufler import actions, adapters, config
from shufler.adapters import Adapters
from shufler.adapters.agent import ClaudeCodeAdapter
from shufler.adapters.review import ReviewerAdapter
from shufler.adapters.scm import GitHubAdapter
from shufler.adapters.terminal import CmuxAdapter
from shufler.collectors import Collectors

DAEMON = Path(__file__).resolve().parents[1]


def test_capabilities_reflect_fixture_config(snapshot):
    caps = snapshot["capabilities"]
    assert caps["product"] == config.PRODUCT_NAME == "Shufler"
    assert (caps["terminal"], caps["agent"], caps["scm"]) == ("cmux", "claude-code", "github")
    assert caps["reviewer"] and caps["reviewer_retrigger"] and caps["terminals"]
    assert caps["tracker"] == ["intake", "ledgers", "board"]
    assert caps["board_stages"] == ["backlog", "in_progress", "in_review", "done", "parked"]
    assert caps["owner_aliases"] == ["owner", "me"]
    assert caps["command_titles"] == ["CODEX", "CONTROL", "LEDGERS", "SHARED"]
    assert caps["terminal_presets"] == ["local_console", "preview_console", "prod_console", "shell_here"]


def test_example_config_parses_with_optional_adapters_off():
    env = {**os.environ, "SHUFLER_CONFIG": str(DAEMON / "config.example.toml")}
    code = "import json; from shufler import config; print(json.dumps(config.capabilities()))"
    out = subprocess.run([sys.executable, "-c", code], cwd=DAEMON, env=env, capture_output=True, text=True, check=True)
    import json
    caps = json.loads(out.stdout)
    assert caps["scm"] is None and caps["reviewer"] is False and caps["commands"] == []
    assert caps["tracker"] == [] and caps["terminal_presets"] == ["shell_here"] and caps["intake"] is False
    assert len(tomllib.loads((DAEMON / "config.example.toml").read_text())["domain"]) == 7


def test_example_config_has_no_machine_specific_values():
    text = (DAEMON / "config.example.toml").read_text()  # comments included
    for word in ("/Users/", "/home/", "claude-projects"):
        assert word not in text, word


def test_adapter_argv_builders():
    t = CmuxAdapter("cmux")
    assert t.focus_argv("W") == ["cmux", "select-workspace", "--workspace", "W"]
    assert t.send_text_argv("W", "surface:2", "hi")[-3:] == ["--surface", "surface:2", "hi"]
    assert t.first_terminal_surface('{"surfaces":[{"type":"browser","ref":"s:1"},{"type":"terminal","ref":"s:2"}]}') == "s:2"
    assert t.new_surface_ref("OK surface:42 pane:1") == "surface:42"
    g = GitHubAdapter("gh", "acme/widgets")
    assert g.ready_argv(7, undo=True) == ["gh", "pr", "ready", "7", "--undo", "--repo", "acme/widgets"]
    assert g.pr_url(7) == "https://github.com/acme/widgets/pull/7"
    assert g.deploy_runs() == []  # no deploy workflow configured: nothing to call
    assert g.comment_argv(7, "hi") == ["gh", "pr", "comment", "7", "--repo", "acme/widgets", "--body", "hi"]
    h = ReviewerAdapter("reviewbot")
    assert h.is_reviewer("ReviewBot[bot]") and not h.is_reviewer("someone")
    assert h.retrigger_argv(5) is None and h.status() == {} and h.command is None
    c = ReviewerAdapter("reviewbot", retrigger_comment="@reviewbot review #{pr}", scm=g)
    assert c.retrigger_argv(5) == ["gh", "pr", "comment", "5", "--repo", "acme/widgets", "--body", "@reviewbot review #5"]
    a = ReviewerAdapter("reviewbot", retrigger_argv=["rb", "again", "{pr}"])
    assert a.retrigger_argv(9) == ["rb", "again", "9"]


def _minimal():
    return Adapters(terminal=CmuxAdapter("cmux"), agent=ClaudeCodeAdapter({}, {}), scm=None, reviewer=None)


def test_actions_refuse_when_adapter_is_off(snapshot, monkeypatch):
    adapters.set_current(_minimal())
    try:
        for action, params, key in (
            ("merge", {"pr": "253"}, "scm.repo"),
            ("reviewer_retrigger", {"pr": "253"}, "reviewer.retrigger_command"),
            ("board_stage", {"card_id": "1", "stage": "done"}, "board.command"),
            ("issue_set", {"slug": "x", "key": "state", "value": "done"}, "intake.dir"),
        ):
            with pytest.raises(actions.ActionError, match=key.replace(".", r"\.")):
                actions.plan(action, params, snapshot)
        assert actions.plan("focus", {"station_id": "WS-A"}, snapshot).steps == [
            ["cmux", "select-workspace", "--workspace", "WS-A"]]
    finally:
        adapters.set_current(None)


def test_collectors_register_only_enabled_sources():
    full = set(Collectors().sources)
    assert {"intake", "ledgers", "board", "gh", "gh_detail", "deploys", "reviewer_watch", "ledger_branches"} <= full
    minimal = set(Collectors(_minimal()).sources)
    assert minimal == {"terminal", "groups", "notes", "processes", "transcripts", "accounts", "skills"}


def test_canned_prompts_shape():
    ex = tomllib.loads((DAEMON / "config.example.toml").read_text())
    canned = config._canned(ex["prompts"]["canned"])
    assert len(canned) == 14 and canned[0] == {
        "group": "PR flow", "label": "Status", "text": "What is the status of {pr}? Tell me what is left before it can merge."}
    assert {c["group"] for c in canned} == {"PR flow", "Post-merge", "Session", "QA", "Messages"}
    mixed = config._canned(["Short one", "x" * 40, {"group": "G", "label": "L", "text": "T"}, {"label": "no text"}, ""])
    assert [c["group"] for c in mixed] == ["Custom", "Custom", "G"]
    assert mixed[0]["label"] == "Short one" and mixed[1]["label"].endswith("…")
    assert config.CANNED_DISPATCH[0]["group"] == "Custom"  # fixture config still uses a plain string


def test_env_reads_only_the_shufler_prefix(monkeypatch, tmp_path):
    monkeypatch.delenv("SHUFLER_X_TEST", raising=False)
    monkeypatch.setenv("X_TEST", "bare")
    assert config.env("X_TEST", "dflt") == "dflt"
    monkeypatch.setenv("SHUFLER_X_TEST", "s")
    assert config.env("X_TEST") == "s"
    assert config.app_dir(tmp_path) == tmp_path / "shufler"


def test_board_adapter_templates_and_collect(monkeypatch):
    from shufler import runner
    from shufler.adapters.tracker import BoardAdapter
    from shufler.runner import RunResult
    b = BoardAdapter("board", ("todo", "done"), get_args=["card", "show", "{id}"], stage_args=["move", "{id}", "--to", "{stage}"],
                     note_args=["comment", "{id}", "{text}"], stage_pattern=r"column: (\w+)")
    assert b.stage_argv("c-1", "done") == ["board", "move", "c-1", "--to", "done"]
    assert b.note_argv("c-1", "hi") == ["board", "comment", "c-1", "hi"]
    calls = []
    monkeypatch.setattr(runner, "run", lambda argv, timeout=30: calls.append(argv) or RunResult(0, "column: Done\n", ""))
    recs = {"a": {"card_id": "c-1", "state": "open"}, "b": {"card_id": "x;y", "state": "open"},
            "c": {"card_id": "c-3", "state": "done"}}
    assert b.collect(recs) == {"c-1": "done"} and calls == [["board", "card", "show", "c-1"]]


def test_intake_reads_the_card_key(tmp_path):
    from shufler.adapters.tracker import IntakeAdapter
    (tmp_path / "x.json").write_text('{"slug": "x", "ticket": {"id": 42, "stage": "todo"}, "pr": {"number": 7}}')
    rec = IntakeAdapter(tmp_path, card_key="ticket").collect()["x"]
    assert (rec["card_id"], rec["card_stage"], rec["pr"]) == ("42", "todo", 7)
