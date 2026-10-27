import json

import pytest
from fastapi.testclient import TestClient

from shufler import actions, app as app_mod, config
from shufler.app import Hub, create_app

GOOD = {"origin": "http://127.0.0.1:4700"}


class StubCollectors:
    def __init__(self, transcripts=None):
        self.sources = {}
        self.transcripts = transcripts


@pytest.fixture
def transcript_copy(tmp_path):
    import shutil
    from tests.conftest import FIX
    root = tmp_path / "projects"
    shutil.copytree(FIX / "projects", root)
    return root


@pytest.fixture
def hub(snapshot, tmp_path, monkeypatch, transcript_copy):
    from shufler.transcripts import TranscriptIndex
    from tests.conftest import NOW
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "actions.jsonl")
    monkeypatch.setattr(config, "WEB_DIST", tmp_path / "dist")
    idx = TranscriptIndex({"personal": transcript_copy})
    idx.scan({"bbbb2222-0000-0000-0000-000000000000", "aaaa1111-0000-0000-0000-000000000000"}, now=NOW)
    h = Hub(StubCollectors(idx))
    h.snapshot = snapshot
    return h


@pytest.fixture
def client(hub):
    with TestClient(create_app(hub, start_loop=False, testing=True)) as c:
        yield c


def test_snapshot_and_preview(client):
    r = client.get("/api/snapshot")
    assert r.status_code == 200 and r.json()["type"] == "snapshot"
    r = client.get("/api/actions/preview", params={"action": "pr_ready", "pr": "260"})
    assert r.json()["command"] == "gh pr ready 260 --repo acme/widgets"
    r = client.get("/api/actions/preview", params={"action": "board_stage", "card_id": "1", "stage": "won"})
    assert r.status_code == 400 and "stage must be" in r.json()["error"]


@pytest.mark.parametrize("headers", [{}, {"origin": "https://evil.example"}, {"origin": "http://127.0.0.1:5173"}])
def test_actions_origin_guard(client, monkeypatch, headers):
    called = []
    monkeypatch.setattr(actions, "execute", lambda *a: called.append(a) or {"ok": True})
    r = client.post("/api/actions", json={"action": "focus", "params": {"station_id": "WS-B"}}, headers=headers)
    assert r.status_code == 403 and called == []


def test_actions_allowed_origin(client, monkeypatch):
    called = []
    monkeypatch.setattr(actions, "execute", lambda a, p, s: called.append((a, p)) or {"ok": True, "output": "", "error": None})
    for origin in ("http://127.0.0.1:4700", "http://localhost:4700"):
        r = client.post("/api/actions", json={"action": "focus", "params": {"station_id": "WS-B"}}, headers={"origin": origin})
        assert r.status_code == 200 and r.json()["ok"]
    # flat body form is accepted too
    client.post("/api/actions", json={"action": "focus", "station_id": "WS-B"}, headers=GOOD)
    assert called == [("focus", {"station_id": "WS-B"})] * 3


def test_action_error_is_422(client):
    r = client.post("/api/actions", json={"action": "run_command", "params": {"command": "nope"}}, headers=GOOD)
    assert r.status_code == 422 and not r.json()["ok"] and "unknown command" in r.json()["error"]


def test_websocket_sends_snapshot_and_rejects_foreign_origin(client):
    with client.websocket_connect("/ws", headers=GOOD) as ws:
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "snapshot" and len(msg["stations"]) == 3
        ws.send_text("ping")
        assert json.loads(ws.receive_text())["type"] == "pong"
    with pytest.raises(Exception):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_text()


def test_host_header_guard(client):
    assert client.get("/api/snapshot", headers={"host": "evil.example"}).status_code == 400


def test_static_missing_and_present(client, tmp_path):
    r = client.get("/")
    assert r.status_code == 503 and "web build is missing" in r.text
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>floor</html>")
    (dist / "assets" / "a.js").write_text("console.log(1)")
    assert client.get("/").text == "<html>floor</html>"
    assert client.get("/assets/a.js").text == "console.log(1)"
    assert client.get("/some/spa/route").text == "<html>floor</html>"
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/../../etc/passwd").text in ("<html>floor</html>", "not found")
    assert client.get("/").headers["cache-control"] == "no-cache"                 # a rebuild shows on reload
    assert "immutable" in client.get("/assets/a.js").headers["cache-control"]


def test_station_conversation_endpoint(client):
    r = client.get("/api/stations/WS-B/conversation", params={"n": 2})
    body = r.json()
    assert r.status_code == 200 and len(body["turns"]) == 2 and body["has_more"] is True
    assert body["turns"][-1]["text"].startswith("All tests pass")
    assert client.get("/api/stations/workspace:3/conversation").json()["turns"]  # ref works too
    assert client.get("/api/stations/nope/conversation").status_code == 404
    assert client.get("/api/stations/WS-C/conversation").json()["turns"] == []
    with_results = client.get("/api/stations/WS-B/conversation", params={"results": "1"}).json()
    assert with_results["turns"][1]["tools"][0]["result"] == "PRIVATE RESULT"


def test_workpiece_conversation_endpoint(client):
    body = client.get("/api/workpieces/253/conversation").json()
    assert body["station_id"] == "WS-B" and body["filtered_by_pr"] is True and len(body["turns"]) == 1
    assert client.get("/api/workpieces/99999/conversation").status_code == 404
    assert client.get("/api/workpieces/171/conversation").json()["turns"] == []


def test_ws_subscribe_handshake(client, hub):
    with client.websocket_connect("/ws", headers=GOOD) as ws:
        json.loads(ws.receive_text())  # snapshot
        ws.send_text(json.dumps({"type": "subscribe", "station_id": "workspace:3"}))
        assert json.loads(ws.receive_text()) == {"type": "subscribed", "station_id": "WS-B"}
        assert [v["station_id"] for v in hub.subs.values()] == ["WS-B"]
        ws.send_text(json.dumps({"type": "unsubscribe"}))
        ws.send_text("ping")
        assert json.loads(ws.receive_text())["type"] == "pong"
        assert hub.subs == {}
        ws.send_text(json.dumps({"type": "subscribe", "station_id": "nope"}))
        assert json.loads(ws.receive_text()) == {"type": "subscribed", "station_id": None}


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def test_push_turns_sends_only_new_turns(hub, transcript_copy):
    import asyncio
    path = transcript_copy / "-Users-demo-widgets/bbbb2222-0000-0000-0000-000000000000.jsonl"
    ws = FakeWS()

    async def scenario():
        await hub.subscribe(ws, "WS-B")
        await hub.push_turns()
        assert ws.sent == []  # nothing new since subscribing
        with open(path, "a") as fh:
            fh.write(json.dumps({"type": "assistant", "timestamp": "2026-10-21T10:05:00Z",
                                 "message": {"id": "m9", "content": [{"type": "text", "text": "New turn"}]}}) + "\n")
        await hub.push_turns()
        await hub.push_turns()  # file unchanged: no duplicate

    asyncio.run(scenario())
    assert [(m["type"], m["station_id"], m["turn"]["text"]) for m in ws.sent] == [("turn", "WS-B", "New turn")]


def test_your_move_endpoint_and_ack(client, hub):
    body = client.get("/api/your_move").json()
    assert body["your_move_count"] == len(body["your_move"]) == 3
    r = client.post("/api/actions", json={"action": "ack", "params": {"kind": "merge", "id": "merge:253"}}, headers=GOOD)
    assert r.status_code == 422
    r = client.post("/api/actions", json={"action": "ack", "params": {"kind": "closeout", "id": "closeout:171"}}, headers=GOOD)
    assert r.status_code == 200 and r.json()["ok"] and "closeout:171" in hub.acks
    assert client.post("/api/actions", json={"action": "ack", "params": {"kind": "closeout", "id": "x"}}, headers=GOOD).status_code == 422
    assert client.get("/api/actions/preview", params={"action": "ack", "kind": "reply", "id": "reply:a:b"}).json()["confirm"] == "none"


def test_terminal_endpoints_guarded(client, hub, monkeypatch, tmp_path):
    assert client.post("/api/terminals", json={"preset": "shell_here"}).status_code == 403
    assert client.delete("/api/terminals/abc").status_code == 403
    assert client.post("/api/terminals", json={"preset": "bogus"}, headers=GOOD).status_code == 422
    assert client.post("/api/terminals", json={"station_id": "nope"}, headers=GOOD).status_code == 404
    with pytest.raises(Exception):
        with client.websocket_connect("/term/abc") as ws:  # no origin
            ws.receive_bytes()
    assert client.get("/api/terminals").json() == {"terminals": []}


def test_history_endpoints(client):
    s = client.get("/api/stations/WS-B/history/summary").json()
    assert s["pr_links"][0]["pr"] == 253 and s["turns"] == 1
    r = client.get("/api/stations/WS-B/history/search", params={"q": "tests pass"}).json()
    assert len(r["results"]) == 1
    assert client.get("/api/stations/WS-C/history/summary").status_code == 404


def test_production_app_rejects_testserver_host(hub):
    with TestClient(create_app(hub, start_loop=False)) as c:
        assert c.get("/api/health").status_code == 400
        assert c.get("/api/health", headers={"host": "127.0.0.1:4700"}).status_code == 200


def test_api_config_and_unknown_api_paths(client, snapshot):
    snapshot["skills"] = [{"name": "intake", "exposed": True, "pinned": True}, {"name": "x", "exposed": False, "pinned": False}]
    d = client.get("/api/config").json()
    assert d["product"] == "Shufler" and d["canned_prompts"] and len(d["domains"]) == 7
    assert {p["name"] for p in d["presets"]} == {"shell_here", "prod_console", "preview_console", "local_console"}
    assert next(p for p in d["presets"] if p["name"] == "preview_console")["needs_pr"] is True
    assert [s["name"] for s in d["skills"]] == ["intake"] and d["capabilities"]["skills"]
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"].startswith("no such endpoint")
    assert client.post("/api/nope", json={}).status_code == 404


def test_history_unknown_station_and_ws_paths(client):
    r = client.get("/api/stations/fake/history/summary")
    assert r.status_code == 404 and r.json()["error"] == "unknown station: fake"
    assert client.get("/api/stations/fake/history/search?q=x").json()["error"] == "unknown station: fake"
    assert client.get("/ws").status_code == 426 and client.get("/term/abc").status_code == 426


def test_set_domain_alias_text_adds_and_moves():
    text = ('[world]\nfallback_domain = "unassigned"\n\n[[domain]]\nid = "a"\naliases = ["a"]\n\n'
            '# comment\n[[domain]]\nid = "b"\naliases = ["b"]\nmanual = ["soc"]\n')
    out = config.set_domain_alias_text(text, "a", "soc")
    import tomllib
    doms = {d["id"]: d for d in tomllib.loads(out)["domain"]}
    assert doms["a"]["manual"] == ["soc"] and "manual" not in doms["b"]
    assert "# comment" in out and out.count("[[domain]]") == 2
    again = config.set_domain_alias_text(out, "a", "ft_x")
    assert {d["id"]: d for d in tomllib.loads(again)["domain"]}["a"]["manual"] == ["soc", "ft_x"]
    with pytest.raises(ValueError):
        config.set_domain_alias_text(text, "nope", "soc")


def test_set_domain_action_persists_and_rederives(client, hub, raw_data, tmp_path, monkeypatch):
    from tests.conftest import DOMAINS
    cfg = tmp_path / "config.toml"
    cfg.write_text(DOMAINS.read_text())
    monkeypatch.setattr(config, "CONFIG_FILE", cfg)
    hub.collectors.data = lambda: raw_data
    hub.collectors.health = lambda now: {}
    r = client.get("/api/actions/preview", params={"action": "set_domain", "target": "pr:260", "domain": "search"})
    assert r.status_code == 200 and r.json()["facts"]["alias_kind"] == "branch"
    r = client.post("/api/actions", json={"action": "set_domain", "params": {"target": "pr:260", "domain": "nope"}},
                    headers=GOOD)
    assert r.status_code == 422 and "domain must be one of" in r.json()["error"]
    r = client.post("/api/actions", json={"action": "set_domain",
                                          "params": {"target": "pr:260", "domain": "search"}}, headers=GOOD)
    body = r.json()
    assert r.status_code == 200 and body["domain_source"]["domain_source"] == "manual"
    assert body["domain_source"]["domain"] == "search"
    assert 'manual = ["ft_billing_branch"]' in cfg.read_text()
    w = next(x for x in hub.snapshot["workpieces"] if x["id"] == "pr:260")
    assert (w["domain"], w["domain_source"]) == ("search", "manual")
    r = client.post("/api/actions", json={"action": "set_domain",
                                          "params": {"target": "station:WS-B", "domain": "billing"}}, headers=GOOD)
    assert r.json()["domain_source"] == {"domain": "billing", "domain_source": "manual",
                                         "domain_reason": "set by hand (workspace title `AUTH`)"}


@pytest.mark.parametrize("alias", ["soc\n[evil]", "soc\r", "a\x0bb", "a\x0cb", "a\x1cb", "a\x1eb", "a\x85b",
                                   "a b", "a b", "a\x00b", "a\x7fb", 'a"b', "a]b", "", "   ", "x" * 101])
def test_set_domain_rejects_unsafe_alias(alias):
    from tests.conftest import DOMAINS
    with pytest.raises(ValueError, match="alias may only contain"):
        config.set_domain_alias_text(DOMAINS.read_text(), "search", alias)


def test_set_domain_round_trip_only_adds_the_manual_line():
    import difflib
    from tests.conftest import DOMAINS
    text = DOMAINS.read_text()
    out = config.set_domain_alias_text(text, "search", "ft_09-17/soc.x y")
    diff = [l for l in difflib.unified_diff(text.splitlines(), out.splitlines(), lineterm="", n=0)
            if l[:1] in "+-" and not l.startswith(("+++", "---"))]
    assert diff == ['+manual = ["ft_09-17/soc.x y"]']
    back = config.set_domain_alias_text(out, "billing", "ft_09-17/soc.x y")  # moves, search's list goes away
    assert "manual" not in next(d for d in __import__("tomllib").loads(back)["domain"] if d["id"] == "search")


def test_set_domain_refuses_control_char_branch(client, hub, raw_data, tmp_path, monkeypatch):
    from tests.conftest import DOMAINS
    cfg = tmp_path / "config.toml"
    cfg.write_text(DOMAINS.read_text())
    monkeypatch.setattr(config, "CONFIG_FILE", cfg)
    w = next(x for x in hub.snapshot["workpieces"] if x["pr"] == 260)
    w["branch"] = "ft_x\n[skills]\nexpose = [\"pwn\"]"
    r = client.post("/api/actions", json={"action": "set_domain",
                                          "params": {"target": "pr:260", "domain": "search"}}, headers=GOOD)
    assert r.status_code == 422 and "alias may only contain" in r.json()["error"]
    assert cfg.read_text() == DOMAINS.read_text()
