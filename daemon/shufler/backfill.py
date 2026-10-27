"""Best-effort history for days before install, labelled source "backfill".

Kinds: open, review, merge, deploy (from the code host) and session_start,
session_end, pr_link (from agent transcripts). A deploy time is the first
successful deploy run at or after the merge, so it is approximate. Session
notes and phases have no history before install and stay unknown.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

from .transcripts import parse_ts

log = logging.getLogger(__name__)
META_KEY = "backfill_v1"


def _ev(ts, kind, pr=None, frm=None, to=None, station_id=None, **data) -> dict:
    return {"ts": ts, "kind": kind, "pr": pr, "workpiece_id": f"pr:{pr}" if pr else None,
            "station_id": station_id, "from": frm, "to": to, "source": "backfill", **data}


def scm_events(scm, since_day: str, since_ts: float, reviewer=None) -> list[dict]:
    out: list[dict] = []
    deploys = [(parse_ts(r["createdAt"]), r) for r in scm.deploy_history(since_day)]
    deploys = [(t, r) for t, r in deploys if t]
    for p in scm.pr_history(since_day):
        n = p["number"]
        opened, merged = parse_ts(p.get("created_at")), parse_ts(p.get("merged_at"))
        if opened and opened >= since_ts:
            out.append(_ev(opened, "open", n, to="open", branch=p.get("branch")))
        for r in p.get("reviews") or []:
            at = parse_ts(r.get("at"))
            if at and at >= since_ts:
                who = "reviewer" if reviewer and reviewer.is_reviewer(r.get("login")) else "person"
                out.append(_ev(at, "review", n, to=(r.get("state") or "").lower(), by=who))
        if merged and merged >= since_ts:
            out.append(_ev(merged, "merge", n, frm="open", to="merged"))
            dep = next((t for t, _ in deploys if t >= merged), None)
            if dep:
                out.append(_ev(dep, "deploy", n, frm="merged", to="deployed", approx=True))
    return out


def agent_events(agent, since_ts: float) -> list[dict]:
    out: list[dict] = []
    for s in agent.session_history(since_ts):
        sid = s["session_id"]
        if s.get("started_at") and s["started_at"] >= since_ts:
            out.append(_ev(s["started_at"], "session_start", to=sid, session_id=sid, cwd=s.get("cwd")))
        if s.get("ended_at") and s["ended_at"] >= since_ts:
            out.append(_ev(s["ended_at"], "session_end", frm=sid, session_id=sid))
        seen = set()
        for link in s.get("pr_links") or []:
            if link["pr"] in seen or not link.get("ts") or link["ts"] < since_ts:
                continue
            seen.add(link["pr"])
            out.append(_ev(link["ts"], "pr_link", link["pr"], to=sid, session_id=sid))
    return out


def run(store, adapters, days: int = 30, now: float | None = None, force: bool = False) -> int:
    """Backfill once per store (meta key); returns the number of events queued."""
    if not force and store.get_meta(META_KEY):
        return 0
    now = now or time.time()
    start = datetime.fromtimestamp(now) - timedelta(days=days)
    since_ts, since_day = start.timestamp(), start.strftime("%Y-%m-%d")
    events: list[dict] = []
    if adapters.scm:
        try:
            events += scm_events(adapters.scm, since_day, since_ts, adapters.reviewer)
        except Exception:  # noqa: BLE001 - best effort
            log.exception("scm backfill failed")
    try:
        events += agent_events(adapters.agent, since_ts)
    except Exception:  # noqa: BLE001
        log.exception("transcript backfill failed")
    store.add_events(sorted(events, key=lambda e: e["ts"]))
    store.set_meta(META_KEY, str(now))
    return len(events)
