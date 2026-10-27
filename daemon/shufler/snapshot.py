"""Pure snapshot builder: raw collector data in, contract-shaped snapshot out."""

from __future__ import annotations

import os
import re
from typing import Any

from . import config
from .transcripts import parse_ts

NOTE_STATES = ("working", "me", "waiting", "staging", "merged", "done")
CI_FAIL = {"FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"}
UNGROUPED = "UNGROUPED"
CLOSED_ISSUE_STATES = ("user_notified", "closed")
_DESC_RE = re.compile(r"●\s*(\w+)\s*·\s*(.+)")
_TITLE_SID_RE = re.compile(r"\s*·\s*([0-9a-f]{8})\s*$")
_PR_REF_RE = re.compile(r"#(\d{1,7})\b")
SESSION_FALLBACK_S = 600
_REVIEWER_RE = re.compile(config.REVIEWER_LOGIN_RE, re.I)


# ---------------------------------------------------------------- derivations

def derive_ci(checks: list[dict]) -> str:
    if not checks:
        return "none"
    if any((c.get("conclusion") or "").upper() in CI_FAIL for c in checks):
        return "failure"
    if any((c.get("status") or "").upper() != "COMPLETED" for c in checks):
        return "pending"
    return "success"


def _reviewer_reviews(reviews: list[dict]) -> list[dict]:
    return [r for r in reviews or [] if r.get("login") and _REVIEWER_RE.search(r["login"])]


def derive_reviewer(reviews: list[dict], watch: dict | None, enabled: bool | None = None) -> str:
    """The reviewer bot's verdict on a PR; "off" when no reviewer bot is configured."""
    if not (config.REVIEW_ENABLED if enabled is None else enabled):
        return "off"
    mine = _reviewer_reviews(reviews)
    if mine:
        latest = max(mine, key=lambda r: r.get("at") or "")
        state = (latest.get("state") or "").upper()
        if state == "APPROVED":
            return "approved"
        if state == "CHANGES_REQUESTED":
            return "changes_requested"
        return "pending"
    if watch:
        status = str(watch.get("status") or "")
        if status == "approved":
            return "approved"
        if status.startswith("changes"):
            return "changes_requested"
        return "pending"
    return "none"


def derive_reviewer_at_head(reviews: list[dict], head_at: str | None) -> bool:
    """True only when the reviewer bot's latest review is an approval newer than the head commit."""
    mine = _reviewer_reviews(reviews)
    if not mine or not head_at:
        return False
    latest = max(mine, key=lambda r: r.get("at") or "")
    approved_at, head_ts = parse_ts(latest.get("at")), parse_ts(head_at)
    return (latest.get("state") or "").upper() == "APPROVED" and bool(approved_at and head_ts) and approved_at > head_ts


def derive_stage(*, merged: bool, deployed: bool, reviewer: str, ci: str, draft: bool,
                 preview_label: bool, note_state: str | None, reviewer_at_head: bool) -> str:
    """Contract stage derivation, first match wins. With a reviewer bot, `ready` needs its approval of the head
    commit; with none configured (reviewer "off"), CI and draft state decide."""
    if merged and deployed:
        return "deployed"
    if merged:
        return "merged"
    approved = reviewer == "off" or (reviewer == "approved" and reviewer_at_head)
    if approved and ci == "success" and not draft:
        return "ready"
    if preview_label or note_state == "staging":
        return "preview"
    if ci in ("pending", "failure"):
        return "ci"
    if (reviewer in ("pending", "changes_requested") or (reviewer == "approved" and not reviewer_at_head)) and not draft:
        return "reviewer"
    if draft:
        return "build"
    return "intake"


def parse_description(desc: str | None) -> dict | None:
    if not desc:
        return None
    m = _DESC_RE.search(desc)
    if not m or m.group(1) not in NOTE_STATES:
        return None
    return {"state": m.group(1), "text": m.group(2).strip().splitlines()[0], "ts": None}


def activity_status(note_state: str | None, idle: float | None) -> str:
    if idle is not None and note_state == "working" and idle > config.STALLED_AFTER_S:
        return "stalled"
    if idle is not None and idle <= config.ACTIVE_WINDOW_S:
        return "active"
    return "idle"


# ---------------------------------------------------------------- builder

def _uniq(seq):
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def build_snapshot(data: dict[str, Any], health: dict[str, dict], now: float) -> dict:
    workspaces = data.get("terminal") or []
    groups = data.get("groups") or []
    notes = data.get("notes") or {}
    transcripts = data.get("transcripts") or {}
    issues = data.get("intake") or {}
    ledgers = data.get("ledgers") or {}
    merged_prs = list({p["number"]: p for p in data.get("gh_merged") or []}.values())
    merged_numbers = {p["number"] for p in merged_prs}
    # One entry per PR: a PR in both lists (open cache older than the merged one) is merged.
    open_prs = [p for p in {p["number"]: p for p in data.get("gh") or []}.values() if p["number"] not in merged_numbers]
    deploys = (data.get("deploys") or {}).get("prs") or {}
    watch = data.get("reviewer_watch") or {}
    board = data.get("board") or {}
    details = data.get("gh_detail") or {}

    known_prs = {p["number"] for p in open_prs} | {p["number"] for p in merged_prs}
    branch_to_pr = {p["branch"]: p["number"] for p in [*open_prs, *merged_prs] if p.get("branch")}

    ref_to_group = {ref: g["name"] for g in groups for ref in g.get("members", [])}

    # Latest note per workspace ref.
    # A note joins by ws_ref only when its cwd is that workspace's cwd: terminals (cmux) renumber refs on restart.
    ws_cwd = {w.get("ref"): w.get("current_directory") for w in workspaces}
    note_by_ref: dict[str, dict] = {}
    for n in notes.values():
        ref = n.get("ws_ref")
        if ref and n.get("cwd") and ws_cwd.get(ref) and n.get("cwd") != ws_cwd.get(ref):
            continue
        if ref and (ref not in note_by_ref or (n.get("ts") or 0) > (note_by_ref[ref].get("ts") or 0)):
            note_by_ref[ref] = n

    # cwd fallback only when the cwd is unique to one workspace and one recent session.
    cwd_counts: dict[str, int] = {}
    for w in workspaces:
        cwd_counts[w.get("current_directory")] = cwd_counts.get(w.get("current_directory"), 0) + 1
    sessions_by_cwd: dict[str, list[str]] = {}
    for sid, t in transcripts.items():
        if t.get("cwd") and t.get("last_at") and now - t["last_at"] < config.TRANSCRIPT_RECENT_S:
            sessions_by_cwd.setdefault(t["cwd"], []).append(sid)

    known_sids = set(transcripts) | set(notes) | {i["session_id"] for i in issues.values() if i.get("session_id")}

    # Pass 1: title suffix, then the workspace's newest note, then a unique cwd match.
    joins: dict[str, tuple[str | None, str]] = {}
    for w in workspaces:
        ref, cwd = w.get("ref"), w.get("current_directory")
        raw_title = w.get("custom_title") or w.get("title") or ref
        session_id, source = None, "none"
        m = _TITLE_SID_RE.search(raw_title or "")
        if m:
            hits = [sid for sid in known_sids if sid.startswith(m.group(1))]
            session_id, source = (hits[0], "title") if len(hits) == 1 else (None, "none")
        ref_note = note_by_ref.get(ref)
        if not session_id and ref_note and ref_note.get("session"):
            session_id, source = ref_note["session"], "note"
        if not session_id and cwd and cwd_counts.get(cwd) == 1 and len(sessions_by_cwd.get(cwd, [])) == 1:
            session_id, source = sessions_by_cwd[cwd][0], "cwd_match"
        joins[w.get("id")] = (session_id, source)

    # Pass 2: a joined session with no live transcript (none, or idle past 24h) falls back to the
    # newest transcript in the same cwd written in the last 10 minutes that no other station claims.
    claimed = {sid for sid, _ in joins.values() if sid}
    for w in workspaces:
        sid, source = joins[w.get("id")]
        cwd = w.get("current_directory")
        t = transcripts.get(sid) if sid else None
        stale = sid is not None and (not t or not t.get("last_at") or now - t["last_at"] > config.TRANSCRIPT_RECENT_S)
        if not cwd or not (stale or sid is None):
            continue
        fresh = sorted(((x.get("last_at") or 0, s) for s, x in transcripts.items()
                        if x.get("cwd") == cwd and s not in claimed and now - (x.get("last_at") or 0) <= SESSION_FALLBACK_S),
                       reverse=True)
        if fresh:
            joins[w.get("id")] = (fresh[0][1], "cwd_match")
            claimed.add(fresh[0][1])

    # Running Claude processes → workspaces: the workspace id from the process env (CMUX_WORKSPACE_ID,
    # ITERM_SESSION_ID, TMUX_PANE), else the process's tty when exactly one workspace owns it, else the joined
    # session id, else a cwd that belongs to exactly one workspace. `processes` is None when that source is off.
    processes = data.get("processes")
    proc_by_ws: dict[str, list[dict]] = {}
    if processes is not None:
        ws_ids = {str(w.get("id")).upper(): w.get("id") for w in workspaces}
        tty_owners: dict[str, list] = {}
        for w in workspaces:
            for t in w.get("ttys") or []:
                tty_owners.setdefault(t, []).append(w.get("id"))
        ws_by_tty = {t: ids[0] for t, ids in tty_owners.items() if len(set(ids)) == 1}
        ws_by_cwd = {w.get("current_directory"): w.get("id") for w in workspaces
                     if w.get("current_directory") and cwd_counts.get(w.get("current_directory")) == 1}
        procs = sorted((dict(p) for p in processes), key=lambda p: -(p.get("since") or 0))
        used = {p["session_id"] for p in procs if p.get("session_id")}
        for p in procs:
            if not p.get("session_id") and p.get("cwd"):
                fresh = sorted(((x.get("last_at") or 0, sid) for sid, x in transcripts.items()
                                if x.get("cwd") == p["cwd"] and sid not in used
                                and now - (x.get("last_at") or 0) <= config.PROCESS_SESSION_RECENT_S), reverse=True)
                if fresh:
                    p["session_id"] = fresh[0][1]
                    used.add(fresh[0][1])
        sid_to_ws = {sid: wid for wid, (sid, _) in joins.items() if sid}
        for p in procs:
            wid = ws_ids.get(str(p.get("workspace_id") or "").upper())
            if not wid and p.get("tty") and tty_owners and p["tty"] not in tty_owners:
                continue  # the adapter knows its ttys and this one is not among them: another terminal's process
            if not wid and p.get("tty"):
                wid = ws_by_tty.get(p["tty"])
            if not wid and p.get("session_id"):
                wid = sid_to_ws.get(p["session_id"])
            if not wid and p.get("cwd"):
                wid = ws_by_cwd.get(p["cwd"])
            if wid:
                proc_by_ws.setdefault(wid, []).append(p)
        running_where = {p["session_id"]: wid for wid, ps in proc_by_ws.items() for p in ps if p.get("session_id")}
        for wid, (sid, src) in list(joins.items()):
            if sid and running_where.get(sid, wid) != wid:
                joins[wid] = (None, "none")  # that session runs in another workspace: this join was wrong
        def _norm(text: str | None) -> str:
            return re.sub(r"[^a-z0-9]", "", (text or "").lower())

        titles = {w.get("id"): _TITLE_SID_RE.sub("", w.get("custom_title") or w.get("title") or "") for w in workspaces}
        for wid, ps in proc_by_ws.items():
            sid, src = joins[wid]
            live = [p for p in ps if p.get("session_id")]
            named = [p for p in live if p.get("name") and _norm(p["name"]) == _norm(titles.get(wid))]
            if named and src != "title" and sid != named[0]["session_id"]:
                joins[wid] = (named[0]["session_id"], "process_name")  # `claude --name <workspace title>`
            elif live and sid not in {p["session_id"] for p in live}:
                newest = min(live, key=lambda p: p.get("etime_s") if p.get("etime_s") is not None else 10**12)
                joins[wid] = (newest["session_id"], "process")

    stations: list[dict] = []
    for w in workspaces:
        ref, cwd = w.get("ref"), w.get("current_directory")
        raw_title = w.get("custom_title") or w.get("title") or ref
        title = raw_title
        m = _TITLE_SID_RE.search(raw_title or "")
        if m:
            title = raw_title[: m.start()].strip() or raw_title
        ref_note = note_by_ref.get(ref)
        session_id, session_source = joins[w.get("id")]
        n = notes.get(session_id) if session_id else None
        if n:
            note = {"state": n.get("state"), "text": n.get("text"), "ts": n.get("ts")}
        else:
            note = parse_description(w.get("description"))
            if note is None and ref_note:
                note = {"state": ref_note.get("state"), "text": ref_note.get("text"), "ts": ref_note.get("ts")}
        t = transcripts.get(session_id) if session_id else None
        last_at = t.get("last_at") if t else None
        idle = round(now - last_at, 1) if last_at else None
        note_state = note.get("state") if note else None

        prs: list[int] = []
        wt_branch = os.path.basename(cwd.rstrip("/")) if cwd and "/worktrees/" in cwd else None
        if wt_branch and wt_branch in branch_to_pr:
            prs.append(branch_to_pr[wt_branch])
        if note and note.get("text"):
            prs += [int(x) for x in _PR_REF_RE.findall(note["text"]) if int(x) in known_prs]
        if t:
            prs += [x for x in reversed(t.get("pr_numbers") or []) if x in known_prs]
        slugs = [s for s, i in issues.items()
                 if session_id and i.get("session_id") == session_id and i.get("state") not in CLOSED_ISSUE_STATES]
        prs += [issues[s]["pr"] for s in slugs if issues[s].get("pr") in known_prs]
        prs = _uniq(prs)
        slugs = _uniq(slugs + [s for s, i in issues.items() if i.get("pr") and i["pr"] in prs])

        stations.append({
            "id": w.get("id"), "ref": ref,
            "title": title,
            "hall_id": ref_to_group.get(ref, UNGROUPED),
            "color": w.get("custom_color"),
            "cwd": cwd, "ports": list(w.get("listening_ports") or []),
            "session_id": session_id, "session_id_source": session_source,
            "account": t.get("account") if t else None,
            "note": note,
            "activity": {
                "last_at": last_at, "last_tool": t.get("last_tool") if t else None,
                "subagents": t.get("subagents", 0) if t else 0, "idle_seconds": idle,
                "status": activity_status(note_state, idle),
                "tool_calls": t.get("tool_calls", 0) if t else 0,
            },
            "tokens_today": t.get("tokens_today", 0) if t else 0,
            "pr_numbers": prs, "issue_slugs": slugs,
            "last_prompt_at": w.get("latest_submitted_at"),
            "selected": bool(w.get("selected")),
            "pending_question": t.get("pending_question") if t else None,
            "last_assistant_preview": t.get("last_assistant_preview") if t else None,
            "issue_events": {s: issues[s].get("events") or [] for s in slugs},
            "context_pct": None, "quota_pct": None,
            "telemetry": telemetry(t, (data.get("accounts") or {}).get(t.get("account")) if t else None, now),
        })
        if processes is None:
            stations[-1]["claude"] = None
        else:
            ps = proc_by_ws.get(w.get("id"), [])
            ordered = sorted(ps, key=lambda p: (p.get("session_id") != session_id, p.get("etime_s") or 0))
            first = ordered[0] if ordered else None
            stations[-1]["claude"] = {
                "running": bool(ps), "pid": first and first["pid"], "since": first and first.get("since"),
                "sessions": list(dict.fromkeys(p["session_id"] for p in ordered if p.get("session_id"))),
                "count": len(ps)}
            if not ps:
                stations[-1]["activity"]["status"] = "closed"
        stations[-1]["ledger_area"] = next((p["ledger_area"] for p in (ordered if processes is not None else [])
                                            if p.get("ledger_area")), None)
        stations[-1]["_names"] = [p.get("name") for p in (ordered if processes is not None else []) if p.get("name")]
        tel = stations[-1]["telemetry"]
        stations[-1]["context_pct"] = tel["context_pct"]
        stations[-1]["quota_pct"] = (tel["rate_limit"] or {}).get("used_pct")

    # A group's anchor workspace (cmux has them) is drawn as the group header, not a member: drop it unless a Claude
    # session is joined to it, then keep it and say which group it anchors.
    anchors = {g["anchor"]: g["name"] for g in groups if g.get("anchor")}
    kept = []
    for s in stations:
        if s["ref"] in anchors:
            if not s.get("session_id"):
                continue
            s["anchor_for"] = anchors[s["ref"]]
        else:
            s["anchor_for"] = None
        kept.append(s)
    stations = kept
    # Utility workspaces (config [terminal] utility) are tools, not work rows: out of stations[], still reachable.
    utility_titles = {t.strip().upper() for t in config.UTILITY_TITLES}
    utility_stations = []
    for s in stations:
        s["utility"] = (s.get("title") or "").strip().upper() in utility_titles
        if s["utility"]:
            s["domain"] = None
            utility_stations.append(s)
    stations = [s for s in stations if not s["utility"]]

    # Halls in the terminal's group order, then ungrouped.
    station_by_ref = {s["ref"]: s for s in stations}
    # Sidebar order is the workspace index the adapter reports: cmux numbers its sidebar top to bottom, so
    # ungrouped workspaces sit wherever they are dragged (above, between or below groups); iTerm2 and tmux number
    # window/session, then tab/window, then pane. Groups rank by their topmost workspace, anchor included; the
    # ungrouped pseudo-group "" by its topmost member. The stations array keeps the adapter's list order.
    ws_index = {w.get("ref"): w.get("index", i) for i, w in enumerate(workspaces)}
    big = 10**6
    tops: list[tuple[int, dict]] = []
    loose_refs = [s["ref"] for s in stations if s["hall_id"] == UNGROUPED]
    if loose_refs:
        tops.append((min(ws_index.get(r, big) for r in loose_refs),
                     {"name": "", "pinned": True, "member_count": len(loose_refs)}))
    for n, g in enumerate(groups):
        refs = [*g.get("members", []), *([g["anchor"]] if g.get("anchor") else [])]
        tops.append((min((ws_index.get(r, big) for r in refs), default=big + n),
                     {"name": g["name"], "pinned": bool(g.get("pinned")),
                      "member_count": len([s for s in stations if s["hall_id"] == g["name"]])}))
    side_groups = [{**g, "index": i} for i, (_, g) in enumerate(sorted(tops, key=lambda t: t[0]))]

    for i, s in enumerate(sorted(stations, key=lambda s: ws_index.get(s["ref"], big))):
        s["sidebar_index"] = i

    # World rows follow the terminal's order top to bottom (round 13). Each poll re-reads the terminal, so
    # dragging a cmux workspace in the sidebar reorders the floor on the next snapshot.
    for s in stations:
        s["row_order"] = s["sidebar_index"]
    for s in [*stations, *utility_stations]:
        s.pop("_names", None)

    halls = []
    for g in groups:
        ids = [station_by_ref[r]["id"] for r in g.get("members", []) if r in station_by_ref]
        halls.append({"id": g["name"], "name": g["name"], "color": g.get("color"), "station_ids": ids})
    loose = [s["id"] for s in stations if s["hall_id"] == UNGROUPED]
    if loose:
        halls.append({"id": UNGROUPED, "name": UNGROUPED, "color": None, "station_ids": loose})

    # PR → owning station: worktree-branch match first, then first station listing it.
    pr_station: dict[int, dict] = {}
    for s in stations:
        cwd = s.get("cwd") or ""
        for pr in s["pr_numbers"]:
            if pr not in pr_station:
                pr_station[pr] = s
            elif "/worktrees/" in cwd and branch_to_pr.get(os.path.basename(cwd.rstrip("/"))) == pr:
                pr_station[pr] = s

    issue_by_pr: dict[int, dict] = {}
    for i in issues.values():  # when two items share a PR, an open one wins over a closed one
        if i.get("pr") and (i["pr"] not in issue_by_pr or issue_by_pr[i["pr"]].get("state") in CLOSED_ISSUE_STATES):
            issue_by_pr[i["pr"]] = i
    ledger_by_pr: dict[int, dict] = {}
    for area, rows in ledgers.items():
        for row in rows:
            for n in row.get("pr_numbers", []):
                ledger_by_pr.setdefault(n, {"area": area, "state": row.get("state"),
                                             "ball": row.get("ball"), "next": row.get("next")})

    def common(number: int) -> dict:
        st = pr_station.get(number)
        issue = issue_by_pr.get(number)
        w = watch.get(str(number))
        board_stage = None
        if issue:
            board_stage = board.get(issue.get("card_id") or "") or issue.get("card_stage")
        return {
            "station_id": st["id"] if st else None,
            "issue_slug": issue["slug"] if issue else None,
            "board_stage": board_stage,
            "reviewer_loop": {"round": w.get("cycle"), "state": w.get("status")} if w else None,
            "ledger": ledger_by_pr.get(number),
        }

    workpieces: list[dict] = []
    for p in open_prs:
        n = p["number"]
        ci = derive_ci(p.get("checks") or [])
        reviewer = derive_reviewer(p.get("reviews") or [], watch.get(str(n)))
        det = details.get(str(n)) or {}
        at_head = derive_reviewer_at_head(p.get("reviews") or [], det.get("head_at"))
        c = common(n)
        st = pr_station.get(n)
        note_state = (st.get("note") or {}).get("state") if st else None
        preview_label = any("preview" in (l or "").lower() for l in p.get("labels") or [])
        workpieces.append({
            "pr": n, "title": p.get("title"), "url": p.get("url"), "branch": p.get("branch"),
            "draft": p.get("draft", False),
            "stage": derive_stage(merged=False, deployed=False, reviewer=reviewer, ci=ci, draft=p.get("draft", False),
                                  preview_label=preview_label, note_state=note_state, reviewer_at_head=at_head),
            "ci": ci, "reviewer": reviewer, "reviewer_at_head": at_head, "review_decision": p.get("review_decision"),
            "mergeable": det.get("mergeable") or "UNKNOWN", "merge_state": det.get("merge_state"),
            "closeout_owed": False, "labels": p.get("labels") or [],
            **c,
            "merged_at": None, "deployed_at": None, "shipped_via": None, "updated_at": p.get("updated_at"),
            "failed_run_ids": _failed_run_ids(p.get("checks") or []),
        })

    shipped: list[dict] = []
    for p in sorted(merged_prs, key=lambda p: p.get("merged_at") or "", reverse=True):
        n = p["number"]
        dep = deploys.get(str(n)) or {}
        if dep.get("dropped"):
            continue  # a stack layer whose parent PR closed unmerged never ships
        deployed = bool(dep.get("deployed"))
        shipped.append({"pr": n, "title": p.get("title"), "merged_at": p.get("merged_at"), "deployed": deployed})
        workpieces.append({
            "pr": n, "title": p.get("title"), "url": p.get("url"), "branch": p.get("branch"), "draft": False,
            "stage": derive_stage(merged=True, deployed=deployed, reviewer="none", ci="none", draft=False,
                                  preview_label=False, note_state=None, reviewer_at_head=False),
            "ci": "none", "reviewer": "none", "reviewer_at_head": False, "review_decision": None,
            "mergeable": None, "merge_state": "MERGED",
            "closeout_owed": bool(issue_by_pr.get(n)) and issue_by_pr[n].get("state") not in CLOSED_ISSUE_STATES,
            "labels": p.get("labels") or [],
            **common(n),
            "merged_at": p.get("merged_at"), "deployed_at": dep.get("deployed_at"),
            "shipped_via": dep.get("shipped_via"),
            "updated_at": p.get("merged_at"), "failed_run_ids": [],
        })

    moves = [{"station_id": s["id"], "kind": "note", "text": s["note"].get("text"), "since": s["note"].get("ts")}
             for s in stations if s.get("note") and s["note"].get("state") == "me"]
    moves += [{"station_id": s["id"], "kind": "question", "text": s["pending_question"].get("question"),
               "since": (s["activity"] or {}).get("last_at")}
              for s in stations if s.get("pending_question")]
    your_move = sorted(moves, key=lambda m: (m["since"] is None, m["since"] or 0))

    return {
        "type": "snapshot", "ts": now, "halls": halls, "groups": side_groups, "stations": stations, "utility_stations": utility_stations,
        "workpieces": workpieces, "shipped": shipped, "your_move": your_move, "sources": health,
        "capabilities": config.capabilities(),
        "focused_station_id": next((w.get("id") for w in workspaces if w.get("selected")), None),
    }


def telemetry(t: dict | None, acct: dict | None, now: float) -> dict:
    """Statusline-equivalent figures; null whenever the source does not say."""
    t = t or {}
    acct = acct or {}
    window = acct.get("context_window")
    ctx = t.get("context_tokens")
    quota = acct.get("quota") or {}
    used = quota.get("five_hour_pct")
    started = t.get("session_started_at")
    return {
        "model": t.get("model"),
        "account_label": acct.get("label"),
        "account_email_masked": acct.get("email_masked"),
        "context_pct": round(100.0 * ctx / window, 1) if ctx is not None and window else None,
        "context_tokens": ctx, "context_window": window,
        "cost_usd_session": round(t["cost_usd_session"], 2) if t.get("cost_usd_session") is not None else None,
        "tokens_in_today": t.get("tokens_in_today"), "tokens_out_today": t.get("tokens_out_today"),
        "rate_limit": ({"remaining_pct": round(100 - used, 1), "used_pct": used, "resets_at": None,
                        "week_used_pct": quota.get("week_pct"), "as_of": quota.get("as_of")}
                       if used is not None else None),
        "uptime_s": round(now - started) if started else None,
        "session_started_at": started,
        "transcript_size_bytes": t.get("transcript_size_bytes"),
        "turns": t.get("turns"),
        "compactions": t.get("compactions"),
    }


def _failed_run_ids(checks: list[dict]) -> list[int]:
    ids = []
    for c in checks:
        if (c.get("conclusion") or "").upper() in CI_FAIL:
            m = re.search(r"/actions/runs/(\d+)", c.get("url") or "")
            if m:
                ids.append(int(m.group(1)))
    return _uniq(ids)


VOLATILE = ("ts",)


def stable_view(snap: dict) -> dict:
    """Snapshot minus fields that tick every second, for change detection."""
    s = {k: v for k, v in snap.items() if k not in VOLATILE}
    s["sources"] = {k: {"ok": v.get("ok"), "error": v.get("error")} for k, v in snap.get("sources", {}).items()}
    s["stations"] = [
        {**st, "activity": {**st["activity"], "idle_seconds": None},
         "telemetry": {**(st.get("telemetry") or {}), "uptime_s": None}} for st in snap.get("stations", [])
    ]
    return s


__all__ = ["build_snapshot", "derive_stage", "derive_ci", "derive_reviewer", "stable_view", "parse_ts"]
