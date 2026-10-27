"""Context library: store, path fences, resolve, message composition, owed, the action and the routes."""

import json
import os

import pytest
from fastapi.testclient import TestClient

from shufler import actions, config, library
from shufler.app import Hub, create_app
from shufler.library import Library, LibraryError
from shufler.runner import RunResult

GOOD = {"origin": "http://127.0.0.1:4700"}


@pytest.fixture
def lib(tmp_path):
    store = Library(tmp_path / "cfg" / "library.json")
    library.set_current(store)
    yield store
    library.set_current(None)


@pytest.fixture
def tree(tmp_path, monkeypatch):
    """home/ with a repo (two worktrees sharing docs/context/auth_management) and a secret outside home."""
    home = tmp_path / "home"
    repo = home / "repo"
    for wt in (repo, home / "worktrees" / "wt1"):
        d = wt / "docs" / "context" / "auth_management"
        d.mkdir(parents=True)
        (d / "README.md").write_text("auth")
        (d / "nav.md").write_text("nav")
    (repo / ".git").mkdir()
    (repo / "notes.md").write_text("n")
    (repo / ".hidden").write_text("h")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.txt").write_text("s")
    os.symlink(tmp_path / "outside", repo / "escape")
    monkeypatch.setattr(config, "HOME", home)
    return home


def snap_for(home, stations=None):
    return {"stations": stations or [
        {"id": "WS-P", "title": "AUTH", "cwd": str(home / "repo"), "domain": "auth", "session_id": "s1",
         "telemetry": {"session_started_at": 1000.0, "compactions": 0}, "claude": {"running": True}},
        {"id": "WS-W", "title": "wt1", "cwd": str(home / "worktrees" / "wt1"), "domain": "billing", "session_id": "s2",
         "telemetry": {}, "claude": None},
    ], "utility_stations": [{"id": "WS-X", "title": "CODEX", "cwd": str(home), "session_id": None, "telemetry": {}}]}


# ---------------------------------------------------------------- store

def test_store_round_trip_atomic_and_validation(lib, tmp_path):
    it = lib.upsert_item({"name": "Auth context", "paths": ["~/docs/x", "/abs/y/../z"], "tags": "Auth, docs"})
    assert it["id"].startswith("lib_") and it["paths"] == [os.path.expanduser("~/docs/x"), "/abs/z"]
    assert it["tags"] == ["auth", "docs"]
    raw = json.loads(lib.path.read_text())
    assert raw["version"] == 1 and raw["items"][0]["name"] == "Auth context"
    assert not [p for p in lib.path.parent.iterdir() if p.name.endswith(".tmp")]
    upd = lib.upsert_item({"id": it["id"], "name": "Renamed", "paths": ["/abs/z"]})
    assert upd["created"] == it["created"] and len(Library(lib.path).load()["items"]) == 1
    for bad in ({"name": "", "paths": ["/a"]}, {"name": "x", "paths": []}, {"name": "x", "paths": ["rel/path"]},
                {"name": "a\nb", "paths": ["/a"]}, {"name": "x", "paths": ["/a\nrm -rf ~"]}, {"name": "x", "paths": ["/a\tb"]},
                {"name": "x", "paths": ["/a"], "tags": ["Bad Tag!"]},
                {"id": "lib_nothere", "name": "x", "paths": ["/a"]}, {"id": "lib_00000000", "name": "x", "paths": ["/a"]}):
        with pytest.raises(LibraryError):
            lib.upsert_item(bad)


def test_grants_dedupe_and_delete_cascade(lib):
    it = lib.upsert_item({"name": "A", "paths": ["/a"]})
    g1 = lib.add_grant({"item_id": it["id"], "target": "domain:auth"})
    g2 = lib.add_grant({"item_id": it["id"], "target": "domain:auth", "mode": "once"})
    assert g1["id"] == g2["id"] and g2["mode"] == "once" and len(lib.load()["grants"]) == 1
    for bad in ({"item_id": it["id"], "target": "everyone"}, {"item_id": it["id"], "target": "station:a b"},
                {"item_id": it["id"], "target": "all", "mode": "forever"}, {"item_id": "lib_00000000", "target": "all"}):
        with pytest.raises(LibraryError):
            lib.add_grant(bad)
    assert lib.delete_item(it["id"]) and lib.load()["grants"] == [] and not lib.delete_item(it["id"])


def test_store_follows_file_edits_and_sets_corrupt_file_aside(lib):
    lib.upsert_item({"name": "A", "paths": ["/a"]})
    data = json.loads(lib.path.read_text())
    data["items"][0]["name"] = "edited by hand"
    lib.path.write_text(json.dumps(data))
    os.utime(lib.path, (1, 1))
    assert lib.load()["items"][0]["name"] == "edited by hand"
    lib.path.write_text("{not json")
    os.utime(lib.path, (2, 2))
    assert lib.load()["items"] == [] and lib.error
    lib.upsert_item({"name": "B", "paths": ["/b"]})
    assert any(p.name.startswith("library.json.corrupt-") for p in lib.path.parent.iterdir())
    assert [i["name"] for i in lib.load()["items"]] == ["B"]


def test_path_status(tree):
    d = library.path_status(str(tree / "repo" / "docs" / "context" / "auth_management"))
    assert d["exists"] and d["kind"] == "dir" and d["files"] == 2 and d["size"] == len("auth") + len("nav")
    f = library.path_status(str(tree / "repo" / "notes.md"))
    assert f["kind"] == "file" and f["size"] == 1
    assert library.path_status(str(tree / "nope"))["exists"] is False


# ---------------------------------------------------------------- path safety

def test_safe_path_fences(tree, tmp_path):
    roots = library.roots(snap_for(tree))
    assert library.safe_path("~/repo/notes.md", roots) == os.path.realpath(tree / "repo" / "notes.md")
    for bad, why in (("~/repo/../../outside/secret.txt", ".."), (str(tmp_path / "outside" / "secret.txt"), "outside"),
                     (str(tree / "repo" / "escape" / "secret.txt"), "outside"), ("relative/path", "absolute"),
                     ("/etc/passwd", "outside"), ("", "required"), ("/a\x00b", "required")):
        with pytest.raises(LibraryError, match=why):
            library.safe_path(bad, roots)


def test_browse_lists_hides_dotfiles_and_autocompletes(tree, tmp_path):
    roots = library.roots(snap_for(tree))
    top = library.browse("", roots)
    assert {e["path"] for e in top["entries"]} == set(roots)
    out = library.browse(str(tree / "repo"), roots)
    names = [e["name"] for e in out["entries"]]
    assert names[:2] == ["docs", "escape"] and "notes.md" in names and ".hidden" not in names
    assert ".hidden" in [e["name"] for e in library.browse(str(tree / "repo"), roots, hidden=True)["entries"]]
    pre = library.browse(str(tree / "repo" / "no"), roots)
    assert [e["name"] for e in pre["entries"]] == ["notes.md"] and pre["prefix"] == "no"
    for bad in (str(tmp_path / "outside"), str(tree / "repo" / "escape"), "~/../..", "/"):
        with pytest.raises(LibraryError):
            library.browse(bad, roots)


# ---------------------------------------------------------------- resolve

def test_resolve_one_many_none(tree):
    snap = snap_for(tree)
    res = library.resolve([{"name": "notes.md", "kind": "file"},
                           {"name": "auth_management", "kind": "dir", "children": ["README.md"]},
                           {"name": "repo/docs/context/auth_management"},
                           "missing.md", {"name": "auth_management", "kind": "file"}], snap)
    assert [r["status"] for r in res] == ["one", "many", "one", "none", "none"]
    assert res[0]["matches"] == [os.path.realpath(tree / "repo" / "notes.md")]
    assert len(res[1]["matches"]) == 2
    assert not any("outside" in m for r in res for m in r["matches"])  # the escape symlink is never followed
    with pytest.raises(LibraryError):
        library.resolve([{"name": "../outside"}], snap)
    with pytest.raises(LibraryError):
        library.resolve([], snap)


# ---------------------------------------------------------------- composition

def test_compose_claude_code_add_dir_outside_cwd_then_mentions():
    items = [{"name": "Auth", "paths": ["/r/docs/ctx", "/shared/specs", "/shared/specs/sub"]},
             {"name": "Glossary", "paths": ["/r/g lossary.md", "/elsewhere/file.md"]}]
    kinds = {"/r/docs/ctx": "dir", "/shared/specs": "dir", "/shared/specs/sub": "dir", "/r/g lossary.md": "file",
             "/elsewhere/file.md": "file"}
    lines = library.compose("claude-code", items, "/r", "Focus on NAV", kinds)
    assert lines[:-1] == ["/add-dir /shared/specs"]  # inside-cwd folder skipped, nested folder folded into its parent
    assert lines[-1] == ('Context from the library: Auth: @docs/ctx @/shared/specs @/shared/specs/sub; '
                         'Glossary: @"g lossary.md" @/elsewhere/file.md. Focus on NAV. Read these before continuing.')


def test_compose_plain_for_codex_and_unknown_harness():
    items = [{"name": "A", "paths": ["/x/a", "/x/b"]}]
    assert library.compose("codex", items, "/x", None, {"/x/a": "dir"}) == [
        "Context from the library: A: /x/a /x/b. Read these before continuing."]
    assert library.compose("whatever", items, None) == library.compose("generic", items, None)
    assert library.harness_for({"title": "CODEX"}) == "codex" and library.harness_for({"title": "BILLING"}) == "claude-code"


# ---------------------------------------------------------------- owed

def test_owed_pinned_once_sessions_and_compaction(lib, tree):
    snap = snap_for(tree)
    a = lib.upsert_item({"name": "A", "paths": ["/a"]})["id"]
    b = lib.upsert_item({"name": "B", "paths": ["/b"]})["id"]
    c = lib.upsert_item({"name": "C", "paths": ["/c"]})["id"]
    lib.add_grant({"item_id": a, "target": "domain:auth"})
    lib.add_grant({"item_id": b, "target": "all"})
    lib.add_grant({"item_id": c, "target": "station:WS-X", "mode": "once"})
    o = library.snapshot_field(lib, snap)
    assert o["items"] == 3 and o["owed"] == {"WS-P": [a, b], "WS-W": [b], "WS-X": [c]}  # utility: explicit only

    st = snap["stations"][0]
    lib.record_delivery([a, b], st, ts=2000.0)
    assert library.owed(lib.load(), snap["stations"]).get("WS-P") is None
    st["telemetry"]["compactions"] = 1  # compacted since the send: pinned context is owed again
    assert library.owed(lib.load(), snap["stations"])["WS-P"] == [a, b]
    st["telemetry"]["compactions"] = 0
    st["session_id"], st["telemetry"]["session_started_at"] = "s-new", 3000.0  # a new session
    assert library.owed(lib.load(), snap["stations"])["WS-P"] == [a, b]
    st["claude"] = {"running": False}  # nobody there to read it
    assert "WS-P" not in library.owed(lib.load(), snap["stations"])

    lib.record_delivery([c], snap["utility_stations"][0])
    assert "WS-X" not in library.owed(lib.load(), [], snap["utility_stations"])


def test_owed_ignores_grants_of_deleted_items():
    data = {"items": [], "grants": [{"item_id": "lib_0000000a", "target": "all", "mode": "pinned"}], "deliveries": []}
    assert library.owed(data, [{"id": "S", "domain": "x"}]) == {}


# ---------------------------------------------------------------- the action (runner mocked; cmux never runs)

RULE = "─" * 40
EMPTY = f"{RULE}\n❯\xa0\n{RULE}\n"


class FakeCmux:
    def __init__(self, after_add_dir=EMPTY):
        self.calls, self.sent, self.after_add_dir = [], [], after_add_dir

    def __call__(self, argv, timeout=30, env=None):
        self.calls.append(argv)
        verb = argv[1]
        if verb == "list-pane-surfaces":
            return RunResult(0, json.dumps({"surfaces": [{"ref": "surface:3", "type": "terminal"}]}), "")
        if verb == "send":
            self.sent.append(argv[-1])
        if verb == "read-screen":
            if self.sent and self.sent[-1].startswith("/add-dir"):
                return RunResult(0, self.after_add_dir, "")
            return RunResult(0, f"❯ {self.sent[-1]}\n{EMPTY}" if self.sent else EMPTY, "")
        return RunResult(0, "", "")


@pytest.fixture
def send_setup(lib, tree, snapshot, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "actions.jsonl")
    monkeypatch.setattr(actions.time, "sleep", lambda s: None)
    outside_dir = tree / "worktrees" / "wt1" / "docs"
    it = lib.upsert_item({"name": "Ctx", "paths": [str(tree / "repo" / "notes.md"), str(outside_dir)]})
    st = next(s for s in snapshot["stations"] if s["id"] == "WS-B")
    st["cwd"] = str(tree / "repo")
    return it, outside_dir


def test_library_send_preview_and_execution(send_setup, snapshot, monkeypatch):
    it, outside_dir = send_setup
    p = actions.preview("library_send", {"station_id": "WS-B", "item_ids": it["id"], "note": "for NAV"}, snapshot)
    assert p["facts"]["harness"] == "claude-code"
    assert p["facts"]["message"].splitlines()[0] == f"/add-dir {outside_dir}"
    assert "@notes.md" in p["facts"]["message"] and "for NAV" in p["text"]
    assert p["command"].count("send-key") == 2 and p["confirm"] == "tap"
    fake = FakeCmux()
    monkeypatch.setattr(actions, "run", fake)
    r = actions.execute("library_send", {"station_id": "WS-B", "item_ids": [it["id"]]}, snapshot)
    assert r["ok"] and r["landed"], r
    assert fake.sent[0] == f"/add-dir {outside_dir}" and fake.sent[1].startswith("Context from the library: Ctx:")
    assert [a[1] for a in fake.calls] == ["list-pane-surfaces", "read-screen", "send", "send-key", "read-screen",
                                          "send", "send-key", "read-screen"]


def test_library_send_stops_when_add_dir_opens_a_dialog(send_setup, snapshot, monkeypatch):
    it, _ = send_setup
    fake = FakeCmux(after_add_dir="Add directory to workspace?\n❯ 1. Yes, for this session\n  2. No\n")
    monkeypatch.setattr(actions, "run", fake)
    r = actions.execute("library_send", {"station_id": "WS-B", "item_ids": it["id"]}, snapshot)
    assert not r["ok"] and "not back at an empty prompt" in r["error"] and len(fake.sent) == 1


def test_library_send_edited_text_and_refusals(send_setup, snapshot):
    it, _ = send_setup
    p = actions.preview("library_send", {"station_id": "WS-B", "item_ids": it["id"],
                                         "text": "Read @notes.md\n/add-dir /tmp/x\nthen continue"}, snapshot)
    assert p["facts"]["message"] == "/add-dir /tmp/x\nRead @notes.md then continue"
    assert any("edited" in w for w in p["warnings"])
    for params, why in (({"station_id": "WS-B", "item_ids": "lib_00000000"}, "no library item"),
                        ({"station_id": "WS-B"}, "item_ids"), ({"station_id": "NOPE", "item_ids": it["id"]}, "unknown station"),
                        ({"station_id": "WS-B", "item_ids": it["id"], "text": "git reset --hard"}, "never-do"),
                        ({"station_id": "WS-B", "item_ids": it["id"], "harness": "emacs"}, "harness")):
        with pytest.raises(actions.ActionError, match=why):
            actions.plan("library_send", params, snapshot)


# ---------------------------------------------------------------- routes

class StubCollectors:
    sources: dict = {}
    transcripts = None


@pytest.fixture
def client(lib, tree, snapshot, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ACTIONS_LOG", tmp_path / "actions.jsonl")
    hub = Hub(StubCollectors())
    hub.snapshot = {**snapshot, **snap_for(tree, [*snapshot["stations"], *snap_for(tree)["stations"]])}
    with TestClient(create_app(hub, start_loop=False, testing=True)) as c:
        c.hub = hub
        yield c


MUTATING = [("post", "/api/library/items", {"name": "x", "paths": ["/x"]}), ("delete", "/api/library/items/lib_00000000", None),
            ("post", "/api/library/grants", {"item_id": "lib_00000000", "target": "all"}),
            ("delete", "/api/library/grants/ft_00000000", None), ("post", "/api/library/resolve", {"entries": ["a"]})]


@pytest.mark.parametrize("method,url,body", MUTATING)
@pytest.mark.parametrize("headers", [{}, {"origin": "https://evil.example"}, {"origin": "http://127.0.0.1:5173"}])
def test_library_routes_origin_guard(client, lib, method, url, body, headers):
    r = client.request(method.upper(), url, json=body, headers=headers)
    assert r.status_code == 403 and lib.load()["items"] == []


def test_library_reads_refuse_foreign_origin(client):
    assert client.get("/api/library", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/library/browse", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/library").status_code == 200


def test_library_routes_flow(client, lib, tree):
    r = client.post("/api/library/items", json={"name": "Docs", "paths": [str(tree / "repo" / "docs")]}, headers=GOOD)
    item = r.json()["result"]
    assert r.status_code == 200 and item["id"].startswith("lib_")
    assert client.post("/api/library/items", json={"name": "", "paths": []}, headers=GOOD).status_code == 400
    g = client.post("/api/library/grants", json={"item_id": item["id"], "target": "domain:auth"}, headers=GOOD).json()["result"]
    assert client.hub.snapshot["library"]["owed"]["WS-P"] == [item["id"]]
    view = client.get("/api/library").json()
    assert view["items"][0]["status"][0]["kind"] == "dir" and view["grants"][0]["id"] == g["id"]
    assert view["owed"]["WS-P"] == [item["id"]]
    b = client.get("/api/library/browse", params={"path": str(tree / "repo")}).json()
    assert "docs" in [e["name"] for e in b["entries"]]
    assert client.get("/api/library/browse", params={"path": "/etc"}).status_code == 400
    res = client.post("/api/library/resolve", json={"entries": [{"name": "notes.md"}]}, headers=GOOD).json()
    assert res["results"][0]["status"] == "one"
    assert client.delete(f"/api/library/grants/{g['id']}", headers=GOOD).status_code == 200
    assert client.hub.snapshot["library"]["owed"] == {}
    assert client.delete(f"/api/library/items/{item['id']}", headers=GOOD).status_code == 200
    assert client.delete(f"/api/library/items/{item['id']}", headers=GOOD).status_code == 404


def test_library_send_success_records_delivery(client, lib, tree, monkeypatch):
    item = lib.upsert_item({"name": "N", "paths": [str(tree / "repo" / "notes.md")]})
    lib.add_grant({"item_id": item["id"], "target": "station:WS-P"})
    client.hub.refresh_library()
    assert client.hub.snapshot["library"]["owed"] == {"WS-P": [item["id"]]}
    monkeypatch.setattr(actions, "execute", lambda a, p, s: {"ok": True, "output": ""})
    r = client.post("/api/actions", json={"action": "library_send", "params": {"station_id": "WS-P", "item_ids": item["id"]}},
                    headers=GOOD)
    assert r.status_code == 200
    assert [d["station_id"] for d in lib.load()["deliveries"]] == ["WS-P"]
    assert client.hub.snapshot["library"]["owed"] == {}
    monkeypatch.setattr(actions, "execute", lambda a, p, s: {"ok": False, "output": "", "error": "x"})
    client.post("/api/actions", json={"action": "library_send", "params": {"station_id": "WS-P", "item_ids": item["id"]}},
                headers=GOOD)
    assert len(lib.load()["deliveries"]) == 1
