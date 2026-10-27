"""Transition log for the snapshot (`events[]`): the last 200 changes found by
diffing consecutive snapshots. In memory only; the first snapshot is the baseline."""

from __future__ import annotations

from collections import deque

MAX_EVENTS = 200


def _ball(b: dict | None) -> str | None:
    if not b:
        return None
    return f"{b.get('who')}:{b['name']}" if b.get("name") else b.get("who")


def diff(prev: dict, cur: dict, now: float) -> list[dict]:
    out: list[dict] = []

    def ev(kind, wp, frm, to, station_id=None):
        out.append({"ts": now, "kind": kind, "pr": (wp or {}).get("pr"), "workpiece_id": (wp or {}).get("id"),
                    "from": frm, "to": to, "station_id": station_id if station_id is not None else (wp or {}).get("station_id")})

    before = {w.get("id") or f"pr:{w.get('pr')}": w for w in prev.get("workpieces", [])}
    for w in cur.get("workpieces", []):
        old = before.get(w.get("id") or f"pr:{w.get('pr')}")
        if not old:
            continue
        if old.get("phase") != w.get("phase"):
            ev("phase", w, old.get("phase"), w.get("phase"))
        if _ball(old.get("ball")) != _ball(w.get("ball")):
            ev("ball", w, _ball(old.get("ball")), _ball(w.get("ball")))
        was, now_stage = old.get("stage"), w.get("stage")
        if now_stage != was and now_stage == "merged" and was != "deployed":
            ev("merge", w, was, now_stage)
        elif now_stage != was and now_stage == "deployed":
            if was not in ("merged",):
                ev("merge", w, was, "merged")
            ev("deploy", w, "merged", now_stage)

    old_notes = {s["id"]: (s.get("note") or {}) for s in prev.get("stations", [])}
    for s in cur.get("stations", []):
        if s["id"] not in old_notes:
            continue
        o, n = old_notes[s["id"]], s.get("note") or {}
        if (o.get("state"), o.get("text")) != (n.get("state"), n.get("text")):
            focus = str(s.get("focus_workpiece_id") or "")
            out.append({"ts": now, "kind": "note", "pr": int(focus[3:]) if focus.startswith("pr:") else None,
                        "workpiece_id": s.get("focus_workpiece_id"), "from": o.get("state"), "to": n.get("state"),
                        "text": n.get("text"), "station_id": s["id"]})
    return out


class EventLog:
    def __init__(self, maxlen: int = MAX_EVENTS):
        self.events: deque[dict] = deque(maxlen=maxlen)
        self.prev: dict | None = None
        self.last_new: list[dict] = []

    def observe(self, snap: dict, now: float, baseline: bool = False) -> list[dict]:
        """Diff against the previous snapshot. `baseline=True` (sources still warming up)
        only records the snapshot, so data arriving for the first time is not a transition."""
        self.last_new = diff(self.prev, snap, now) if self.prev is not None and not baseline else []
        self.events.extend(self.last_new)
        self.prev = {"workpieces": [{k: w.get(k) for k in ("id", "pr", "phase", "ball", "stage", "station_id")}
                                    for w in snap.get("workpieces", [])],
                     "stations": [{k: s.get(k) for k in ("id", "note", "focus_workpiece_id")}
                                  for s in snap.get("stations", [])]}
        snap["events"] = list(self.events)
        return snap["events"]
