"""Context library: named references to files and folders, granted to sessions, domains or everyone.

Items point at live paths; nothing is copied. A grant makes an item available to a target
(`station:<id>`, `domain:<id>` or `all`), pinned (always) or once. Deliveries record each successful
`library_send`, so the snapshot can say which pinned context a session has not received yet.
Stored as JSON next to config.toml, written atomically.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable

from . import config

ID_RE = re.compile(r"lib_[0-9a-f]{8}")
GRANT_ID_RE = re.compile(r"gr_[0-9a-f]{8}")
TARGET_RE = re.compile(r"all|(station|domain):[A-Za-z0-9_.:-]{1,100}")
TAG_RE = re.compile(r"[a-z0-9][a-z0-9_.:-]{0,39}")
MODES = ("pinned", "once")
MAX_ITEMS, MAX_PATHS, MAX_TAGS, MAX_DELIVERIES = 500, 50, 20, 500
WALK_CAP = 5000  # entries counted per folder before the status says "5000+"
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "tmp", "log", "vendor", ".cache", "dist", "build"}


class LibraryError(ValueError):
    pass


def _empty() -> dict:
    return {"version": 1, "items": [], "grants": [], "deliveries": []}


def _line(v: Any, key: str, limit: int, required: bool = False) -> str:
    if v is None or v == "":
        if required:
            raise LibraryError(f"{key} is required")
        return ""
    if not isinstance(v, str) or len(v) > limit or any(ord(c) < 32 for c in v):
        raise LibraryError(f"{key} must be one line under {limit} characters")
    if required and not v.strip():
        raise LibraryError(f"{key} is required")
    return v.strip()


def expand(p: str) -> str:
    """`~` means config.HOME (the same home the browse fence uses)."""
    return str(config.HOME) + p[1:] if p == "~" or p.startswith("~/") else p


def norm_path(raw: Any) -> str:
    """An absolute, normalised path (`~` expanded). Items may point anywhere; browse/resolve are the fenced ones."""
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw or len(raw) > 4096:
        raise LibraryError("each path must be a non-empty string")
    if any(ord(c) < 32 or c == "\x7f" for c in raw):
        raise LibraryError("a path must not contain control characters such as newlines")
    p = expand(raw.strip())
    if not os.path.isabs(p):
        raise LibraryError(f"path must be absolute: {raw}")
    return os.path.normpath(p)


def path_status(path: str) -> dict:
    """Checked at read time: exists, file or folder, size, and file count for folders (capped)."""
    out: dict[str, Any] = {"path": path, "exists": False, "kind": None, "size": None, "files": None, "truncated": False}
    try:
        st = os.stat(path)
    except OSError:
        return out
    out["exists"] = True
    if os.path.isfile(path):
        out.update(kind="file", size=st.st_size)
        return out
    if not os.path.isdir(path):
        out["kind"] = "other"
        return out
    size = files = seen = 0
    stack = [path]
    while stack and seen < WALK_CAP:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    seen += 1
                    if seen >= WALK_CAP:
                        out["truncated"] = True
                        break
                    try:
                        if e.is_dir(follow_symlinks=False):
                            if e.name not in SKIP_DIRS:
                                stack.append(e.path)
                        elif e.is_file(follow_symlinks=False):
                            files += 1
                            size += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    out.update(kind="dir", size=size, files=files)
    return out


class Library:
    """The library.json store. Reads follow the file's mtime, so CLI or hand edits show up."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._data = _empty()
        self._mtime: float | None = None
        self.error: str | None = None

    # ------------------------------------------------------------ io
    def load(self) -> dict:
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                self._data, self._mtime, self.error = _empty(), None, None
                return self._data
            if mtime == self._mtime:
                return self._data
            try:
                raw = json.loads(self.path.read_text())
                if not isinstance(raw, dict):
                    raise ValueError("not an object")
                data = _empty()
                for k in ("items", "grants", "deliveries"):
                    data[k] = [x for x in raw.get(k) or [] if isinstance(x, dict)]
                self._data, self.error = data, None
            except (OSError, ValueError) as e:
                # keep serving an empty library; the first write sets the bad file aside instead of losing it
                self._data, self.error = _empty(), f"library.json unreadable: {e}"
            self._mtime = mtime
            return self._data

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.error and self.path.exists():
            self.path.replace(self.path.with_name(f"library.json.corrupt-{int(time.time())}"))
        tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n")
        tmp.replace(self.path)
        self._data, self.error = data, None
        try:
            self._mtime = self.path.stat().st_mtime
        except OSError:
            self._mtime = None

    def _mutate(self, fn: Callable[[dict], Any]) -> Any:
        with self._lock:
            data = json.loads(json.dumps(self.load()))
            out = fn(data)
            self._save(data)
            return out

    # ------------------------------------------------------------ reads
    def item(self, item_id: str) -> dict | None:
        return next((i for i in self.load()["items"] if i.get("id") == item_id), None)

    def view(self, deliveries: int = 100) -> dict:
        d = self.load()
        items = [{**i, "status": [path_status(p) for p in i.get("paths") or []]} for i in d["items"]]
        return {"items": items, "grants": list(d["grants"]), "deliveries": d["deliveries"][-deliveries:],
                "file": str(self.path), "error": self.error}

    # ------------------------------------------------------------ writes
    def upsert_item(self, body: Any) -> dict:
        if not isinstance(body, dict):
            raise LibraryError("body must be a JSON object")
        name = _line(body.get("name"), "name", 120, required=True)
        desc = body.get("description") or ""
        if not isinstance(desc, str) or len(desc) > 2000:
            raise LibraryError("description must be text under 2000 characters")
        paths = body.get("paths")
        if not isinstance(paths, list) or not paths or len(paths) > MAX_PATHS:
            raise LibraryError(f"paths must be a list of 1 to {MAX_PATHS} absolute paths")
        paths = list(dict.fromkeys(norm_path(p) for p in paths))
        tags = body.get("tags") or []
        if isinstance(tags, str):
            tags = [t for t in re.split(r"[,\s]+", tags) if t]
        if not isinstance(tags, list) or len(tags) > MAX_TAGS:
            raise LibraryError(f"tags must be a list of at most {MAX_TAGS}")
        tags = list(dict.fromkeys(str(t).strip().lower() for t in tags))
        bad = [t for t in tags if not TAG_RE.fullmatch(t)]
        if bad:
            raise LibraryError(f"tags may use a-z, 0-9 and _ . : - (bad: {', '.join(bad)})")
        item_id = body.get("id")
        if item_id is not None and (not isinstance(item_id, str) or not ID_RE.fullmatch(item_id)):
            raise LibraryError("id must look like lib_0123abcd")

        def fn(data: dict) -> dict:
            now = time.time()
            cur = next((i for i in data["items"] if i.get("id") == item_id), None) if item_id else None
            if item_id and not cur:
                raise LibraryError(f"no library item {item_id}")
            if cur:
                cur.update(name=name, description=desc.strip(), paths=paths, tags=tags, updated=now)
                return cur
            if len(data["items"]) >= MAX_ITEMS:
                raise LibraryError(f"the library holds at most {MAX_ITEMS} items")
            new = {"id": f"lib_{secrets.token_hex(4)}", "name": name, "description": desc.strip(), "paths": paths,
                   "tags": tags, "created": now, "updated": now}
            data["items"].append(new)
            return new
        return self._mutate(fn)

    def delete_item(self, item_id: str) -> bool:
        def fn(data: dict) -> bool:
            before = len(data["items"])
            data["items"] = [i for i in data["items"] if i.get("id") != item_id]
            data["grants"] = [g for g in data["grants"] if g.get("item_id") != item_id]
            return len(data["items"]) < before
        return self._mutate(fn) if self.item(item_id) else False

    def add_grant(self, body: Any) -> dict:
        if not isinstance(body, dict):
            raise LibraryError("body must be a JSON object")
        item_id, target, mode = body.get("item_id"), body.get("target"), body.get("mode") or "pinned"
        if not isinstance(target, str) or not TARGET_RE.fullmatch(target):
            raise LibraryError("target must be all, station:<id> or domain:<id>")
        if mode not in MODES:
            raise LibraryError(f"mode must be one of {', '.join(MODES)}")
        if not isinstance(item_id, str) or not self.item(item_id):
            raise LibraryError(f"no library item {item_id!r}")

        def fn(data: dict) -> dict:
            cur = next((g for g in data["grants"] if g.get("item_id") == item_id and g.get("target") == target), None)
            if cur:  # one grant per item and target; granting again changes its mode
                cur.update(mode=mode, created=time.time())
                return cur
            g = {"id": f"gr_{secrets.token_hex(4)}", "item_id": item_id, "target": target, "mode": mode,
                 "created": time.time()}
            data["grants"].append(g)
            return g
        return self._mutate(fn)

    def delete_grant(self, grant_id: str) -> bool:
        if not any(g.get("id") == grant_id for g in self.load()["grants"]):
            return False

        def fn(data: dict) -> bool:
            data["grants"] = [g for g in data["grants"] if g.get("id") != grant_id]
            return True
        return self._mutate(fn)

    def record_delivery(self, item_ids: list[str], station: dict, ts: float | None = None) -> None:
        tel = station.get("telemetry") or {}

        def fn(data: dict) -> None:
            now = ts or time.time()
            for iid in item_ids:
                data["deliveries"].append({"item_id": iid, "station_id": station.get("id"),
                                           "session_id": station.get("session_id"),
                                           "compactions": tel.get("compactions"), "ts": now})
            data["deliveries"] = data["deliveries"][-MAX_DELIVERIES:]
        self._mutate(fn)


# ---------------------------------------------------------------- owed (pure)

def grant_matches(target: str, station: dict, *, utility: bool = False) -> bool:
    if target == f"station:{station.get('id')}":
        return True
    if utility:  # SHARED / CODEX style tools only take explicit station grants
        return False
    if target == "all":
        return True
    return bool(station.get("domain")) and target == f"domain:{station.get('domain')}"


def _started(station: dict) -> float | None:
    v = (station.get("telemetry") or {}).get("session_started_at")
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        from .transcripts import parse_ts
        return parse_ts(v)
    return None


def delivery_current(d: dict, station: dict) -> bool:
    """A delivery counts while the station is still on the same session, started before it, and not compacted since."""
    sid = station.get("session_id")
    if sid and d.get("session_id") and d["session_id"] != sid:
        return False
    started = _started(station)
    if started and (d.get("ts") or 0) < started:
        return False
    comp = (station.get("telemetry") or {}).get("compactions")
    if isinstance(comp, int) and comp > (d.get("compactions") or 0):
        return False
    return True


def owed(data: dict, stations: list[dict], utility_stations: list[dict] | None = None) -> dict[str, list[str]]:
    """Per station, the granted items it has not received: pinned until a current delivery, once until any
    delivery after the grant. Stations with no running Claude owe nothing (nobody to read it)."""
    items = {i.get("id") for i in data.get("items") or []}
    grants = [g for g in data.get("grants") or [] if g.get("item_id") in items]
    if not grants:
        return {}
    by_station: dict[str, list[dict]] = {}
    for d in data.get("deliveries") or []:
        by_station.setdefault(d.get("station_id"), []).append(d)
    out: dict[str, list[str]] = {}
    for st, util in [*((s, False) for s in stations), *((s, True) for s in utility_stations or [])]:
        claude = st.get("claude")
        if isinstance(claude, dict) and not claude.get("running"):
            continue
        mine = by_station.get(st.get("id"), [])
        want: list[str] = []
        for g in grants:
            iid = g["item_id"]
            if iid in want or not grant_matches(g.get("target", ""), st, utility=util):
                continue
            got = [d for d in mine if d.get("item_id") == iid]
            if g.get("mode") == "once":
                if any((d.get("ts") or 0) >= (g.get("created") or 0) for d in got):
                    continue
            elif any(delivery_current(d, st) for d in got):
                continue
            want.append(iid)
        if want:
            out[st["id"]] = want
    return out


def snapshot_field(lib: "Library", snap: dict) -> dict:
    data = lib.load()
    return {"items": len(data["items"]), "owed": owed(data, snap.get("stations") or [], snap.get("utility_stations") or [])}


# ---------------------------------------------------------------- message composition (pure, one adapter per harness)

def harness_for(station: dict) -> str:
    title = (station.get("title") or "").lower()
    if "codex" in title:
        return "codex"
    return config.AGENT_ADAPTER or "claude-code"


def _inside(path: str, root: str | None) -> bool:
    if not root:
        return False
    root = os.path.normpath(expand(root))
    return path == root or path.startswith(root.rstrip("/") + "/")


def _prompt(parts: list[str], note: str | None) -> str:
    body = "; ".join(parts)
    tail = f" {note.strip().rstrip('.')}." if note and note.strip() else ""
    return f"Context from the library: {body}.{tail} Read these before continuing."


def compose_claude_code(items: list[dict], cwd: str | None, note: str | None = None, kinds: dict[str, str] | None = None) -> list[str]:
    """`/add-dir` for each folder outside the session's cwd (outermost only), then one @-mention prompt."""
    kinds = kinds or {}
    dirs: list[str] = []
    for it in items:
        for p in it.get("paths") or []:
            kind = kinds.get(p) or ("dir" if os.path.isdir(p) else "file")
            if kind == "dir" and not _inside(p, cwd):
                dirs.append(p)
    dirs = [d for d in dict.fromkeys(dirs) if not any(o != d and _inside(d, o) for o in dirs)]

    def mention(p: str) -> str:
        rel = os.path.relpath(p, expand(cwd)) if _inside(p, cwd) and p != os.path.normpath(expand(cwd)) else p
        return f'@"{rel}"' if any(c.isspace() for c in rel) else f"@{rel}"
    parts = [f"{it.get('name')}: {' '.join(mention(p) for p in it.get('paths') or [])}" for it in items]
    return [*(f"/add-dir {d}" for d in dirs), _prompt(parts, note)]


def compose_plain(items: list[dict], cwd: str | None, note: str | None = None, kinds: dict[str, str] | None = None) -> list[str]:
    """Codex and other harnesses: plain absolute paths in one prompt."""
    parts = [f"{it.get('name')}: {' '.join(it.get('paths') or [])}" for it in items]
    return [_prompt(parts, note)]


HARNESSES: dict[str, Callable[..., list[str]]] = {
    "claude-code": compose_claude_code,
    "codex": compose_plain,
    "generic": compose_plain,
}


def compose(harness: str, items: list[dict], cwd: str | None, note: str | None = None, kinds: dict[str, str] | None = None) -> list[str]:
    return HARNESSES.get(harness, compose_plain)(items, cwd, note, kinds)


def parse_item_ids(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = [x for x in re.split(r"[,\s]+", raw) if x]
    if not isinstance(raw, list) or not raw:
        raise LibraryError("item_ids is required")
    ids = list(dict.fromkeys(str(x) for x in raw))
    if len(ids) > 20 or not all(ID_RE.fullmatch(x) for x in ids):
        raise LibraryError("item_ids must be 1 to 20 library ids")
    return ids


# ---------------------------------------------------------------- browse and resolve (fenced to home + session cwds)

def roots(snap: dict) -> list[str]:
    out = [str(config.HOME)]
    for s in [*(snap.get("stations") or []), *(snap.get("utility_stations") or [])]:
        if s.get("cwd"):
            out.append(expand(s["cwd"]))
    real = []
    for r in out:
        try:
            rp = os.path.realpath(r)
        except OSError:
            continue
        if os.path.isdir(rp) and rp not in real:
            real.append(rp)
    return real


def safe_path(raw: Any, allowed: list[str]) -> str:
    """Resolve `raw` (absolute or ~) and refuse `..` segments and anything outside the allowed roots,
    symlinks included (the check runs on the real path)."""
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw or len(raw) > 4096:
        raise LibraryError("path is required")
    s = raw.strip()
    if ".." in Path(s).parts:
        raise LibraryError("path may not contain ..")
    p = expand(s)
    if not os.path.isabs(p):
        raise LibraryError("path must be absolute (or start with ~)")
    real = os.path.realpath(p)
    if not any(real == r or real.startswith(r.rstrip("/") + "/") for r in allowed):
        raise LibraryError("outside home and the session working directories")
    return real


def browse(raw: str | None, allowed: list[str], hidden: bool = False, limit: int = 300) -> dict:
    """A read-only listing for the path picker. A path that is not a folder lists its parent filtered by the
    typed prefix, which is what autocomplete wants."""
    if not raw:
        return {"path": None, "parent": None, "roots": allowed,
                "entries": [{"name": r, "path": r, "kind": "dir"} for r in allowed]}
    s = raw.strip()
    prefix = ""
    target = safe_path(s, allowed) if os.path.isdir(expand(s)) else None
    if target is None:
        parent, prefix = os.path.split(expand(s))
        target = safe_path(parent or "/", allowed)
        if not os.path.isdir(target):
            raise LibraryError("no such folder")
    entries = []
    try:
        with os.scandir(target) as it:
            for e in it:
                if e.name.startswith(".") and not (hidden or prefix.startswith(".")):
                    continue
                if prefix and not e.name.lower().startswith(prefix.lower()):
                    continue
                try:
                    is_dir = e.is_dir()
                except OSError:
                    continue
                entries.append({"name": e.name, "path": os.path.join(target, e.name), "kind": "dir" if is_dir else "file"})
    except OSError as e:
        raise LibraryError(f"cannot list {target}: {e.strerror}") from None
    entries.sort(key=lambda x: (x["kind"] != "dir", x["name"].lower()))
    parent = os.path.dirname(target)
    return {"path": target, "prefix": prefix, "parent": parent if parent != target else None, "roots": allowed,
            "entries": entries[:limit], "truncated": len(entries) > limit}


def repo_root(path: str) -> str | None:
    cur = path
    for _ in range(20):
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        nxt = os.path.dirname(cur)
        if nxt == cur:
            return None
        cur = nxt
    return None


def search_roots(snap: dict) -> list[str]:
    """Session working directories and their repo roots; never all of home (too big to walk)."""
    home = os.path.realpath(str(config.HOME))
    out: list[str] = []
    for s in [*(snap.get("stations") or []), *(snap.get("utility_stations") or [])]:
        cwd = s.get("cwd")
        if not cwd:
            continue
        cwd = os.path.realpath(expand(cwd))
        if not os.path.isdir(cwd):
            continue
        for r in (cwd, repo_root(cwd)):
            if r and r != home and r not in out:
                out.append(r)
    return out


def _spec(raw: Any) -> dict:
    if isinstance(raw, str):
        raw = {"name": raw}
    if not isinstance(raw, dict):
        raise LibraryError("each entry must be a name or {name, kind, children}")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or "\x00" in name or len(name) > 1024:
        raise LibraryError("each entry needs a name")
    rel = name.strip().strip("/")
    if ".." in Path(rel).parts:
        raise LibraryError("names may not contain ..")
    kind = raw.get("kind") if raw.get("kind") in ("file", "dir") else None
    children = [c.strip("/") for c in (raw.get("children") or []) if isinstance(c, str) and c.strip("/")][:5]
    if any(".." in Path(c).parts for c in children):
        raise LibraryError("names may not contain ..")
    return {"name": rel, "kind": kind, "children": children}


def resolve(entries: Any, snap: dict, *, max_dirs: int = 20000, max_depth: int = 7, budget_s: float = 3.0) -> list[dict]:
    """Map dropped names or relative paths (`billing_notes`, `docs/a.md`) to absolute paths under the
    session working directories and their repo roots. One match: use it; several: the user picks; none: paste."""
    if not isinstance(entries, list) or not entries or len(entries) > 50:
        raise LibraryError("entries must be a list of 1 to 50 names")
    specs = [_spec(e) for e in entries]
    allowed = roots(snap)
    hits: dict[int, list[str]] = {i: [] for i in range(len(specs))}
    started, visited = time.monotonic(), 0
    for root in search_roots(snap):
        stack = [(root, 0)]
        while stack:
            if visited >= max_dirs or time.monotonic() - started > budget_s:
                break
            d, depth = stack.pop()
            visited += 1
            try:
                with os.scandir(d) as it:
                    names = list(it)
            except OSError:
                continue
            for e in names:
                try:
                    is_dir = e.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                for i, sp in enumerate(specs):
                    if e.name != os.path.basename(sp["name"]):
                        continue
                    if sp["kind"] and sp["kind"] != ("dir" if is_dir else "file"):
                        continue
                    if "/" in sp["name"] and not e.path.endswith("/" + sp["name"]):
                        continue
                    if is_dir and sp["children"] and not all(os.path.exists(os.path.join(e.path, c)) for c in sp["children"]):
                        continue
                    hits[i].append(e.path)
                if is_dir and depth < max_depth and not e.name.startswith(".") and e.name not in SKIP_DIRS:
                    stack.append((e.path, depth + 1))
    out = []
    for i, sp in enumerate(specs):
        seen: list[str] = []
        for h in hits[i]:
            try:
                real = safe_path(h, allowed)
            except LibraryError:
                continue
            if real not in seen:
                seen.append(real)
        seen = sorted(seen, key=len)[:20]
        out.append({"name": sp["name"], "kind": sp["kind"], "matches": seen,
                    "status": "one" if len(seen) == 1 else "many" if seen else "none"})
    return out


# ---------------------------------------------------------------- the process-wide store

_current: Library | None = None


def current() -> Library:
    global _current
    if _current is None:
        _current = Library(config.LIBRARY_FILE)
    return _current


def set_current(lib: Library | None) -> None:
    """Tests swap in a store under tmp_path."""
    global _current
    _current = lib
