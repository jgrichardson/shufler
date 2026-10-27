"""World enrichment (CONTRACT.md "World layout"): layers domains, phases, ball, links and the needs-you queue
onto the base snapshot."""

from __future__ import annotations

import json
import logging
import os
import re
import tomllib
from pathlib import Path
from typing import Any

from . import config

log = logging.getLogger(__name__)
_dupes_logged: set[str] = set()
from .adapters.tracker.ledgers import ledger_branch
from .transcripts import parse_ts

SPLIT_RE = re.compile(r"[_\-·/():\s]+")
SCOPE_RE = re.compile(r"^\s*\w+\(([^)]+)\)\s*!?:")
TYPE_RE = re.compile(r"^\s*(\w+)(\([^)]*\))?\s*!?:")
FIX_RE = re.compile(config.FIX_PATTERN, re.I)
PLAN_RE = re.compile(r"brainstorm|plan|design|decide|scope", re.I)
DOCS_RE = re.compile(r"\bdocs?\b", re.I)
QA_RE = re.compile(r"\bqa\b|\btesters?\b", re.I)
PLAN_DOC_RE = re.compile(r"docs/(plans|brainstorms)/|\b[\w-]*(plan|brainstorm)[\w-]*\.md\b", re.I)
PLAN_SKILLS = ("ce-plan", "ce-brainstorm")
BRAINSTORM_RE = re.compile(r"brainstorm|ideat|explor", re.I)
PR_REF_RE = re.compile(r"#(\d{1,7})\b")
HEX8_RE = re.compile(r"\b([0-9a-f]{8})\b")
DEFAULT_TITLE_RE = re.compile(r"^\s*(group|workspace|terminal|untitled|new workspace|tab)?\s*:?\s*\d*\s*$", re.I)
EMPTY_AFTER_S = 24 * 3600
FALLBACK_STYLE = {"label": "Unassigned", "code": "??", "color": "#8A8F98"}
COMMAND_TITLES = {t.upper() for t in config.COMMAND_TITLES}
FALLBACK = config.FALLBACK_DOMAIN
COMMAND = config.COMMAND_DOMAIN
OWNER_ALIASES = config.OWNER_ALIASES
PARKED_STATES = ("on-hold", "on hold", "parked", "sidelined")
LINK_RANK = {"ledger": 0, "issue": 1, "pr-link": 2, "cmux": 3, "worktree": 4}
SEVERITY = {"question": 3, "merge": 3, "reply": 2, "note": 2, "closeout": 1}
ACKABLE = ("closeout", "reply")
REPLY_EVENTS = config.REPLY_EVENTS
# Earlier phase names, mapped forward (stored phase_since, events and history snapshots).
OLD_PHASES = {"test": "build", "ci": "review", "preview": "qa", "ready": "merge", "docs": "shipped"}
STAGE_PHASE = {"ready": "merge", "merged": "deploy", "deployed": "shipped"}
LONG_PHASES = ("build",)
STUCK_SHORT_S = 24 * 3600
STUCK_LONG_S = 72 * 3600

_domains_cache: dict[str, Any] = {"mtime": None, "domains": []}


def load_domains(path: Path | None = None) -> list[dict]:
    path = path or config.CONFIG_FILE
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return _domains_cache["domains"]
    if _domains_cache["mtime"] != (str(path), mtime):
        with open(path, "rb") as fh:
            doms = tomllib.load(fh).get("domain", [])
        _domains_cache.update(mtime=(str(path), mtime), domains=[
            {**d, "manual": [a.lower() for a in d.get("manual", [])],
             "aliases": [a.lower() for a in [*d.get("aliases", []), *d.get("manual", [])]]} for d in doms])
    return _domains_cache["domains"]


def tokens(text: str | None) -> list[str]:
    if not text:
        return []
    parts = [t for t in SPLIT_RE.split(text.lower()) if t]
    out = list(parts)
    for a, b in zip(parts, parts[1:]):
        out += [f"{a}_{b}", f"{a}-{b}"]
    return out


def match_domain(text: str | None, domains: list[dict]) -> str | None:
    toks = tokens(text)
    if not toks:
        return None
    whole = (text or "").lower().strip()
    for d in domains:
        if whole in d["aliases"] or d["id"] == whole:
            return d["id"]
    for t in toks:
        for d in domains:
            if t == d["id"] or t in d["aliases"]:
                return d["id"]
    return None


def with_fallback(domains: list[dict]) -> list[dict]:
    """The fallback domain always exists and is always the last lane."""
    fb = next((d for d in domains if d["id"] == FALLBACK), None) or {
        "id": FALLBACK, **FALLBACK_STYLE, "aliases": [FALLBACK], "manual": []}
    return [d for d in domains if d["id"] != FALLBACK] + [fb]


def manual_domain(text: str | None, domains: list[dict]) -> str | None:
    t = (text or "").lower().strip()
    if not t:
        return None
    return next((d["id"] for d in domains if t in (d.get("manual") or [])), None)


def is_untitled(station: dict) -> bool:
    title = (station.get("title") or "").strip()
    base = os.path.basename((station.get("cwd") or "").rstrip("/"))
    return bool(DEFAULT_TITLE_RE.match(title)) or (bool(base) and title == base)


def domain_alias_for(target: str, snap: dict) -> tuple[str, str]:
    """(alias, what it is) that `set_domain` persists for a target: PR title scope, else the branch, for a PR;
    the workspace title for a station."""
    kind, _, ref = (target or "").partition(":")
    if kind == "pr":
        try:
            n = int(ref)
        except ValueError:
            raise ValueError("target must be pr:<number> or station:<id>") from None
        w = next((x for x in snap.get("workpieces", []) if x.get("pr") == n), None)
        if not w:
            raise ValueError(f"PR #{n} is not in the snapshot")
        m = SCOPE_RE.match(w.get("title") or "")
        if m and m.group(1).strip():
            return config.check_alias(m.group(1).strip().lower()), "PR scope"
        if w.get("branch"):
            return config.check_alias(w["branch"].lower()), "branch"
        raise ValueError(f"PR #{n} has no title scope or branch to alias")
    if kind == "station":
        st = next((x for x in snap.get("stations", []) if x.get("id") == ref), None)
        if not st:
            raise ValueError(f"no station {ref!r}")
        if not (st.get("title") or "").strip() or is_untitled(st):
            raise ValueError("an untitled workspace has no title to alias; give it a title in the terminal first")
        return config.check_alias(st["title"].strip().lower()), "workspace title"
    raise ValueError("target must be pr:<number> or station:<id>")


def unique_workpieces(wps: list[dict]) -> list[dict]:
    """Hard guarantee: one workpiece per id. A PR entry beats a non-PR entry, a merged/deployed PR entry beats an
    open one; the first wins otherwise. Each duplicated id is logged once per process."""
    rank = {"deployed": 0, "merged": 1}
    keep: dict[str, dict] = {}
    for w in wps:
        cur = keep.get(w["id"])
        if cur is None:
            keep[w["id"]] = w
            continue
        if w["id"] not in _dupes_logged:
            _dupes_logged.add(w["id"])
            log.warning("duplicate workpiece id %s merged", w["id"])
        def score(x: dict) -> tuple:
            return (x.get("pr") is None, rank.get(x.get("stage"), 2))
        if score(w) < score(cur):
            keep[w["id"]] = w
    return list(keep.values())


def map_phase(phase: str | None) -> str | None:
    """A stored phase name in the Phases v4 vocabulary."""
    return OLD_PHASES.get(phase, phase) if phase else phase


def non_pr_phase(text: str | None, plan_doc: bool = False) -> str:
    """Non-PR items sit in brainstorm or plan: a plan/brainstorm doc or ce-plan/ce-brainstorm skill → plan,
    brainstorm/ideate/explore in the ledger or issue text → brainstorm, else plan."""
    if plan_doc or PLAN_DOC_RE.search(text or ""):
        return "plan"
    return "brainstorm" if BRAINSTORM_RE.search(text or "") else "plan"


def _size(p: dict) -> str:
    a, d = p.get("additions"), p.get("deletions")
    if a is None and d is None:
        return "M"
    n = (a or 0) + (d or 0)
    return "S" if n < 150 else "M" if n < 800 else "L"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:48] or "item"


def _wt_base(path: str | None) -> str | None:
    if not path:
        return None
    m = re.search(r"worktrees/[^/\s]+/([^\s/()]+)", path)
    return m.group(1) if m else None


def _ball_from_ledger(raw: str | None) -> dict | None:
    b = (raw or "").strip()
    if not b:
        return None
    low = b.lower()
    first = re.split(r"[\s,;:(]+", b)[0]
    if first.lower() in OWNER_ALIASES or any(low.startswith(a) for a in OWNER_ALIASES if len(a) > 2):
        return {"who": "owner", "name": None}
    if low.startswith(("reviewer", "review bot")) or (config.REVIEW_ENABLED and re.match(config.REVIEWER_LOGIN_RE, low)):
        return {"who": "reviewer", "name": None}
    if low.startswith("ci"):
        return {"who": "ci", "name": None}
    if low.startswith(("claude", "agent", config.LEDGER_SESSION_MARKER)):
        return {"who": "claude", "name": None}
    if first and first[0].isupper():
        return {"who": "person", "name": first}
    return None


class PhaseMemory:
    """phase_since per workpiece id, persisted in the cache dir."""

    def __init__(self, path: Path | None = None):
        self.path = path or (config.CACHE_DIR / "phase_since.json")
        try:
            self.data: dict[str, dict] = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            self.data = {}
        for rec in self.data.values():
            if isinstance(rec, dict) and rec.get("phase") in OLD_PHASES:
                rec["phase"] = OLD_PHASES[rec["phase"]]
        self.dirty = False

    def since(self, wid: str, phase: str, now: float) -> float:
        rec = self.data.get(wid)
        if not rec or rec.get("phase") != phase:
            self.data[wid] = {"phase": phase, "since": now}
            self.dirty = True
        return self.data[wid]["since"]

    def save(self) -> None:
        if not self.dirty:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data))
            tmp.replace(self.path)
            self.dirty = False
        except OSError:
            pass


def enrich(snap: dict, data: dict[str, Any], now: float, memory: PhaseMemory | None = None,
           acks: set[str] | None = None, domains: list[dict] | None = None) -> dict:
    domains = with_fallback(domains if domains is not None else load_domains())
    memory = memory or PhaseMemory(Path(os.devnull))
    acks = acks or set()
    dom_ids = [d["id"] for d in domains]
    issues = data.get("intake") or {}
    ledgers = data.get("ledgers") or {}
    transcripts = data.get("transcripts") or {}
    open_by_n = {p["number"]: p for p in data.get("gh") or []}
    merged_by_n = {p["number"]: p for p in data.get("gh_merged") or []}
    stations = snap["stations"]
    st_by_id = {s["id"]: s for s in stations}
    workspaces = {w.get("id"): w for w in data.get("terminal") or []}
    wps = snap["workpieces"]
    wp_by_pr = {w["pr"]: w for w in wps}
    open_prs = set(open_by_n)
    known_prs = set(wp_by_pr)

    # ---------------------------------------------------------------- ledger rows
    ledger_rows = [dict(r, area=area) for area, rows in ledgers.items() for r in rows]
    resolved = data.get("ledger_branches") or {}
    stale: list[dict] = []
    kept_rows: list[dict] = []
    head_pr = {p.get("branch"): p["number"] for p in [*(data.get("gh_merged") or []), *(data.get("gh") or [])]
               if p.get("branch")}
    for r in ledger_rows:
        b = ledger_branch(r)
        if b and not r.get("pr_numbers") and head_pr.get(b) in known_prs:
            r["pr_numbers"] = [head_pr[b]]                # the branch is a known PR's head: the row is that PR
        res = resolved.get(b) if b and not r.get("pr_numbers") else None
        if res:
            pr = res.get("pr")
            if pr and pr.get("state") in ("open", "merged") and pr["number"] in known_prs:
                r["pr_numbers"] = [pr["number"]]          # the row is that PR, never a second pod
            elif pr and pr.get("state") in ("merged", "closed"):
                continue                                  # shipped before this week, or closed: dropped
            elif not pr and not res.get("remote") and not res.get("worktree"):
                stale.append({"ledger_path": r.get("ledger_path"), "area": r["area"], "branch": b,
                              "title": r.get("topic") or None})
                continue
        kept_rows.append(r)
    ledger_rows = kept_rows
    snap["stale_ledger_rows"] = stale
    ledger_by_pr: dict[int, dict] = {}
    for r in ledger_rows:
        for n in r.get("pr_numbers", []):
            ledger_by_pr.setdefault(n, r)

    def ledger_stations(r: dict) -> list[str]:
        out = []
        wt = _wt_base(r.get("worktree"))
        for s in stations:
            if wt and _wt_base(s.get("cwd")) == wt:
                out.append(s["id"])
        for h in HEX8_RE.findall(r.get("session") or ""):
            out += [s["id"] for s in stations if (s.get("session_id") or "").startswith(h)]
        if config.LEDGER_SESSION_MARKER in (r.get("session") or "").lower():
            # the session running this area owns its rows; title matching is only a fallback, else every
            # session whose title maps to the domain would claim them
            owners = [s["id"] for s in stations if s.get("ledger_area") == r["area"]]
            if owners:
                out += owners
            else:
                area_dom = match_domain(r["area"], domains) or r["area"]
                out += [s["id"] for s in stations
                        if (s["title"] or "").lower() == r["area"] or match_domain(s["title"], domains) == area_dom]
        return list(dict.fromkeys(out))

    # ---------------------------------------------------------------- non-PR items
    extra: list[dict] = []
    for slug, i in issues.items():
        if i.get("pr") or (i.get("state") or "") == "closed":
            continue
        extra.append({"id": f"issue:{slug}", "pr": None, "kind": "issue", "title": i.get("title"),
                      "issue_slug": slug, "_state": i.get("state"), "_issue": i})
    for r in ledger_rows:
        if r.get("pr_numbers"):
            continue
        name = r.get("branch") or _slug(r.get("topic") or "")
        blob = f"{r.get('branch')} {r.get('topic')}"
        if FIX_RE.search(blob):
            wid, kind = f"fix:{_slug(name)}", "data_fix"
        elif PLAN_RE.search(r.get("state") or ""):
            wid, kind = f"plan:{_slug(name)}", "plan"
        elif DOCS_RE.search(r.get("topic") or ""):
            wid, kind = f"docs:{_slug(name)}", "docs"
        else:
            wid, kind = f"branch:{name}", "branch"
        extra.append({"id": wid, "pr": None, "kind": kind, "title": r.get("topic") or None,
                      "branch": r.get("branch") or None, "issue_slug": None, "_state": r.get("state"), "_ledger": r})
    seen_ids = set()
    for e in extra:
        if e["id"] in seen_ids:
            continue
        seen_ids.add(e["id"])
        wps.append({
            "id": e["id"], "pr": None, "kind": e["kind"], "title": e["title"], "url": None,
            "branch": e.get("branch"), "draft": False, "stage": "intake", "ci": "none", "reviewer": "none",
            "reviewer_at_head": False, "review_decision": None, "mergeable": None, "merge_state": None,
            "closeout_owed": False, "labels": [], "station_id": None, "issue_slug": e.get("issue_slug"),
            "board_stage": (e.get("_issue") or {}).get("card_stage"), "reviewer_loop": None,
            "ledger": ({"area": e["_ledger"]["area"], "state": e["_ledger"].get("state"),
                         "ball": e["_ledger"].get("ball"), "next": e["_ledger"].get("next")}
                        if e.get("_ledger") else None),
            "merged_at": None, "deployed_at": None, "shipped_via": None, "updated_at": None, "failed_run_ids": [],
            "_state": e.get("_state"), "_ledger": e.get("_ledger"), "_issue": e.get("_issue"),
        })
    for w in wps:
        if w.get("pr") is not None:
            w.setdefault("id", f"pr:{w['pr']}")
            w["_ledger"] = ledger_by_pr.get(w["pr"])
            if w["_ledger"] and not w.get("ledger"):
                led = w["_ledger"]
                w["ledger"] = {"area": led["area"], "state": led.get("state"), "ball": led.get("ball"),
                                "next": led.get("next")}
            w["_issue"] = issues.get(w.get("issue_slug") or "")
    wps[:] = unique_workpieces(wps)
    wp_by_id = {w["id"]: w for w in wps}

    # ---------------------------------------------------------------- links
    links: dict[str, dict[str, dict]] = {s["id"]: {} for s in stations}

    def link(sid: str, wid: str, source: str, since: float | None = None) -> None:
        if sid not in links or wid not in wp_by_id:
            return
        cur = links[sid].get(wid)
        if cur is None or LINK_RANK[source] < LINK_RANK[cur["source"]]:
            links[sid][wid] = {"id": wid, "pr": wp_by_id[wid]["pr"], "source": source, "since": since}

    for w in wps:
        led = w.get("_ledger")
        if led:
            for sid in ledger_stations(led):
                link(sid, w["id"], "ledger")
    for s in stations:
        sid_full = s.get("session_id")
        for slug, i in issues.items():
            if sid_full and i.get("session_id") == sid_full:
                wid = f"pr:{i['pr']}" if i.get("pr") in known_prs else f"issue:{slug}"
                link(s["id"], wid, "issue", parse_ts(i.get("created_at")) if i.get("created_at") else None)
        t = transcripts.get(sid_full) if sid_full else None
        if t:
            for n, ts in (t.get("pr_link_ts") or {}).items():
                n = int(n)
                if n in known_prs:
                    link(s["id"], f"pr:{n}", "pr-link", ts)
        desc = (workspaces.get(s["id"]) or {}).get("description") or ""
        for n in PR_REF_RE.findall(desc):
            if int(n) in known_prs:
                link(s["id"], f"pr:{int(n)}", "cmux")
        wt = _wt_base(s.get("cwd"))
        if wt:
            for w in wps:
                if w.get("branch") == wt:
                    link(s["id"], w["id"], "worktree")

    owners: dict[str, list[tuple[int, str]]] = {}
    for sid, ls in links.items():
        for wid, l in ls.items():
            owners.setdefault(wid, []).append((LINK_RANK[l["source"]], sid))
    for w in wps:
        ranked = sorted(owners.get(w["id"], []))
        w["station_id"] = ranked[0][1] if ranked else None
        w["station_ids"] = [sid for _, sid in ranked]

    # ---------------------------------------------------------------- domains
    def item_domain(w: dict) -> tuple[str | None, str | None, str | None]:
        scope = None
        if w.get("title"):
            m = SCOPE_RE.match(w["title"])
            scope = m.group(1).strip() if m else None
        for text, what in ((scope, "PR scope"), (w.get("branch"), "branch")):
            d = manual_domain(text, domains)
            if d:
                return d, "manual", f"set by hand ({what} `{text.lower()}`)"
        i = w.get("_issue")
        if i and i.get("domain"):
            d = match_domain(i["domain"], domains)
            if d:
                return d, "issue", f"issue domain `{i['domain']}`"
        led = w.get("_ledger")
        if led:
            d = match_domain(led["area"], domains)
            if d:
                return d, "ledger", f"area ledger `{led['area']}`"
        if scope:
            d = match_domain(scope, domains)
            if d:
                return d, "scope", f"PR scope `{scope}`"
        d = match_domain(w.get("branch"), domains) if w.get("branch") else None
        if d:
            return d, "branch", f"branch `{w['branch']}`"
        return None, None, None

    early = {w["id"]: item_domain(w) for w in wps}
    for s in stations:
        title = s["title"] or ""
        d, src, why = manual_domain(title, domains), "manual", f"set by hand (workspace title `{title}`)"
        if not d:
            d, src, why = match_domain(title, domains), "title", f"workspace title `{title}`"
        if not d:
            votes: dict[str, int] = {}
            for wid in links[s["id"]]:
                ed = early.get(wid, (None,))[0]
                if ed:
                    votes[ed] = votes.get(ed, 0) + 1
            if votes:
                d = max(votes.items(), key=lambda kv: (kv[1], -dom_ids.index(kv[0])))[0]
                src, why = "items", f"{votes[d]} of its {sum(votes.values())} items are in it"
        if not d and title.upper() in COMMAND_TITLES:
            d, src, why = COMMAND, "command", f"command workspace `{title}`"
        if not d:
            d, src, why = FALLBACK, "fallback", "nothing matched its title or items"
        s["domain"], s["domain_source"], s["domain_reason"] = d, src, why
        s["group"] = s["hall_id"] if s["hall_id"] != "UNGROUPED" else None
        last = (s.get("activity") or {}).get("last_at")
        s["empty"] = bool(is_untitled(s) and (s.get("activity") or {}).get("status") != "active"
                          and (last is None or now - last > EMPTY_AFTER_S))

    for w in wps:
        d, src, why = early[w["id"]]
        if not d and w.get("station_id"):
            owner = st_by_id[w["station_id"]]
            if owner["domain"] in dom_ids and owner["domain"] != FALLBACK:
                d, src, why = owner["domain"], "station", f"owning session `{owner['title']}`"
            if not d:
                d = match_domain(owner.get("group"), domains)
                src, why = ("group", f"terminal group `{owner.get('group')}`") if d else (None, None)
        if not d:
            d, src, why = FALLBACK, "fallback", "nothing matched its issue, ledger, PR scope, branch or session"
        w["domain"], w["domain_source"], w["domain_reason"] = d, src, why

    # ---------------------------------------------------------------- kind, phase, flags
    for w in wps:
        owner = st_by_id.get(w.get("station_id") or "")
        note = (owner or {}).get("note") or {}
        led = w.get("_ledger") or {}
        if w["pr"] is not None:
            p = open_by_n.get(w["pr"]) or merged_by_n.get(w["pr"]) or {}
            t = TYPE_RE.match(w.get("title") or "")
            scope = (t.group(2) or "").strip("()").lower() if t else ""
            if (t and t.group(1).lower() == "docs") or scope == "docs":
                w["kind"] = "docs"
            elif FIX_RE.search(w.get("branch") or ""):
                w["kind"] = "data_fix"
            else:
                w["kind"] = "pr"
            w["size"] = _size(p)
            merged = w["stage"] in ("merged", "deployed")
            deployed = w["stage"] == "deployed"
            ready = w["stage"] == "ready" and w.get("mergeable") != "CONFLICTING"
            postmerge = deployed and (bool(w.get("closeout_owed")) or (led.get("state") or "").lower() == "post-merge")
            preview = any("preview" in (l or "").lower() for l in w.get("labels") or []) or note.get("state") == "staging"
            qa = preview or any(QA_RE.search(led.get(k) or "") for k in ("state", "next", "ball", "topic"))
            reviewing = not w["draft"] and (
                w["reviewer"] not in ("none", "off") or w.get("review_decision") in ("APPROVED", "CHANGES_REQUESTED")
                or w["ci"] in ("pending", "failure"))
            if deployed:
                phase = "shipped"
            elif merged:
                phase = "deploy"
            elif (led.get("state") or "").lower() == "review":
                phase = "review"
            elif ready:
                phase = "merge"
            elif qa:
                phase = "qa"
            elif reviewing:
                phase = "review"
            elif p.get("additions") == 0 and p.get("deletions") == 0:
                phase = "plan"
            else:
                phase = "build"
            w["postmerge_owed"] = postmerge
        else:
            led_text = " ".join(str(led.get(k) or "") for k in ("topic", "state", "next", "branch"))
            iss = w.get("_issue") or {}
            iss_text = " ".join(str(iss.get(k) or "") for k in ("title", "state", "summary", "plan", "doc"))
            t = transcripts.get((owner or {}).get("session_id") or "") or {}
            skilled = any(sk in PLAN_SKILLS for sk in t.get("recent_skills") or [])
            phase = non_pr_phase(f"{led_text} {iss_text} {w.get('_state') or ''}", plan_doc=skilled)
            w["size"] = "M"
            w["postmerge_owed"] = False
        w["phase"] = phase
        w["phase_since"] = memory.since(w["id"], phase, now)
        w["parked"] = (any(x in (led.get("state") or "").lower() for x in PARKED_STATES)
                       or bool(owner and owner.get("group") == "ON_HOLD"))
    memory.save()

    # ---------------------------------------------------------------- needs you
    rows: list[dict] = []
    for s in stations:
        if (s.get("activity") or {}).get("status") == "closed":
            continue  # no Claude running there: its last note shows dimmed, it asks nothing of you
        n = s.get("note") or {}
        if n.get("state") == "me":
            refs = [int(x) for x in PR_REF_RE.findall(n.get("text") or "") if int(x) in known_prs]
            rows.append({"id": f"note:{s['id']}", "kind": "note", "station_id": s["id"], "pr": refs[0] if refs else None,
                         "prs": refs, "text": n.get("text"), "since": n.get("ts")})
        q = s.get("pending_question")
        if q:
            rows.append({"id": f"question:{s['id']}", "kind": "question", "station_id": s["id"], "pr": None,
                         "text": q.get("question"), "since": (s.get("activity") or {}).get("last_at")})
    for w in wps:
        if w.get("closeout_owed") and w["phase"] == "shipped":
            rows.append({"id": f"closeout:{w['pr']}", "kind": "closeout", "station_id": w.get("station_id"),
                         "pr": w["pr"], "text": f"Close out #{w['pr']} with the reporter",
                         "since": parse_ts(w.get("deployed_at") or w.get("merged_at"))})
        if w["pr"] is not None and w["phase"] == "merge":
            rows.append({"id": f"merge:{w['pr']}", "kind": "merge", "station_id": w.get("station_id"),
                         "pr": w["pr"], "text": f"Merge #{w['pr']}", "since": w["phase_since"]})
    for slug, i in issues.items():
        if (i.get("state") or "") == "closed":
            continue
        events = i.get("events") or []
        if events and events[0].get("type") in REPLY_EVENTS:
            e = events[0]
            wid = f"pr:{i['pr']}" if i.get("pr") in known_prs else f"issue:{slug}"
            owner = (wp_by_id.get(wid) or {}).get("station_id")
            label = "Reporter replied" if e["type"] == "user_replied" else "Ready for you"
            rows.append({"id": f"reply:{slug}:{e.get('ts')}", "kind": "reply", "station_id": owner,
                         "pr": i.get("pr") if i.get("pr") in known_prs else None,
                         "text": f"{label}: {i.get('title') or slug}", "since": parse_ts(e.get("ts"))})
    rows = [r for r in rows if not (r["kind"] in ACKABLE and r["id"] in acks)]
    for r in rows:
        r["severity"] = SEVERITY[r["kind"]]
    rows.sort(key=lambda r: (-r["severity"], r["since"] is None, r["since"] or 0))
    # One row per PR: the highest-severity row wins; `also`/`also_ids` keep the folded rows' kinds and ids (for ack).
    kept: list[dict] = []
    by_pr: dict[int, dict] = {}
    for r in rows:
        top = by_pr.get(r["pr"]) if r["pr"] is not None else None
        if top is None:
            r["also"], r["also_ids"] = [], []
            kept.append(r)
            if r["pr"] is not None:
                by_pr[r["pr"]] = r
        else:
            top["also_ids"].append(r["id"])
            if r["kind"] != top["kind"] and r["kind"] not in top["also"]:
                top["also"].append(r["kind"])
    rows = kept
    snap["your_move"] = rows
    snap["your_move_count"] = len(rows)

    # ---------------------------------------------------------------- ball, stuck, focus
    owner_prs = {p for r in rows if r["kind"] != "closeout" for p in ([r["pr"]] + r.get("prs", [])) if p}
    for w in wps:
        owner = st_by_id.get(w.get("station_id") or "")
        led_ball = _ball_from_ledger((w.get("_ledger") or {}).get("ball"))
        if w["phase"] == "deploy":
            ball = {"who": "none", "name": None}  # waiting on the production deploy
        elif w["phase"] == "merge":
            ball = {"who": "owner", "name": None}
        elif owner and owner.get("pending_question") and owner["activity"]["status"] != "closed":
            ball = {"who": "owner", "name": None}
        elif w["pr"] is not None and w["pr"] in owner_prs:
            ball = {"who": "owner", "name": None}
        elif w.get("closeout_owed"):
            ball = {"who": "closeout", "name": None}
        elif led_ball and led_ball["who"] in ("owner", "person"):
            ball = led_ball
        elif w["phase"] == "qa":
            ball = {"who": "testers", "name": None}
        elif w["phase"] == "review" and w["ci"] == "pending":
            ball = {"who": "ci", "name": None}
        elif w["phase"] == "review" and w["reviewer"] in ("pending", "approved") and not w.get("reviewer_at_head"):
            ball = {"who": "reviewer", "name": None}
        elif owner and (owner.get("note") or {}).get("state") == "working" and owner["activity"]["status"] == "active":
            ball = {"who": "claude", "name": None}
        else:
            ball = {"who": "none", "name": None}
        w["ball"] = ball
        age = now - (w["phase_since"] or now)
        limit = STUCK_LONG_S if w["phase"] in LONG_PHASES else STUCK_SHORT_S
        w["stuck"] = bool(
            (ball["who"] not in ("owner", "none") and w["phase"] not in ("brainstorm", "plan", "shipped")
             and age > limit)
            or (owner and owner["activity"]["status"] == "stalled"))

    for s in stations:
        ls = sorted(links[s["id"]].values(), key=lambda l: (LINK_RANK[l["source"]], -(l["since"] or 0)))
        s["links"] = ls
        s["workpiece_ids"] = [l["id"] for l in ls]
        s["pr_numbers"] = [l["pr"] for l in ls if l["pr"] is not None]
        focus = None
        wt = _wt_base(s.get("cwd"))
        if wt:
            focus = next((w["id"] for w in wps if w.get("branch") == wt and w["phase"] != "shipped"), None)
        if not focus:
            t = transcripts.get(s.get("session_id") or "") or {}
            for n in reversed(t.get("pr_numbers") or []):
                if n in open_prs:
                    focus = f"pr:{n}"
                    break
        s["focus_workpiece_id"] = focus

    # ---------------------------------------------------------------- domains list + shipped
    for sh in snap["shipped"]:
        sh["domain"] = (wp_by_pr.get(sh["pr"]) or {}).get("domain", FALLBACK)
    out = []
    for d in domains:
        st_ids = [s["id"] for s in stations if s["domain"] == d["id"]]
        live = [w for w in wps if w["domain"] == d["id"] and w["phase"] != "shipped"]
        if not st_ids and not live:
            continue
        out.append({"id": d["id"], "label": d.get("label"), "code": d.get("code"), "color": d.get("color"),
                    "lane": len(out), "station_ids": st_ids,
                    "workpiece_ids": [w["id"] for w in wps if w["domain"] == d["id"]],
                    "counts": {"live": len([w for w in live if not w["parked"]]),
                               "owner": len([w for w in live if w["ball"]["who"] == "owner"]),
                               "parked": len([w for w in live if w["parked"]])}})
    snap["pipeline_stages"] = list(config.PHASES)
    snap["domains"] = out

    wps[:] = unique_workpieces(wps)
    for w in wps:
        w["label"] = (w.get("title") or "").strip() or (f"#{w['pr']}" if w.get("pr") else "Untitled work")
        for k in ("_state", "_ledger", "_issue"):
            w.pop(k, None)
    from .skills_view import attach as attach_skills
    return attach_skills(snap, data)
