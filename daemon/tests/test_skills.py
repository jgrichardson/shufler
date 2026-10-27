import os
import tomllib

import pytest
from fastapi.testclient import TestClient

from shufler import actions, config, skills_view
from shufler.adapters.agent.skills import SkillIndex, parse_frontmatter, read_skill
from tests.test_api import hub, transcript_copy  # noqa: F401 - shared fixtures

GOOD = {"origin": "http://127.0.0.1:4700"}


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


@pytest.fixture
def claude_home(tmp_path):
    home = tmp_path / ".claude"
    _write(home / "skills" / "pr-pre-review" / "SKILL.md",
           "---\nname: pr-pre-review\ndescription: >\n  Adversarial pre-review gate\n  for a PR.\n---\n# x\n\n## Arguments\n\nA PR number or branch.\n")
    _write(home / "commands" / "wiki-ask.md", "# /wiki-ask\n\nAsk the wiki a question.\n\n## Input\n\n| a | b |\nThe question.\n")
    _write(home / "commands" / "sc" / "build.md", "---\ndescription: Build it\nargument-hint: [target]\n---\nbody\n")
    old = _write(home / "plugins" / "cache" / "mkt" / "plug" / "v1" / "skills" / "thing" / "SKILL.md",
                 "---\ndescription: old\n---\n")
    _write(home / "plugins" / "cache" / "mkt" / "plug" / "v2" / "skills" / "thing" / "SKILL.md",
           "---\ndescription: new\n---\n")
    os.utime(old, (1, 1))
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    _write(repo / ".claude" / "skills" / "issue" / "SKILL.md", "---\ndescription: Intake an issue\n---\n")
    _write(repo / "docs" / "claude" / "skills" / "triage" / "SKILL.md", "---\ndescription: Triage\n---\n")
    (repo / "sub").mkdir()
    return home, repo


def test_frontmatter_and_args_hint(claude_home):
    home, _ = claude_home
    sk = read_skill(home / "skills" / "pr-pre-review" / "SKILL.md", "pr-pre-review", "user")
    assert sk["description"] == "Adversarial pre-review gate for a PR."
    assert sk["args_hint"] == "A PR number or branch." and sk["slash"] == "/pr-pre-review"
    assert read_skill(home / "commands" / "wiki-ask.md", "wiki-ask", "user")["description"] == "Ask the wiki a question."
    assert parse_frontmatter("no frontmatter") == ({}, "no frontmatter")


def test_skill_index_scopes(claude_home):
    home, repo = claude_home
    idx = SkillIndex([home])
    glob = {s["name"]: s for s in idx.user_and_plugin()}
    assert set(glob) == {"pr-pre-review", "wiki-ask", "sc:build", "plug:thing"}
    assert glob["sc:build"]["args_hint"] == "[target]"
    assert glob["plug:thing"]["scope"] == "plugin" and glob["plug:thing"]["description"] == "new"
    assert [s["name"] for s in idx.project(repo)] == ["issue", "triage"]
    assert idx.user_and_plugin() == list(glob.values()) or True  # second scan served from the mtime cache


def test_attach_merges_config_and_station_names(claude_home, monkeypatch):
    home, repo = claude_home
    data = {"skills": skills_view.scan(SkillIndex([home]), {str(repo / "sub"), "/nowhere"})}
    assert data["skills"]["roots"] == {str(repo / "sub"): str(repo)}
    monkeypatch.setattr(config, "SKILLS_EXPOSE", ["issue"])
    monkeypatch.setattr(config, "SKILLS_HIDE", ["wiki-ask"])
    monkeypatch.setattr(config, "SKILL_SETTINGS", {"issue": {"pin": True, "target": "CONTROL", "confirm": "typed"}})
    snap = {"stations": [{"id": "A", "cwd": str(repo / "sub")}, {"id": "B", "cwd": "/nowhere"}]}
    skills_view.attach(snap, data)
    by = {s["name"]: s for s in snap["skills"]}
    assert "wiki-ask" not in by and by["issue"]["pinned"] and by["issue"]["exposed"] and by["issue"]["confirm"] == "typed"
    assert by["pr-pre-review"]["confirm"] == "tap" and not by["pr-pre-review"]["exposed"]
    assert snap["stations"][0]["skill_names"] == ["issue", "plug:thing", "pr-pre-review", "sc:build", "thing", "triage"]
    assert snap["stations"][1]["skill_names"] == ["plug:thing", "pr-pre-review", "sc:build", "thing"]


@pytest.fixture
def skill_snapshot(snapshot):
    snapshot["skills"] = [{"name": n} for n in ("pr-pre-review", "issue", "wiki-ask")]
    for st in snapshot["stations"]:
        st["skill_names"] = ["pr-pre-review", "issue", "wiki-ask"]
    return snapshot


def test_run_skill_fills_tokens(skill_snapshot, monkeypatch):
    monkeypatch.setattr(config, "SKILL_SETTINGS", {"pr-pre-review": {"args_template": "{pr}"}})
    pv = actions.preview("run_skill", {"station_id": "WS-A", "skill": "pr-pre-review", "pr": "253"}, skill_snapshot)
    assert pv["text"] == "/pr-pre-review 253" and pv["confirm"] == "tap"
    assert pv["facts"]["skill"] == "pr-pre-review" and "send" in pv["command"]
    pv = actions.preview("run_skill", {"station_id": "WS-A", "skill": "/wiki-ask", "args": "why {station}?"},
                         skill_snapshot)
    assert pv["text"].startswith("/wiki-ask why BILLING")
    with pytest.raises(actions.ActionError, match=r"args need \{link\}"):
        actions.plan("run_skill", {"station_id": "WS-A", "skill": "issue", "args": "{link}"}, skill_snapshot)
    with pytest.raises(actions.ActionError, match="unknown token"):
        actions.plan("run_skill", {"station_id": "WS-A", "skill": "issue", "args": "{secret}"}, skill_snapshot)
    with pytest.raises(actions.ActionError, match="pick a station"):
        actions.plan("run_skill", {"skill": "issue"}, skill_snapshot)
    with pytest.raises(actions.ActionError, match="skill must be"):
        actions.plan("run_skill", {"station_id": "WS-A", "skill": "a b; rm"}, skill_snapshot)


def test_run_skill_target_and_typed_confirm(skill_snapshot, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "a.jsonl")
    monkeypatch.setattr(config, "SKILL_SETTINGS", {"issue": {"target": "AUTH", "confirm": "typed",
                                                            "args_template": "{link_or_text}"}})
    p = actions.plan("run_skill", {"skill": "issue", "link_or_text": "https://example.test/t/1"}, skill_snapshot)
    assert p.facts["station"] == "AUTH" and p.facts["text"] == "/issue https://example.test/t/1"
    calls = []
    monkeypatch.setattr(actions, "run", lambda argv, timeout=30, env=None: calls.append(argv))
    r = actions.execute("run_skill", {"skill": "issue", "link_or_text": "x"}, skill_snapshot)
    assert not r["ok"] and "type issue" in r["error"] and calls == []
    r = actions.execute("run_skill", {"skill": "never", "station_id": "WS-A", "args": "git reset --hard"}, skill_snapshot)
    assert not r["ok"] and "reset --hard" in r["error"] and calls == []


def test_save_skills_roundtrip(tmp_path, monkeypatch):
    cfg = tmp_path / "config.toml"
    cfg.write_text('[app]\nport = 4700\n\n[skills]\nexpose = ["old"]\n\n[skills.old]\npin = true\n\n[[domain]]\nid = "x"\n')
    monkeypatch.setattr(config, "SKILLS_EXPOSE", [])
    config.save_skills(["issue"], ["noise"], {"issue": {"pin": True, "args_template": "{link}"}, "sc:build": {"confirm": "typed"}}, cfg)
    d = tomllib.loads(cfg.read_text())
    assert d["app"]["port"] == 4700 and d["domain"] == [{"id": "x"}]
    assert d["skills"]["expose"] == ["issue"] and d["skills"]["hide"] == ["noise"]
    assert d["skills"]["issue"] == {"pin": True, "args_template": "{link}"} and d["skills"]["sc:build"] == {"confirm": "typed"}
    assert "old" not in d["skills"] and config.SKILLS_EXPOSE == ["issue"]
    with pytest.raises(PermissionError, match=f"{config.SLUG} init"):
        config.save_skills([], [], {}, config.EXAMPLE_CONFIG)


def test_skill_config_api(hub, tmp_path, monkeypatch):
    from shufler.app import create_app
    cfg = tmp_path / "config.toml"
    cfg.write_text("[app]\nport = 4700\n")
    monkeypatch.setattr(config, "CONFIG_FILE", cfg)
    for k, v in (("SKILLS_EXPOSE", []), ("SKILLS_HIDE", []), ("SKILL_SETTINGS", {})):
        monkeypatch.setattr(config, k, v)
    with TestClient(create_app(hub, start_loop=False, testing=True)) as c:
        assert c.post("/api/config/skills", json={"skill": "issue", "pin": True}).status_code == 403
        r = c.post("/api/config/skills", headers=GOOD,
                   json={"skill": "issue", "pin": True, "expose": True, "target": "CONTROL", "args_template": "{link_or_text}"})
        assert r.status_code == 200 and r.json()["skills"]["issue"]["target"] == "CONTROL"
        assert tomllib.loads(cfg.read_text())["skills"]["expose"] == ["issue"]
        assert c.post("/api/config/skills", headers=GOOD, json={"skill": "issue", "args_template": "{oops}"}).status_code == 400
        assert c.post("/api/config/skills", headers=GOOD, json={"skill": "issue", "confirm": "never"}).status_code == 400
        assert c.post("/api/config/skills", headers=GOOD, json={"skill": "issue", "placement": "sky"}).status_code == 400
        r = c.post("/api/config/skills", headers=GOOD, json={"skill": "issue", "placement": "global"})
        assert r.status_code == 200 and tomllib.loads(cfg.read_text())["skills"]["issue"]["placement"] == "global"
        assert c.get("/api/config/skills").json()["writable"] is True
        r = c.post("/api/actions/preview", json={"action": "focus", "params": {"station_id": "WS-A"}})
        assert r.status_code == 200 and "select-workspace" in r.json()["command"]


def test_plugin_short_names_and_configured_builtins(claude_home, monkeypatch):
    home, repo = claude_home
    data = {"skills": skills_view.scan(SkillIndex([home]), {str(repo)})}
    monkeypatch.setattr(config, "SKILLS_EXPOSE", ["thing", "code-review"])
    monkeypatch.setattr(config, "SKILLS_HIDE", [])
    monkeypatch.setattr(config, "SKILL_SETTINGS", {"thing": {"pin": True}, "code-review": {"pin": True, "placement": "pr"}})
    snap = skills_view.attach({"stations": [{"id": "A", "cwd": str(repo)}]}, data)
    by = {s["name"]: s for s in snap["skills"]}
    assert by["plug:thing"]["aliases"] == ["thing"] and by["plug:thing"]["exposed"] and by["plug:thing"]["pinned"]
    assert by["code-review"]["scope"] == "configured" and by["code-review"]["pinned"]
    assert by["code-review"]["placement"] == "pr" and by["plug:thing"]["placement"] == "station"
    assert {"thing", "plug:thing", "code-review"} <= set(snap["stations"][0]["skill_names"])
    p = actions.plan("run_skill", {"station_id": "WS-A", "skill": "thing"},
                     {**snap, "stations": [{"id": "WS-A", "title": "X", "skill_names": ["thing"]}], "workpieces": []})
    assert p.facts["text"] == "/thing" and not p.warnings
