"""FastAPI app: background collectors → snapshot → WebSocket/REST; guarded actions."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import actions, config, library
from .collectors import Collectors
from .events import EventLog
from .history import HistoryStore, parse_when
from .conversation import history_summary, read_conversation, search_history
from .terminals import TerminalError, TerminalManager, describe, resolve_preset
from .snapshot import build_snapshot, stable_view
from .world import ACKABLE, PhaseMemory, enrich

log = logging.getLogger(__package__)
HEARTBEAT_S = 15.0


class Hub:
    def __init__(self, collectors: Collectors | None = None):
        self.collectors = collectors or Collectors()
        self.snapshot: dict = build_snapshot({}, {}, time.time())
        self.clients: set[WebSocket] = set()
        self.subs: dict[WebSocket, dict] = {}
        self.acks: set[str] = set()
        self.terminals = TerminalManager(log=lambda a, p, r: actions.log_action(a, p, r))
        self._reaped_at = 0.0
        self.memory = PhaseMemory()
        self.events = EventLog()
        self.history = None
        if config.HISTORY_ENABLED:
            try:
                self.history = HistoryStore(config.HISTORY_DB, config.HISTORY_RETENTION_DAYS)
            except Exception:  # noqa: BLE001 - history is optional; the floor still runs without it
                log.exception("history store unavailable")
        self._digest = ""
        self._sent_at = 0.0
        self._dirty = True
        self._tasks: set[asyncio.Task] = set()

    def rebuild(self) -> bool:
        now = time.time()
        try:
            data = self.collectors.data()
            snap = enrich(build_snapshot(data, self.collectors.health(now), now), data, now, self.memory, self.acks)
            self.attach_library(snap)
            self.events.observe(snap, now, baseline=not self.warm())
            if self.history:
                self.history.record(snap, self.events.last_new, now)
        except Exception:  # noqa: BLE001 - keep serving the last good snapshot
            log.exception("snapshot build failed")
            return False
        digest = hashlib.sha1(json.dumps(stable_view(snap), sort_keys=True, default=str).encode()).hexdigest()
        changed = digest != self._digest
        self.snapshot, self._digest = snap, digest
        return changed

    def attach_library(self, snap: dict) -> None:
        try:
            snap["library"] = library.snapshot_field(library.current(), snap)
        except Exception:  # noqa: BLE001 - a bad library file must not cost the floor its snapshot
            log.exception("library field failed")
            snap["library"] = {"items": 0, "owed": {}}

    def refresh_library(self) -> None:
        """Library writes change `owed` at once; recompute it on the current snapshot and push."""
        self.attach_library(self.snapshot)
        self._dirty = True
        self._digest = ""

    def warm(self) -> bool:
        """Every source has answered at least once (data or error)."""
        sources = getattr(self.collectors, "sources", {}) or {}
        return all(src.updated_at or src.error for src in sources.values())

    def station(self, station_id: str) -> dict | None:
        return next((s for s in [*self.snapshot.get("stations", []), *self.snapshot.get("utility_stations", [])]
                     if s["id"] == station_id or s.get("ref") == station_id), None)

    def transcript_path(self, station: dict | None) -> str | None:
        sid = station and station.get("session_id")
        st = self.collectors.transcripts.sessions.get(sid) if sid and hasattr(self.collectors, "transcripts") else None
        return st.path if st else None

    async def subscribe(self, ws: WebSocket, station_id: str | None) -> None:
        station = self.station(station_id) if station_id else None
        path = self.transcript_path(station)
        if not station:
            self.subs.pop(ws, None)
            return
        last_ts, size = None, None
        if path:
            convo = await asyncio.to_thread(read_conversation, path, 1)
            last_ts = convo["turns"][-1]["ts"] if convo["turns"] else None
            size = Path(path).stat().st_size
        self.subs[ws] = {"station_id": station["id"], "path": path, "size": size, "last_ts": last_ts}

    async def push_turns(self) -> None:
        for ws, sub in list(self.subs.items()):
            path = sub.get("path")
            if not path:
                continue
            try:
                size = Path(path).stat().st_size
            except OSError:
                continue
            if size == sub["size"]:
                continue
            sub["size"] = size
            convo = await asyncio.to_thread(read_conversation, path, 10)
            fresh = [t for t in convo["turns"] if sub["last_ts"] is None or (t["ts"] or 0) > sub["last_ts"]]
            for turn in fresh:
                try:
                    await ws.send_text(json.dumps({"type": "turn", "station_id": sub["station_id"], "turn": turn}))
                except Exception:  # noqa: BLE001
                    self.subs.pop(ws, None)
                    break
                sub["last_ts"] = turn["ts"] or sub["last_ts"]

    async def _collect(self, source) -> None:
        if await asyncio.to_thread(source.collect):
            self._dirty = True

    async def run(self) -> None:
        while True:
            now = time.time()
            for s in self.collectors.sources.values():
                if s.due(now):
                    s.running = True
                    t = asyncio.create_task(self._collect(s))
                    self._tasks.add(t)
                    t.add_done_callback(self._tasks.discard)
            heartbeat = now - self._sent_at >= HEARTBEAT_S
            if self._dirty or heartbeat:
                self._dirty = False
                changed = self.rebuild()
                if changed or heartbeat:
                    await self.broadcast()
            if self.subs:
                await self.push_turns()
            if now - self._reaped_at > 60:
                self._reaped_at = now
                self.terminals.reap(now)
            await asyncio.sleep(0.5)

    async def broadcast(self) -> None:
        self._sent_at = time.time()
        if not self.clients:
            return
        msg = json.dumps(self.snapshot, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=5)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


def origin_allowed(origin: str | None, *, required: bool) -> bool:
    if origin is None:
        return not required
    return origin in config.ALLOWED_ORIGINS


def apply_skill_update(body) -> tuple[list[str], list[str], dict[str, dict]]:
    """Validate one skill's settings change and return the new (expose, hide, settings)."""
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    name = str(body.get("skill") or "").lstrip("/")
    if not actions.SKILL_NAME_RE.fullmatch(name):
        raise ValueError("skill must be a skill name")
    expose, hide = list(config.SKILLS_EXPOSE), list(config.SKILLS_HIDE)
    settings = {k: dict(v) for k, v in config.SKILL_SETTINGS.items()}
    for key, lst in (("expose", expose), ("hide", hide)):
        if key in body:
            if not isinstance(body[key], bool):
                raise ValueError(f"{key} must be true or false")
            if body[key] and name not in lst:
                lst.append(name)
            elif not body[key] and name in lst:
                lst.remove(name)
    cur = settings.setdefault(name, {})
    if "pin" in body:
        if not isinstance(body["pin"], bool):
            raise ValueError("pin must be true or false")
        cur["pin"] = body["pin"]
    if "confirm" in body:
        if body["confirm"] not in config.SKILL_CONFIRM_LEVELS:
            raise ValueError(f"confirm must be one of {', '.join(config.SKILL_CONFIRM_LEVELS)}")
        cur["confirm"] = body["confirm"]
    if "placement" in body:
        if body["placement"] in (None, ""):
            cur.pop("placement", None)
        elif body["placement"] not in config.SKILL_PLACEMENTS:
            raise ValueError(f"placement must be one of {', '.join(config.SKILL_PLACEMENTS)}")
        else:
            cur["placement"] = body["placement"]
    for key, limit in (("target", 100), ("args_template", 2000)):
        if key in body:
            v = body[key]
            if v in (None, ""):
                cur.pop(key, None)
                continue
            if not isinstance(v, str) or len(v) > limit or any(ord(c) < 32 for c in v):
                raise ValueError(f"{key} must be one line under {limit} characters")
            if key == "args_template":
                bad = sorted({t for t in actions.TOKEN_RE.findall(v) if t not in actions.SKILL_TOKENS})
                if bad:
                    raise ValueError(f"unknown token(s): {', '.join('{' + t + '}' for t in bad)}")
            cur[key] = v
    if not cur:
        settings.pop(name)
    return expose, hide, settings


def create_app(hub: Hub | None = None, *, start_loop: bool = True, testing: bool = False) -> FastAPI:
    hub = hub or Hub()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(hub.run()) if start_loop else None
        if start_loop and hub.history:
            hub.history.start()
            if config.HISTORY_BACKFILL_DAYS > 0:
                import threading
                from . import adapters as adapters_mod, backfill
                threading.Thread(target=lambda: log.info("history backfill queued %s events", backfill.run(
                    hub.history, adapters_mod.current(), config.HISTORY_BACKFILL_DAYS)),
                    name="history-backfill", daemon=True).start()
        yield
        hub.terminals.close_all()
        if hub.history:
            await asyncio.to_thread(hub.history.stop)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Shufler daemon", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.hub = hub
    # DNS-rebinding guard: only loopback host names.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", *(["testserver"] if testing else [])])

    def _domain_source(snap: dict, target: str) -> dict | None:
        kind, _, ref = target.partition(":")
        items = snap.get("stations", []) if kind == "station" else snap.get("workpieces", [])
        key, val = ("id", ref) if kind == "station" else ("id", target)
        hit = next((x for x in items if x.get(key) == val), None)
        return {k: hit.get(k) for k in ("domain", "domain_source", "domain_reason")} if hit else None

    def ack(params: dict) -> dict:
        kind, rid = (params or {}).get("kind"), (params or {}).get("id")
        if kind not in ACKABLE:
            return {"ok": False, "output": "", "error": f"only {', '.join(ACKABLE)} rows can be acknowledged"}
        if not isinstance(rid, str) or not rid.startswith(f"{kind}:"):
            return {"ok": False, "output": "", "error": "id must be the your_move row id"}
        hub.acks.add(rid)
        return {"ok": True, "output": f"hidden {rid} until the daemon restarts", "error": None}

    @app.get("/api/snapshot")
    async def get_snapshot():
        return JSONResponse(hub.snapshot)

    @app.get("/api/your_move")
    async def your_move():
        return {"your_move": hub.snapshot.get("your_move", []), "your_move_count": hub.snapshot.get("your_move_count", 0)}

    @app.get("/api/health")
    async def health():
        return {"ok": True, "sources": hub.snapshot.get("sources"), "clients": len(hub.clients)}

    def _conversation_args(request: Request) -> dict:
        q = request.query_params
        before = q.get("before")
        return {"n": int(q.get("n", 20)) if q.get("n", "20").isdigit() else 20,
                "before": float(before) if before and before.replace(".", "", 1).isdigit() else None,
                "results": q.get("results") in ("1", "true", "yes")}

    @app.get("/api/stations/{station_id}/conversation")
    async def station_conversation(station_id: str, request: Request):
        station = hub.station(station_id)
        if not station:
            return JSONResponse({"error": f"unknown station {station_id}"}, status_code=404)
        path = hub.transcript_path(station)
        if not path:
            return {"turns": [], "has_more": False, "error": "no transcript for this station's session"}
        return await asyncio.to_thread(read_conversation, path, **_conversation_args(request))

    @app.get("/api/workpieces/{pr}/conversation")
    async def workpiece_conversation(pr: int, request: Request):
        wp = next((w for w in hub.snapshot.get("workpieces", []) if w["pr"] == pr), None)
        if not wp:
            return JSONResponse({"error": f"#{pr} is not on the floor"}, status_code=404)
        path = hub.transcript_path(hub.station(wp["station_id"])) if wp.get("station_id") else None
        if not path:
            return {"turns": [], "has_more": False, "station_id": wp.get("station_id"),
                    "error": "no station session owns this PR"}
        out = await asyncio.to_thread(read_conversation, path, pr=pr, **_conversation_args(request))
        out["station_id"] = wp["station_id"]
        return out

    @app.get("/api/stations/{station_id}/history/search")
    async def history_search(station_id: str, q: str = ""):
        station = hub.station(station_id)
        if not station:
            return JSONResponse({"error": f"unknown station: {station_id}"}, status_code=404)
        path = hub.transcript_path(station)
        if not path:
            return JSONResponse({"error": "no transcript for this station"}, status_code=404)
        return await asyncio.to_thread(search_history, path, q)

    @app.get("/api/stations/{station_id}/history/summary")
    async def history_summary_ep(station_id: str):
        station = hub.station(station_id)
        if not station:
            return JSONResponse({"error": f"unknown station: {station_id}"}, status_code=404)
        path = hub.transcript_path(station)
        if not path:
            return JSONResponse({"error": "no transcript for this station"}, status_code=404)
        return await asyncio.to_thread(history_summary, path, station.get("session_id"))

    @app.get("/api/terminals")
    async def list_terminals():
        return {"terminals": hub.terminals.list()}

    @app.post("/api/terminals")
    async def open_terminal(request: Request):
        if not origin_allowed(request.headers.get("origin"), required=True):
            return JSONResponse({"ok": False, "error": "origin not allowed"}, status_code=403)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = {}
        body = body if isinstance(body, dict) else {}
        station = hub.station(body["station_id"]) if body.get("station_id") else None
        if body.get("station_id") and not station:
            return JSONResponse({"ok": False, "error": "unknown station"}, status_code=404)
        try:
            pr = int(body["pr"]) if body.get("pr") else None
            cwd, prefill = resolve_preset(body.get("preset"), station, body.get("cwd"), pr)
            actions.never_do_check(prefill)
            term = hub.terminals.spawn(cwd, prefill, body.get("preset"), station and station["id"])
        except (TerminalError, actions.ActionError, ValueError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=422)
        return {"ok": True, **term.info(), "command": describe(cwd, prefill)}

    @app.delete("/api/terminals/{term_id}")
    async def delete_terminal(term_id: str, request: Request):
        if not origin_allowed(request.headers.get("origin"), required=True):
            return JSONResponse({"ok": False, "error": "origin not allowed"}, status_code=403)
        ok = hub.terminals.close(term_id, reason="closed by user")
        return JSONResponse({"ok": ok}, status_code=200 if ok else 404)

    @app.websocket("/term/{term_id}")
    async def term_ws(ws: WebSocket, term_id: str):
        if not origin_allowed(ws.headers.get("origin"), required=True):
            await ws.close(code=1008)
            return
        term = hub.terminals.terms.get(term_id)
        if not term:
            await ws.close(code=4404)
            return
        await ws.accept()
        term.sockets.add(ws)
        try:
            if term.scrollback:
                await ws.send_bytes(bytes(term.scrollback))
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    hub.terminals.write(term_id, msg["bytes"])
                elif msg.get("text"):
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        hub.terminals.write(term_id, msg["text"].encode())
                        continue
                    if isinstance(data, dict) and data.get("type") == "resize":
                        hub.terminals.resize(term_id, data.get("cols", 80), data.get("rows", 24))
                    elif isinstance(data, dict) and data.get("type") == "input":
                        hub.terminals.write(term_id, str(data.get("data", "")).encode())
        except WebSocketDisconnect:
            pass
        finally:
            term.sockets.discard(ws)

    @app.get("/api/actions/preview")
    async def actions_preview(request: Request):
        q: dict[str, Any] = dict(request.query_params)
        action = q.pop("action", "")
        if "raw" in q:
            q["raw"] = q["raw"] in ("1", "true", "yes")
        if isinstance(q.get("context"), str):
            try:
                q["context"] = json.loads(q["context"])
            except json.JSONDecodeError:
                return JSONResponse({"command": None, "warnings": [], "error": "context must be JSON"}, status_code=400)
        try:
            return actions.preview(action, q, hub.snapshot)
        except actions.ActionError as e:
            return JSONResponse({"command": None, "warnings": [], "error": str(e)}, status_code=400)

    @app.post("/api/actions/preview")
    async def actions_preview_post(request: Request):
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = None
        if not isinstance(body, dict):
            return JSONResponse({"command": None, "warnings": [], "error": "body must be a JSON object"}, status_code=400)
        params = body.get("params")
        if params is None:
            params = {k: v for k, v in body.items() if k != "action"}
        try:
            return actions.preview(body.get("action", ""), params, hub.snapshot)
        except actions.ActionError as e:
            return JSONResponse({"command": None, "warnings": [], "error": str(e)}, status_code=400)

    @app.get("/api/config/skills")
    async def get_skill_config():
        return {"expose": config.SKILLS_EXPOSE, "hide": config.SKILLS_HIDE, "skills": config.SKILL_SETTINGS,
                "config_file": str(config.CONFIG_FILE),
                "writable": config.CONFIG_FILE.resolve() != config.EXAMPLE_CONFIG.resolve()}

    @app.post("/api/config/skills")
    async def post_skill_config(request: Request):
        if not origin_allowed(request.headers.get("origin"), required=True):
            return JSONResponse({"ok": False, "error": "origin not allowed"}, status_code=403)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = None
        try:
            expose, hide, settings = apply_skill_update(body)
            path = await asyncio.to_thread(config.save_skills, expose, hide, settings)
        except (ValueError, PermissionError) as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400 if isinstance(e, ValueError) else 409)
        actions.log_action("config_skills", body, {"ok": True, "config_file": str(path)})
        hub._dirty = True
        hub._digest = ""
        return {"ok": True, "expose": config.SKILLS_EXPOSE, "hide": config.SKILLS_HIDE, "skills": config.SKILL_SETTINGS}

    # ------------------------------------------------------------ context library (design/LIBRARY.md)
    def _guard(request: Request, required: bool = True) -> JSONResponse | None:
        if not origin_allowed(request.headers.get("origin"), required=required):
            return JSONResponse({"ok": False, "error": "origin not allowed"}, status_code=403)
        return None

    async def _body(request: Request):
        try:
            return await request.json()
        except json.JSONDecodeError:
            return None

    def _lib_write(fn, *args) -> JSONResponse:
        try:
            out = fn(*args)
        except library.LibraryError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        except OSError as e:
            return JSONResponse({"ok": False, "error": f"could not write the library: {e}"}, status_code=500)
        hub.refresh_library()
        return JSONResponse({"ok": True, "result": out})

    @app.get("/api/library")
    async def get_library(request: Request):
        if (bad := _guard(request, required=False)):
            return bad
        view = await asyncio.to_thread(library.current().view)
        view["owed"] = (hub.snapshot.get("library") or {}).get("owed", {})
        return view

    @app.post("/api/library/items")
    async def post_library_item(request: Request):
        if (bad := _guard(request)):
            return bad
        body = await _body(request)
        resp = _lib_write(library.current().upsert_item, body)
        actions.log_action("library_item", body if isinstance(body, dict) else {}, {"ok": resp.status_code == 200})
        return resp

    @app.delete("/api/library/items/{item_id}")
    async def delete_library_item(item_id: str, request: Request):
        if (bad := _guard(request)):
            return bad
        if not library.current().delete_item(item_id):
            return JSONResponse({"ok": False, "error": f"no library item {item_id}"}, status_code=404)
        hub.refresh_library()
        actions.log_action("library_item_delete", {"id": item_id}, {"ok": True})
        return {"ok": True}

    @app.post("/api/library/grants")
    async def post_library_grant(request: Request):
        if (bad := _guard(request)):
            return bad
        body = await _body(request)
        resp = _lib_write(library.current().add_grant, body)
        actions.log_action("library_grant", body if isinstance(body, dict) else {}, {"ok": resp.status_code == 200})
        return resp

    @app.delete("/api/library/grants/{grant_id}")
    async def delete_library_grant(grant_id: str, request: Request):
        if (bad := _guard(request)):
            return bad
        if not library.current().delete_grant(grant_id):
            return JSONResponse({"ok": False, "error": f"no grant {grant_id}"}, status_code=404)
        hub.refresh_library()
        actions.log_action("library_grant_delete", {"id": grant_id}, {"ok": True})
        return {"ok": True}

    @app.get("/api/library/browse")
    async def library_browse(request: Request, path: str = "", hidden: str = ""):
        if (bad := _guard(request, required=False)):
            return bad
        try:
            return await asyncio.to_thread(library.browse, path, library.roots(hub.snapshot), hidden in ("1", "true", "yes"))
        except library.LibraryError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    @app.post("/api/library/resolve")
    async def library_resolve(request: Request):
        if (bad := _guard(request)):
            return bad
        body = await _body(request)
        entries = body.get("entries", body.get("names")) if isinstance(body, dict) else body
        try:
            return {"results": await asyncio.to_thread(library.resolve, entries, hub.snapshot)}
        except library.LibraryError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    @app.post("/api/actions")
    async def post_action(request: Request):
        if not origin_allowed(request.headers.get("origin"), required=True):
            return JSONResponse({"ok": False, "output": "", "error": "origin not allowed"}, status_code=403)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return JSONResponse({"ok": False, "output": "", "error": "body must be JSON"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"ok": False, "output": "", "error": "body must be an object"}, status_code=400)
        action = body.get("action", "")
        params = body.get("params")
        if params is None:
            params = {k: v for k, v in body.items() if k != "action"}
        if action == "ack":
            result = ack(params)
            actions.log_action(action, params, result)
            if result["ok"]:
                hub._dirty = True
                hub._digest = ""
            return JSONResponse(result, status_code=200 if result["ok"] else 422)
        if action == "set_domain":
            result = await asyncio.to_thread(actions.apply_set_domain, params, hub.snapshot)
            actions.log_action(action, params, result)
            if result["ok"]:
                hub._digest = ""
                hub.rebuild()
                await hub.broadcast()
                result["domain_source"] = _domain_source(hub.snapshot, str(params.get("target") or ""))
            return JSONResponse(result, status_code=200 if result["ok"] else 422)
        result = await asyncio.to_thread(actions.execute, action, params, hub.snapshot)
        if action == "library_send" and result.get("ok"):
            station = hub.station(str(params.get("station_id") or ""))
            if station:
                library.current().record_delivery(library.parse_item_ids(params.get("item_ids")), station)
                hub.refresh_library()
        hub._dirty = True
        for name in ("terminal", "notes", "gh"):
            src = hub.collectors.sources.get(name)
            if src and action not in ("open_pr", "open_preview", "focus"):
                src.last_attempt = 0  # refresh soon so the floor reflects the lever
        return JSONResponse(result, status_code=200 if result.get("ok") else 422)

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        if not origin_allowed(ws.headers.get("origin"), required=False):
            await ws.close(code=1008)
            return
        await ws.accept()
        hub.clients.add(ws)
        try:
            await ws.send_text(json.dumps(hub.snapshot, default=str))
            while True:
                msg = await ws.receive_text()
                if msg.strip() == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))
                    continue
                try:
                    data = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                if isinstance(data, dict) and data.get("type") == "subscribe":
                    await hub.subscribe(ws, data.get("station_id"))
                    await ws.send_text(json.dumps({"type": "subscribed", "station_id": (hub.subs.get(ws) or {}).get("station_id")}))
                elif isinstance(data, dict) and data.get("type") == "unsubscribe":
                    hub.subs.pop(ws, None)
                elif isinstance(data, dict) and data.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(ws)
            hub.subs.pop(ws, None)

    @app.get("/api/history/range")
    async def history_range(request: Request):
        if not hub.history:
            return JSONResponse({"error": "history is off (config [history])"}, status_code=404)
        q = request.query_params
        start, end = parse_when(q.get("from")), parse_when(q.get("to")) or time.time()
        if start is None:
            return JSONResponse({"error": "from is required (epoch seconds or ISO 8601)"}, status_code=400)
        if end < start:
            return JSONResponse({"error": "to is before from"}, status_code=400)
        return await asyncio.to_thread(hub.history.range, start, end)

    @app.get("/api/history/days")
    async def history_days():
        if not hub.history:
            return JSONResponse({"error": "history is off (config [history])"}, status_code=404)
        return {"days": await asyncio.to_thread(hub.history.days)}

    @app.get("/api/config")
    async def get_config():
        from .world import load_domains
        presets = [{"name": "shell_here", "command": "", "cwd": None, "needs_pr": False}]
        presets += [{"name": k, "command": v.get("command"), "cwd": v.get("cwd") or None,
                     "needs_pr": "{pr}" in (v.get("command") or "")}
                    for k, v in sorted(config.TERMINAL_PRESETS.items()) if v.get("command")]
        skills = [sk for sk in hub.snapshot.get("skills") or [] if sk.get("exposed") or sk.get("pinned")]
        return {"product": config.PRODUCT_NAME, "canned_prompts": list(config.CANNED_DISPATCH),
                "postmerge_prompt": config.POSTMERGE_PROMPT, "domains": load_domains(),
                "presets": presets if config.TERMINALS_ENABLED else [], "skills": skills,
                "pipeline_stages": list(config.PHASES), "board_stages": list(config.BOARD_STAGES) if config.BOARD_CMD else [],
                "capabilities": config.capabilities()}

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def api_not_found(rest: str):
        return JSONResponse({"error": f"no such endpoint: /api/{rest}"}, status_code=404)

    @app.get("/{path:path}")
    async def static(path: str):
        if path in ("ws", "term") or path.startswith(("ws/", "term/")):
            return JSONResponse({"error": "WebSocket endpoint; connect with ws://"}, status_code=426)
        dist: Path = config.WEB_DIST
        index = dist / "index.html"
        if not index.is_file():
            return PlainTextResponse(
                "Shufler daemon is running, but the web build is missing.\n"
                + ("This install has no web build; reinstall from a release wheel (see the README).\n" if config.INSTALLED
                   else f"Build it with: cd {config.ROOT / 'web'} && bun install && bun run build\n")
                + "API: /api/snapshot  WebSocket: /ws\n",
                status_code=503,
            )
        if path:
            target = (dist / path).resolve()
            if target.is_relative_to(dist.resolve()) and target.is_file():
                # hashed build assets never change; everything else revalidates so a rebuild shows on reload
                immutable = path.startswith("assets/")
                return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"})
            if path.startswith(("api/", "assets/")):
                return PlainTextResponse("not found", status_code=404)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
