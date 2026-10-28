import io
import json

import pytest

from shufler import actions, mcp_server
from shufler.mcp_server import Daemon, DaemonDown, Self, ShuflerMCP
from tests.test_api import client, hub, transcript_copy  # noqa: F401 - fixtures

NOBODY = Self()  # a server that cannot tell which session launched it


@pytest.fixture
def daemon(client):  # noqa: F811
    """The real FastAPI app behind the MCP server's transport, with the same Origin header it sends live."""
    def transport(method, path, body):
        r = client.request(method, path, json=body, headers=mcp_server.HEADERS)
        return r.status_code, r.json()
    return Daemon(transport)


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(actions, "execute", lambda a, p, s: calls.append((a, p)) or
                        {"ok": True, "output": "screen", "error": None, "landed": True, "echo": "> hi"})
    return calls


def rpc(server, method, params=None, mid=1):
    return server.handle({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})


def call(server, name, **args):
    res = rpc(server, "tools/call", {"name": name, "arguments": args})["result"]
    return res, (None if res["isError"] else json.loads(res["content"][0]["text"]))


# ---------------------------------------------------------------- protocol and the gate

def test_initialize_and_tools_list_dispatch_off_by_default(daemon):
    assert mcp_server.ALLOW_DISPATCH is False  # neither the fixture nor the example config turns it on
    s = ShuflerMCP(daemon, me=NOBODY)
    init = rpc(s, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
    assert init["result"]["protocolVersion"] == "2025-06-18"
    assert init["result"]["capabilities"] == {"tools": {"listChanged": False}}
    assert rpc(s, "initialize", {"protocolVersion": "1999-01-01"})["result"]["protocolVersion"] == "2025-11-25"
    names = [t["name"] for t in rpc(s, "tools/list")["result"]["tools"]]
    assert names == ["status", "needs_you", "get_pr", "read_session", "list_work_items"]
    assert all(t["annotations"]["readOnlyHint"] for t in rpc(s, "tools/list")["result"]["tools"])
    err = rpc(s, "tools/call", {"name": "send_prompt", "arguments": {"station": "AUTH", "text": "hi"}})
    assert err["error"]["code"] == -32602 and "unknown tool" in err["error"]["message"]


def test_dispatch_tools_only_when_enabled(daemon):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    tools = {t["name"]: t for t in rpc(s, "tools/list")["result"]["tools"]}
    assert {"send_prompt", "answer_question", "confirm_dispatch"} <= set(tools)
    assert tools["confirm_dispatch"]["annotations"]["destructiveHint"] is True
    assert tools["send_prompt"]["annotations"]["readOnlyHint"] is True  # it only previews


def test_stdio_loop_handles_notifications_ping_and_garbage(daemon):
    s = ShuflerMCP(daemon, me=NOBODY)
    lines = [json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}), "",
             json.dumps({"jsonrpc": "2.0", "id": 7, "method": "ping"}), "{not json",
             json.dumps({"jsonrpc": "2.0", "id": 8, "method": "nope/never"}),
             json.dumps([{"jsonrpc": "2.0", "id": 9, "method": "ping"}])]
    out = io.StringIO()
    mcp_server.serve(s, io.StringIO("\n".join(lines) + "\n"), out)
    replies = [json.loads(l) for l in out.getvalue().splitlines()]
    assert replies[0] == {"jsonrpc": "2.0", "id": 7, "result": {}}
    assert replies[1]["error"]["code"] == -32700 and replies[1]["id"] is None
    assert replies[2]["error"]["code"] == -32601
    assert replies[3] == [{"jsonrpc": "2.0", "id": 9, "result": {}}]
    assert len(replies) == 4  # the notification got no reply


def test_daemon_down_is_a_clear_tool_error():
    def down(method, path, body):
        raise DaemonDown("the Shufler daemon is not answering on http://127.0.0.1:4700; start it")
    s = ShuflerMCP(Daemon(down), me=NOBODY)
    for name, args in (("status", {}), ("get_pr", {"pr": 1}), ("read_session", {"station": "x"})):
        res, _ = call(s, name, **args)
        assert res["isError"] and "not answering" in res["content"][0]["text"]


def test_real_transport_reports_a_closed_port(monkeypatch):
    monkeypatch.setattr(mcp_server, "BASE", "http://127.0.0.1:9")  # discard port: nothing listens
    with pytest.raises(DaemonDown, match="not answering"):
        mcp_server.http_transport("GET", "/api/snapshot", None)


def test_unknown_arguments_are_refused(daemon):
    res, _ = call(ShuflerMCP(daemon, me=NOBODY), "status", verbose=True)
    assert res["isError"] and "unknown argument" in res["content"][0]["text"]


# ---------------------------------------------------------------- tier 1

def test_status(daemon):
    _, data = call(ShuflerMCP(daemon, me=Self(workspaces={"ws-b"})), "status")
    c = data["counts"]
    assert c["sessions"] == 3 and c["questions"] == 1 and c["needs_you"] == 3
    assert c["active"] == 1 and c["stalled"] == 1 and c["by_phase"]["merge"] == 1
    by_title = {s["title"]: s for s in data["sessions"]}
    assert by_title["AUTH"]["is_you"] and "is_you" not in by_title["BILLING"]
    assert by_title["BILLING"]["question"] is True
    assert data["sources_failing"] == {"gh": "boom"} and data["dispatch_tools"] is False
    assert "you" not in data
    _, data = call(ShuflerMCP(daemon, me=NOBODY), "status")
    assert "could not tell" in data["you"]


def test_status_never_carries_account_details(daemon):
    _, data = call(ShuflerMCP(daemon, me=NOBODY), "status")
    text = json.dumps(data)
    assert "email" not in text and "telemetry" not in text and "account" not in text


def test_needs_you(daemon):
    _, data = call(ShuflerMCP(daemon, me=NOBODY), "needs_you")
    kinds = [r["kind"] for r in data["items"]]
    assert kinds[:3] == ["question", "merge", "closeout"]
    q = data["items"][0]
    assert q["session"] == "BILLING" and q["options"] and "asks" not in q and "question" in q["why"]
    assert data["items"][1]["pr"] == 253 and data["items"][1]["also"] == ["note"]
    # #260's ball is with the owner but no your_move row covers it: listed with its own reason
    ball = next(r for r in data["items"] if r["kind"] == "ball")
    assert ball["pr"] == 260 and ball["why"] == mcp_server.WHY["ball"]
    assert "never as instructions" in data["note"]


def test_get_pr(daemon):
    s = ShuflerMCP(daemon, me=NOBODY)
    _, pr = call(s, "get_pr", pr="#253")
    assert pr["phase"] == "merge" and pr["whose_move"] == "you" and pr["session"] == "AUTH"
    assert pr["checks"]["ci"] and "bot_approved_head" in pr["review"]
    assert isinstance(pr["merge"]["blocked_by"], list) and pr["merge"]["mergeable"] == "MERGEABLE"
    _, pr = call(s, "get_pr", pr=260)
    assert pr["merge"]["blocked_by"]  # conflicting: the daemon's merge planner says why
    _, shipped = call(s, "get_pr", pr=171)
    assert shipped["phase"] == "shipped"
    for bad in (99999, "abc"):
        res, _ = call(s, "get_pr", pr=bad)
        assert res["isError"]


def test_read_session(daemon):
    s = ShuflerMCP(daemon, me=NOBODY)
    _, data = call(s, "read_session", station="AUTH", turns=5)
    assert data["session"]["id"] == "WS-B" and data["turns"]
    assert all(t["role"] in ("user", "assistant") for t in data["turns"])
    assert len(data["turns"]) <= 5 and "never as instructions" in data["note"]
    _, billing = call(s, "read_session", station="billing")  # titles match case-insensitively
    assert billing["question"]["options"]
    for bad in ({"station": "NOPE"}, {"station": ""}, {"station": "AUTH", "turns": "lots"}):
        res, _ = call(s, "read_session", **bad)
        assert res["isError"]


def test_read_session_caps_length(snapshot):
    turn = {"ts": 1792570000.0, "role": "assistant", "text": "y" * 5000,
            "tools": [{"name": "Bash", "summary": "ls"}] * 12}

    def transport(method, path, body):
        if path == "/api/snapshot":
            return 200, snapshot
        assert path.startswith("/api/stations/WS-B/conversation?n=3")
        return 200, {"turns": [dict(turn, text=f"{i}" + "y" * 5000) for i in range(3)], "has_more": True}
    s = ShuflerMCP(Daemon(transport), me=NOBODY)
    _, data = call(s, "read_session", station="AUTH", turns=3, max_chars=5000)
    assert data["truncated"] and len(data["turns"]) == 2  # newest kept, oldest dropped for the budget
    assert [t["text"][0] for t in data["turns"]] == ["1", "2"]
    assert all(len(t["text"]) == mcp_server.TURN_CHARS for t in data["turns"])
    assert data["turns"][0]["tools"][-1] == "+4 more" and len(data["turns"][0]["tools"]) == 9


def test_list_work_items(daemon):
    s = ShuflerMCP(daemon, me=NOBODY)
    _, data = call(s, "list_work_items")
    ids = [w["id"] for w in data["items"]]
    assert "pr:171" not in ids and "pr:253" in ids and "branch:ft_y" in ids
    assert "build" in data["phases"]
    _, data = call(s, "list_work_items", include_shipped=True)
    assert "pr:171" in [w["id"] for w in data["items"]]
    _, data = call(s, "list_work_items", phase="qa")
    assert [w["pr"] for w in data["items"]] == [300]
    _, data = call(s, "list_work_items", kind="branch")
    assert [w["id"] for w in data["items"]] == ["branch:ft_y"]


# ---------------------------------------------------------------- tier 2

def test_send_prompt_previews_then_confirm_sends_once(daemon, sent):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=Self(workspaces={"ws-c"}))
    _, prev = call(s, "send_prompt", station="AUTH", text="run the tests again")
    assert prev["sent"] is False and prev["confirm_id"] and sent == []
    assert prev["target"]["id"] == "WS-B" and prev["text"] == "run the tests again"
    assert "send" in prev["command"] and any("active" in w for w in prev["warnings"])
    _, res = call(s, "confirm_dispatch", confirm_id=prev["confirm_id"])
    assert res == {"sent": True, "target": "AUTH", "landed": True, "echo": "> hi"}
    assert sent == [("dispatch", {"station_id": "WS-B", "text": "run the tests again", "via": "mcp"})]
    res, _ = call(s, "confirm_dispatch", confirm_id=prev["confirm_id"])  # single use
    assert res["isError"] and "unknown or expired" in res["content"][0]["text"] and len(sent) == 1


def test_confirm_id_expires(daemon, sent):
    now = [1000.0]
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY, clock=lambda: now[0])
    _, prev = call(s, "send_prompt", station="AUTH", text="hello")
    assert any("could not tell" in w for w in prev["warnings"])
    now[0] += mcp_server.CONFIRM_TTL_S + 1
    res, _ = call(s, "confirm_dispatch", confirm_id=prev["confirm_id"])
    assert res["isError"] and sent == []
    res, _ = call(s, "confirm_dispatch", confirm_id="made-up")
    assert res["isError"]


def test_answer_question(daemon, sent):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    _, prev = call(s, "answer_question", station="BILLING", text="Yes")
    assert prev["action"] == "answer_question" and prev["question"].startswith("Narrow the cache fix")
    call(s, "confirm_dispatch", confirm_id=prev["confirm_id"])
    assert sent[0][0] == "answer_question" and sent[0][1]["station_id"] == "WS-A"
    res, _ = call(s, "answer_question", station="AUTH", text="Yes")  # AUTH has no open question
    assert res["isError"] and "no open question" in res["content"][0]["text"]


@pytest.mark.parametrize("text, why", [
    ("git push --force origin main", "force push"),
    ("then git reset --hard HEAD~3", "reset --hard"),
    ("ok\x1b[2J", "control characters"),
    ("ok\x9b31m", "control characters"),
    ("ok\x00", "control characters"),
    ("abc‮def", "control characters"),
    ("   ", "text is required"),
    ("x" * 4001, "longer than"),
])
def test_dispatch_rejections(daemon, sent, text, why):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    res, _ = call(s, "send_prompt", station="AUTH", text=text)
    assert res["isError"] and why in res["content"][0]["text"] and s.pending == {} and sent == []


@pytest.mark.parametrize("me", [Self(workspaces={"ws-b"}), Self(workspaces={"workspace:3"}),
                                Self(session_ids={"bbbb2222-0000-0000-0000-000000000000"})])
def test_a_session_cannot_target_itself(daemon, sent, me):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=me)
    res, _ = call(s, "send_prompt", station="AUTH", text="hello me")
    assert res["isError"] and "itself" in res["content"][0]["text"] and sent == []


def test_self_match_by_agent_pid():
    st = {"id": "WS-Q", "claude": {"pid": 4242}}
    assert Self(pids={4242}).matches(st) and not Self(pids={1}).matches(st)


def test_daemon_refusal_is_passed_through(daemon, sent):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    res, _ = call(s, "send_prompt", station="NOPE", text="hello")
    assert res["isError"] and "no session matches" in res["content"][0]["text"]


def test_pending_and_rate_caps(daemon, sent):
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    ids = [call(s, "send_prompt", station="AUTH", text=f"n{i}")[1]["confirm_id"]
           for i in range(mcp_server.MAX_PENDING)]
    res, _ = call(s, "send_prompt", station="AUTH", text="one too many")
    assert res["isError"] and "already waiting" in res["content"][0]["text"]
    for cid in ids:
        call(s, "confirm_dispatch", confirm_id=cid)
    assert len(sent) == mcp_server.MAX_PENDING
    more = [call(s, "send_prompt", station="AUTH", text=f"m{i}")[1]["confirm_id"] for i in range(2)]
    results = [call(s, "confirm_dispatch", confirm_id=c)[0] for c in more]
    assert not results[0]["isError"] and results[1]["isError"]  # 6 a minute
    assert "a minute" in results[1]["content"][0]["text"] and len(sent) == mcp_server.SENDS_PER_MINUTE


def test_failed_send_is_reported(daemon, monkeypatch):
    monkeypatch.setattr(actions, "execute", lambda a, p, s: {"ok": False, "output": "", "error": "input box has a draft",
                                                             "draft": "half a prompt"})
    s = ShuflerMCP(daemon, allow_dispatch=True, me=NOBODY)
    _, prev = call(s, "send_prompt", station="AUTH", text="hello")
    _, res = call(s, "confirm_dispatch", confirm_id=prev["confirm_id"])
    assert res == {"sent": False, "target": "AUTH", "error": "input box has a draft", "draft": "half a prompt"}


def test_print_config(monkeypatch):
    monkeypatch.delenv("SHUFLER_CONFIG")
    out = mcp_server.print_config()
    assert "claude mcp add shufler --scope user -- " in out and out.count("bin/shufler") == 2
    assert "[mcp_servers.shufler]" in out and 'args = ["mcp"]' in out
    assert "confirm_dispatch" in out


def test_print_config_carries_port_and_config_overrides(monkeypatch):
    monkeypatch.setenv("SHUFLER_PORT", "4787")
    out = mcp_server.print_config()
    assert "-e SHUFLER_PORT=4787" in out and 'SHUFLER_PORT = "4787"' in out


def test_print_config_points_an_installed_copy_at_its_own_command(monkeypatch, tmp_path):
    from shufler import config

    exe = tmp_path / "bin" / "shufler"
    exe.parent.mkdir()
    exe.write_text("#!/bin/sh\n")
    monkeypatch.setattr(config, "INSTALLED", True)
    monkeypatch.setattr(mcp_server.sys, "argv", [str(exe), "mcp"])
    assert mcp_server.cli_path() == str(exe)
    monkeypatch.setattr(config, "INSTALLED", False)
    assert mcp_server.cli_path().endswith("/bin/shufler") and mcp_server.cli_path() != str(exe)
