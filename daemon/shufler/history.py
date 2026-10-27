"""Time travel: events and compacted snapshots persisted to SQLite.

Write-behind: callers enqueue, one writer thread owns the connection, so the
tick never waits on disk. Reads open their own short-lived connection.
"""

from __future__ import annotations

import gzip
import json
import logging
import queue
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .world import OLD_PHASES, STAGE_PHASE

log = logging.getLogger(__name__)

SNAPSHOT_EVERY_S = 300
BURST_EVENTS = 3
# Dropped from stored snapshots: message text, and large lists that are rebuilt from disk anyway.
DROP_STATION_KEYS = ("last_assistant_preview", "skill_names")
DROP_TOP_KEYS = ("skills", "type")

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, kind TEXT NOT NULL, pr INTEGER, workpiece_id TEXT,
  station_id TEXT, frm TEXT, too TEXT, source TEXT NOT NULL DEFAULT 'live', data TEXT,
  UNIQUE (ts, kind, pr, workpiece_id, station_id, source)
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS snapshots (ts REAL PRIMARY KEY, your_move_count INTEGER, gz BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def compact(snap: dict) -> dict:
    out = {k: v for k, v in snap.items() if k not in DROP_TOP_KEYS}
    out["stations"] = []
    for st in snap.get("stations", []):
        s = {k: v for k, v in st.items() if k not in DROP_STATION_KEYS}
        if s.get("pending_question"):
            s["pending_question"] = {"present": True}
        out["stations"].append(s)
    return out


def day_of(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def parse_when(v: str | None) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class HistoryStore:
    def __init__(self, path: Path, retention_days: int = 90):
        self.path, self.retention_days = Path(path), retention_days
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as c:
            c.executescript(SCHEMA)
        self.q: queue.Queue = queue.Queue()
        self.last_snapshot_at = 0.0
        self._thread: threading.Thread | None = None

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=10)
        c.execute("PRAGMA journal_mode=WAL")
        return c

    # ------------------------------------------------------------ writing

    def start(self) -> None:
        if not self._thread:
            self._thread = threading.Thread(target=self._writer, name="history-writer", daemon=True)
            self._thread.start()

    def _writer(self) -> None:
        conn = self._connect()
        last_prune = 0.0
        while True:
            item = self.q.get()
            if item is None:
                break
            try:
                self._apply(conn, item)
                if time.time() - last_prune > 3600:
                    self.prune(conn)
                    last_prune = time.time()
            except Exception:  # noqa: BLE001 - history must never take the daemon down
                log.exception("history write failed")
        conn.close()

    def _apply(self, conn: sqlite3.Connection, item: tuple) -> None:
        kind, payload = item
        if kind == "events":
            conn.executemany(
                "INSERT OR IGNORE INTO events (ts, kind, pr, workpiece_id, station_id, frm, too, source, data) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                [(e["ts"], e["kind"], e.get("pr"), e.get("workpiece_id"), e.get("station_id"),
                  _s(e.get("from")), _s(e.get("to")), e.get("source", "live"),
                  json.dumps({k: v for k, v in e.items() if k not in
                              ("ts", "kind", "pr", "workpiece_id", "station_id", "from", "to", "source")}) or None)
                 for e in payload])
        elif kind == "snapshot":
            ts, snap = payload
            conn.execute("INSERT OR REPLACE INTO snapshots (ts, your_move_count, gz) VALUES (?,?,?)",
                         (ts, snap.get("your_move_count"), gzip.compress(json.dumps(compact(snap)).encode())))
        elif kind == "meta":
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", payload)
        conn.commit()

    def flush(self) -> None:
        """Apply queued writes synchronously (tests, shutdown)."""
        conn = self._connect()
        while True:
            try:
                item = self.q.get_nowait()
            except queue.Empty:
                break
            if item is not None:
                self._apply(conn, item)
        conn.close()

    def stop(self) -> None:
        if self._thread:
            self.q.put(None)
            self._thread.join(timeout=5)
            self._thread = None

    def record(self, snap: dict, new_events: list[dict], now: float) -> None:
        """Called every rebuild: queue new events, and a snapshot every 5 min or on a burst."""
        if new_events:
            self.q.put(("events", list(new_events)))
        if now - self.last_snapshot_at >= SNAPSHOT_EVERY_S or len(new_events) >= BURST_EVENTS:
            self.last_snapshot_at = now
            self.q.put(("snapshot", (now, json.loads(json.dumps(snap, default=str)))))

    def add_events(self, events: list[dict]) -> None:
        if events:
            self.q.put(("events", events))

    def set_meta(self, key: str, value: str) -> None:
        self.q.put(("meta", (key, value)))

    def get_meta(self, key: str) -> str | None:
        with self._connect() as c:
            row = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def prune(self, conn: sqlite3.Connection | None = None, now: float | None = None) -> None:
        cutoff = (now or time.time()) - self.retention_days * 86400
        own = conn is None
        conn = conn or self._connect()
        conn.execute("DELETE FROM events WHERE ts < ?", (cutoff,))
        conn.execute("DELETE FROM snapshots WHERE ts < ?", (cutoff,))
        conn.commit()
        if own:
            conn.close()

    # ------------------------------------------------------------ reading

    def range(self, start: float, end: float) -> dict:
        with self._connect() as c:
            base = c.execute("SELECT ts, gz FROM snapshots WHERE ts <= ? ORDER BY ts DESC LIMIT 1", (start,)).fetchone()
            rows = c.execute("SELECT ts, kind, pr, workpiece_id, station_id, frm, too, source, data FROM events "
                             "WHERE ts >= ? AND ts <= ? ORDER BY ts, id LIMIT 20000", (start, end)).fetchall()
        events = []
        for ts, kind, pr, wid, sid, frm, too, source, data in rows:
            e = {"ts": ts, "kind": kind, "pr": pr, "workpiece_id": wid, "station_id": sid,
                 "from": frm, "to": too, "source": source}
            if data:
                e.update(json.loads(data))
            if kind == "phase":
                map_event_phases(e)
            events.append(e)
        return {"from": start, "to": end, "base_ts": base[0] if base else None,
                "base": map_snapshot_phases(json.loads(gzip.decompress(base[1]))) if base else None,
                "events": events, "truncated": len(events) >= 20000}

    def days(self) -> list[dict]:
        out: dict[str, dict] = {}
        with self._connect() as c:
            for ts, kind, source in c.execute("SELECT ts, kind, source FROM events"):
                d = out.setdefault(day_of(ts), {"day": day_of(ts), "events": 0, "merges": 0, "deploys": 0,
                                                "needs_you_peak": None, "snapshots": 0, "backfill_only": True})
                d["events"] += 1
                d["merges"] += kind == "merge"
                d["deploys"] += kind == "deploy"
                d["backfill_only"] = d["backfill_only"] and source == "backfill"
            for ts, ymc in c.execute("SELECT ts, your_move_count FROM snapshots"):
                d = out.setdefault(day_of(ts), {"day": day_of(ts), "events": 0, "merges": 0, "deploys": 0,
                                                "needs_you_peak": None, "snapshots": 0, "backfill_only": False})
                d["snapshots"] += 1
                d["backfill_only"] = False
                if ymc is not None:
                    d["needs_you_peak"] = max(d["needs_you_peak"] or 0, ymc)
        return sorted(out.values(), key=lambda d: d["day"])


def map_event_phases(e: dict) -> dict:
    """Stored phase events may carry earlier phase names; replay sees the current seven (docs → deploy keeps a closeout flag)."""
    for k in ("from", "to"):
        if e.get(k) == "docs":
            e["closeout"] = True
        e[k] = OLD_PHASES.get(e.get(k), e.get(k))
    return e


def map_snapshot_phases(snap: dict) -> dict:
    """Stored snapshots: the stage decides merge/deploy/shipped (their meaning moved between v4 and v4.1)."""
    for w in snap.get("workpieces") or []:
        if w.get("phase") == "docs":
            w["postmerge_owed"] = True
        if w.get("pr") is not None and w.get("stage") in STAGE_PHASE and not (
                w["stage"] == "ready" and w.get("mergeable") == "CONFLICTING"):
            w["phase"] = STAGE_PHASE[w["stage"]]
        else:
            w["phase"] = OLD_PHASES.get(w.get("phase"), w.get("phase"))
    return snap


def _s(v: Any) -> str | None:
    return None if v is None else str(v)
