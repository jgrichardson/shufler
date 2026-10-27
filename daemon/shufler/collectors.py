"""Data-source collectors. Each one is isolated: an exception marks only its
own source offline, the snapshot keeps the last good data."""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from . import adapters as adapters_mod
from . import config
from .adapters.agent.claude_code import ClaudeCodeAdapter, mask_email  # noqa: F401 - re-exported
from .adapters.terminal.cmux import CMUX_KEEP  # noqa: F401 - re-exported
from .adapters.tracker.intake import IntakeAdapter
from .adapters.tracker.ledgers import LedgerAdapter, ledger_branch, parse_ledger  # noqa: F401
from .transcripts import parse_ts

TITLE_SID_RE = re.compile(r"\s*·\s*([0-9a-f]{8})\s*$")

@dataclass
class Source:
    name: str
    interval: float
    fn: Callable[[], Any]
    ok: bool = False
    error: str | None = None
    data: Any = None
    updated_at: float | None = None
    last_attempt: float = 0.0
    running: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def due(self, now: float) -> bool:
        return not self.running and now - self.last_attempt >= self.interval

    def collect(self) -> bool:
        """Run the collector; return True when data changed."""
        self.running = True
        self.last_attempt = time.time()
        try:
            data = self.fn()
            changed = data != self.data or not self.ok
            self.data, self.ok, self.error, self.updated_at = data, True, None, time.time()
            return changed
        except Exception as e:  # noqa: BLE001 - one bad source must never stop the others
            was_ok = self.ok
            self.ok, self.error = False, f"{type(e).__name__}: {e}"[:300]
            return was_ok
        finally:
            self.running = False

    def health(self, now: float) -> dict:
        h: dict[str, Any] = {"ok": self.ok, "age": round(now - self.updated_at, 1) if self.updated_at else None}
        if self.error:
            h["error"] = self.error
        return h


def _cache_write(name: str, data: Any) -> None:
    try:
        config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = config.CACHE_DIR / f"{name}.json.tmp"
        tmp.write_text(json.dumps(data))
        tmp.replace(config.CACHE_DIR / f"{name}.json")
    except OSError:
        pass


def cache_read(name: str) -> Any:
    try:
        return json.loads((config.CACHE_DIR / f"{name}.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None


def collect_terminal() -> list[dict]:
    """Workspace records from the configured terminal adapter (adapters/terminal/__init__.py has the shape)."""
    return adapters_mod.current().terminal.list_workspaces()



def collect_groups() -> list[dict]:
    return adapters_mod.current().terminal.list_groups()


# ---------------------------------------------------------------- notes

def collect_notes(notes_dir: Path | None = None) -> dict[str, dict]:
    notes_dir = notes_dir or config.SESSION_NOTES_DIR
    out: dict[str, dict] = {}
    if not notes_dir or not notes_dir.is_dir():
        raise FileNotFoundError(str(notes_dir))
    for f in notes_dir.glob("*.json"):
        try:
            n = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        sid = n.get("session") or f.stem
        out[sid] = {k: n.get(k) for k in ("session", "state", "text", "ts", "cwd", "ws_ref")}
    return out


# ---------------------------------------------------------------- trackers

def collect_intake(records_dir: Path | None = None) -> dict[str, dict]:
    return IntakeAdapter(records_dir or config.ISSUES_DIR, card_key=config.BOARD_RECORD_KEY).collect()


def collect_ledgers(ledgers_dir: Path | None = None) -> dict[str, list[dict]]:
    return LedgerAdapter(ledgers_dir or config.LEDGERS_DIR).collect()


# ---------------------------------------------------------------- scm

def collect_gh_open(scm) -> list[dict]:
    out = scm.open_prs()
    _cache_write("gh_open", out)
    return out


class PrDetails:
    """`gh pr view` per open PR: mergeable state and head commit time (for reviewer_at_head)."""

    def __init__(self, scm, open_source: Source):
        self.scm, self.open_source = scm, open_source
        self.known: dict[str, dict] = cache_read("gh_detail") or {}

    def _view(self, n: int) -> dict:
        return self.scm.pr_detail(n)

    def __call__(self) -> dict[str, dict]:
        numbers = [p["number"] for p in self.open_source.data or []]
        failures = 0
        unknown = []
        for n in numbers:
            try:
                self.known[str(n)] = self._view(n)
            except Exception:  # noqa: BLE001 - keep the last known value for this PR
                failures += 1
                continue
            if self.known[str(n)]["mergeable"] == "UNKNOWN":
                unknown.append(n)
        if unknown:
            # GitHub computes mergeability lazily: the first query starts it, a second one a moment later reads it.
            time.sleep(4)
            for n in unknown:
                try:
                    self.known[str(n)] = self._view(n)
                except Exception:  # noqa: BLE001
                    pass
        if numbers and failures == len(numbers):
            raise RuntimeError(f"gh pr view failed for all {failures} open PRs")
        live = {str(n) for n in numbers}
        self.known = {k: v for k, v in self.known.items() if k in live}
        _cache_write("gh_detail", self.known)
        return dict(self.known)


def week_start(now: float | None = None) -> datetime:
    dt = datetime.fromtimestamp(now or time.time())
    return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def collect_gh_merged(scm) -> list[dict]:
    out = scm.merged_since(week_start().strftime("%Y-%m-%d"))
    _cache_write("gh_merged", out)
    return out


def worktree_exists(branch: str, cell: str | None) -> bool:
    """A local worktree for the branch: the ledger's Worktree cell when it names a directory, else
    <root>/*/<branch> under each configured worktree root."""
    m = re.search(r"(~?/[^\s`()]+)", cell or "")
    if m and Path(m.group(1)).expanduser().is_dir():
        return True
    return any(p.is_dir() for root in config.WORKTREE_ROOTS for p in Path(root).expanduser().glob(f"*/{branch}"))


class LedgerBranches:
    """Resolves ledger rows keyed by a branch (no PR in the row) against GitHub: the newest PR for that head
    and whether the remote branch still exists, plus a local worktree check. Branches already open or merged
    this week are answered from the PR sources; the rest are asked of gh and cached on disk."""

    REFRESH_S = 1800

    def __init__(self, scm, ledgers: Source, open_source: Source, merged_source: Source):
        self.scm, self.ledgers, self.open_source, self.merged_source = scm, ledgers, open_source, merged_source
        self.known: dict[str, dict] = cache_read("ledger_branches") or {}

    def __call__(self) -> dict:
        now = time.time()
        if self.ledgers.data is None or self.open_source.data is None or self.merged_source.data is None:
            return dict(self.known)  # sources still loading: answer from the disk cache
        local = {p.get("branch"): ("open", p) for p in self.open_source.data or []}
        local.update({p.get("branch"): ("merged", p) for p in self.merged_source.data or []})
        wanted: dict[str, str | None] = {}
        for rows in (self.ledgers.data or {}).values():
            for r in rows:
                b = ledger_branch(r)
                if b and not r.get("pr_numbers"):
                    wanted[b] = r.get("worktree")
        out: dict[str, dict] = {}
        for b, cell in wanted.items():
            wt = worktree_exists(b, cell)
            if b in local:
                state, p = local[b]
                out[b] = {"pr": {"number": p["number"], "state": state, "title": p.get("title"), "url": p.get("url"),
                                 "merged_at": p.get("merged_at")}, "remote": True, "worktree": wt, "checked_at": now}
                continue
            prev = self.known.get(b)
            if prev and now - (prev.get("checked_at") or 0) < self.REFRESH_S:
                out[b] = {**prev, "worktree": wt}
                continue
            try:
                out[b] = {**self.scm.branch_status(b), "worktree": wt, "checked_at": now}
            except Exception:  # noqa: BLE001 - unknown stays unknown; the row is shown as before
                if prev:
                    out[b] = {**prev, "worktree": wt}
        self.known = out
        _cache_write("ledger_branches", out)
        return out


class DeployTracker:
    """Marks merged PRs deployed once their merge commit is in a successful production deploy. Positive
    results are cached on disk for good. A stacked PR (base is not the deploy branch) inherits: it is
    deployed when the PR whose head is its base is deployed, following the chain to the deploy branch;
    if that parent closed unmerged, the child is dropped."""

    MAX_DEPTH = 10
    OPEN_PARENT_TTL_S = 600

    def __init__(self, scm, merged_source: Source):
        self.scm, self.merged_source = scm, merged_source
        self.known: dict[str, dict] = cache_read("deployed") or {}
        self.heads: dict[str, dict] = cache_read("stack_parents") or {}  # base branch → parent PR answer

    def _parent(self, base: str, now: float) -> dict | None:
        """The PR whose head is `base`: merged first, else open, else the newest closed one."""
        for p in self.merged_source.data or []:
            if p.get("branch") == base:
                return {"number": p["number"], "state": "merged", "base": p.get("base"),
                        "merged_at": p.get("merged_at"), "merge_sha": p.get("merge_sha")}
        hit = self.heads.get(base)
        if not hit or (hit.get("state") == "open" and now - hit.get("checked_at", 0) > self.OPEN_PARENT_TTL_S):
            prs = self.scm.prs_for_head(base)
            if not prs:
                hit = {"state": "none", "checked_at": now}
            else:
                rank = {"merged": 0, "open": 1}
                newest_first = sorted(prs, key=lambda x: x.get("created_at") or "", reverse=True)
                best = min(newest_first, key=lambda x: rank.get(x["state"], 2))
                hit = {**best, "checked_at": now}
            self.heads[base] = hit
        return hit if hit.get("state") != "none" else None

    def _root(self, pr: dict, now: float) -> dict:
        """{kind: direct|via|dropped|pending, root: merged PR on the deploy branch, via: immediate parent}."""
        branch = getattr(self.scm, "deploy_branch", "") or config.DEPLOY_BRANCH
        base, via, seen = pr.get("base"), None, {pr.get("branch")}
        root = pr
        for _ in range(self.MAX_DEPTH):
            if not base or base == branch:
                return {"kind": "direct" if via is None else "via", "root": root, "via": via}
            if base in seen:
                return {"kind": "pending", "root": None, "via": via}
            seen.add(base)
            parent = self._parent(base, now)
            if not parent:
                return {"kind": "pending", "root": None, "via": via}
            via = via if via is not None else parent["number"]
            if parent["state"] == "closed":
                return {"kind": "dropped", "root": None, "via": parent["number"]}
            if parent["state"] != "merged":
                return {"kind": "pending", "root": None, "via": via}
            root, base = parent, parent.get("base")
        return {"kind": "pending", "root": None, "via": via}

    def __call__(self) -> dict:
        now = time.time()
        runs = self.scm.deploy_runs()
        good = sorted((r for r in runs if r.get("conclusion") == "success"), key=lambda r: r["createdAt"])
        latest = good[-1] if good else None
        for pr in self.merged_source.data or []:
            key = str(pr["number"])
            if self.known.get(key, {}).get("deployed") or self.known.get(key, {}).get("dropped"):
                continue
            try:
                chain = self._root(pr, now)
            except Exception:  # noqa: BLE001 - lookup failed: try again next cycle
                continue
            if chain["kind"] == "dropped":
                self.known[key] = {"deployed": False, "dropped": True, "shipped_via": chain["via"]}
                continue
            root = chain["root"]
            if not root:
                continue
            rkey = str(root["number"])
            sha = root.get("merge_sha")
            if self.known.get(rkey, {}).get("deployed"):
                self.known[key] = {"deployed": True, "deployed_at": self.known[rkey].get("deployed_at"),
                                   "shipped_via": chain["via"]}
                continue
            if not latest or not sha:
                continue
            if self.scm.contains(sha, latest["headSha"]):
                merged_ts = parse_ts(root.get("merged_at")) or 0
                first = next((r for r in good if (parse_ts(r["createdAt"]) or 0) >= merged_ts), latest)
                rec = {"deployed": True, "deployed_at": first["createdAt"]}
                if chain["kind"] == "via":
                    rec["shipped_via"] = chain["via"]
                    if rkey not in self.known and root is not pr:
                        self.known[rkey] = {"deployed": True, "deployed_at": first["createdAt"]}
                self.known[key] = rec
        _cache_write("deployed", self.known)
        _cache_write("stack_parents", self.heads)
        return {
            "latest_success": latest and {"id": latest["databaseId"], "sha": latest["headSha"], "at": latest["createdAt"]},
            "in_progress": any(r.get("status") != "completed" for r in runs),
            "prs": dict(self.known),
        }


# ---------------------------------------------------------------- accounts (telemetry inputs)

def collect_accounts(accounts: dict | None = None, usage_dir: Path | None = None) -> dict[str, dict]:
    """Per account: label, masked email, compaction window and the statusline's cached quota."""
    if accounts is None and usage_dir is None:
        return adapters_mod.current().agent.accounts()
    accounts = accounts or config.ACCOUNTS
    usage = {n: usage_dir / f"{n}.json" for n in accounts} if usage_dir else dict(config.USAGE_CACHE)
    return ClaudeCodeAdapter({}, accounts, usage).accounts()


# ---------------------------------------------------------------- registry

class Collectors:
    """Registers a source per enabled adapter; a source that is off is simply absent."""

    def __init__(self, adapters: adapters_mod.Adapters | None = None):
        a = self.adapters = adapters or adapters_mod.current()
        self.transcripts = a.agent.transcript_index()
        self.sources: dict[str, Source] = {}
        add = self._add
        # The terminal's workspaces live under the neutral key "terminal"; health() reports them under the
        # adapter's name (sources.cmux, sources.iterm2, ...), as the snapshot always has.
        add("terminal", getattr(a.terminal, "poll_interval", 2), a.terminal.list_workspaces)
        add("groups", 10, a.terminal.list_groups)
        if config.SESSION_NOTES_DIR:
            add("notes", 2, collect_notes)
        if "intake" in a.trackers:
            add("intake", 10, a.trackers["intake"].collect)
        if "ledgers" in a.trackers:
            add("ledgers", 30, a.trackers["ledgers"].collect)
        if config.PROCESSES_ENABLED:
            from .processes import ProcessScanner
            add("processes", 10, ProcessScanner())
        add("transcripts", 3, self._scan_transcripts)
        self.skill_index = a.agent.skill_index()
        add("skills", 60, self._scan_skills)
        self._skills_primed = False
        if a.scm:
            merged = add("gh_merged", 60, lambda: collect_gh_merged(a.scm))
            gh_open = add("gh", 60, lambda: collect_gh_open(a.scm))
            add("gh_detail", 90, PrDetails(a.scm, gh_open))
            if "ledgers" in self.sources:
                add("ledger_branches", 30, LedgerBranches(a.scm, self.sources["ledgers"], gh_open, merged))
            if getattr(a.scm, "deploy_workflow", ""):
                add("deploys", 120, DeployTracker(a.scm, merged))
        if a.reviewer and getattr(a.reviewer, "command", None):
            add("reviewer_watch", 30, a.reviewer.status)
        add("accounts", 10, a.agent.accounts)
        if "board" in a.trackers and "intake" in self.sources:
            intake = self.sources["intake"]
            add("board", 300, lambda: a.trackers["board"].collect(intake.data))
        # Last known code-host state from disk so the floor is populated before the first call returns.
        for name, cache in (("gh", "gh_open"), ("gh_merged", "gh_merged"), ("gh_detail", "gh_detail")):
            cached = cache_read(cache) if name in self.sources else None
            if cached is not None:
                self.sources[name].data = cached

    def _add(self, name: str, interval: float, fn: Callable[[], Any]) -> Source:
        s = Source(name, interval, fn)
        self.sources[name] = s
        return s

    def _data(self, name: str):
        s = self.sources.get(name)
        return s.data if s else None

    def _scan_transcripts(self) -> dict[str, dict]:
        wanted = set((self._data("notes") or {}).keys())
        wanted |= {i["session_id"] for i in (self._data("intake") or {}).values() if i.get("session_id")}
        wanted |= {p["session_id"] for p in self._data("processes") or [] if p.get("session_id")}
        prefixes = set()
        for w in self._data("terminal") or []:
            m = TITLE_SID_RE.search(w.get("custom_title") or w.get("title") or "")
            if m:
                prefixes.add(m.group(1))
        return self.transcripts.scan(wanted, prefixes=prefixes)

    def _scan_skills(self) -> dict:
        from . import skills_view
        cwds = {w.get("current_directory") for w in self._data("terminal") or [] if w.get("current_directory")}
        cwds |= {t.get("cwd") for t in (self._data("transcripts") or {}).values() if t.get("cwd")}
        if not cwds and not self._skills_primed:
            self.sources["skills"].last_attempt -= 55  # stations not loaded yet: look again in ~5s
        self._skills_primed = self._skills_primed or bool(cwds)
        return skills_view.scan(self.skill_index, cwds)

    def data(self) -> dict[str, Any]:
        return {name: s.data for name, s in self.sources.items()}

    def health(self, now: float) -> dict[str, dict]:
        term = getattr(self.adapters.terminal, "name", None) or "terminal"
        return {(term if name == "terminal" else name): s.health(now) for name, s in self.sources.items()}
