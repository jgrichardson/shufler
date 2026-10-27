"""Incremental reader for Claude Code transcripts.

Only metadata leaves this module: timestamps, tool names, counts, pr-link
numbers, cwd and token totals. Message text is never stored.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import config

_TS_RE = re.compile(r'"timestamp":\s?"([^"]+)"')
_CWD_RE = re.compile(r'"cwd":\s?"([^"]+)"')
_TOOL_RESULT_RE = re.compile(r'"tool_use_id":\s?"([^"]+)"')
_PR_LINK_RE = re.compile(r'"type":\s?"pr-link"')
_ASSISTANT_RE = re.compile(r'"type":\s?"assistant"')
_USER_RE = re.compile(r'"type":\s?"user"')
_NOT_PROMPT_RE = re.compile(r'"tool_use_id"|"isMeta":\s?true|"isCompactSummary":\s?true')
_COST_RE = re.compile(r'"type":\s?"cost-state"')
_COMPACT_RE = re.compile(r'"subtype":\s?"compact_boundary"')
_COMMAND_RE = re.compile(r"<command-name>/?([\w:.-]+)</command-name>")
RECENT_SKILLS = 10
_HARNESS_PREFIXES = ("<local-command", "<task-notification", "<system-reminder", "<command-message",
                     "Caveat: The messages below", "<teammate-message")
AGENT_TOOLS = {"Agent", "Task"}
QUESTION_TOOL = "AskUserQuestion"
_RECOMMENDED_RE = re.compile(r"\s*\(recommended\)\s*", re.I)


def parse_question(tool_input: dict) -> dict | None:
    """Question + options only (the one piece of transcript text the contract allows)."""
    qs = tool_input.get("questions") if isinstance(tool_input, dict) else None
    if not isinstance(qs, list) or not qs or not isinstance(qs[0], dict):
        return None
    q = qs[0]
    options = []
    for o in q.get("options") or []:
        if not isinstance(o, dict):
            continue
        label = str(o.get("label") or "")
        options.append({
            "label": _RECOMMENDED_RE.sub(" ", label).strip(),
            "description": str(o.get("description") or "")[:500],
            "recommended": bool(_RECOMMENDED_RE.search(label)),
        })
    return {"question": str(q.get("question") or "")[:1000], "header": str(q.get("header") or "")[:100],
            "options": options, "multi_select": bool(q.get("multiSelect")), "more": len(qs) - 1}


def parse_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def local_day(epoch: float) -> str:
    return datetime.fromtimestamp(epoch).strftime("%Y-%m-%d")


@dataclass
class SessionStats:
    session_id: str
    account: str
    path: str
    offset: int = 0
    last_at: float | None = None
    last_tool: str | None = None
    cwd: str | None = None
    pending_agents: set[str] = field(default_factory=set)
    pr_numbers: list[int] = field(default_factory=list)
    tokens_by_day: dict[str, int] = field(default_factory=dict)
    tool_calls: int = 0
    pending_question: dict | None = None
    pr_link_ts: dict[int, float | None] = field(default_factory=dict)
    model: str | None = None
    context_tokens: int | None = None
    tokens_in_by_day: dict[str, int] = field(default_factory=dict)
    tokens_out_by_day: dict[str, int] = field(default_factory=dict)
    cost_usd: float | None = None
    started_at: float | None = None
    turns: int = 0
    compactions: int = 0
    last_assistant_preview: str | None = None
    recent_skills: list[str] = field(default_factory=list)
    _question_id: str | None = None
    first_ts: float | None = None
    _last_msg_id: str | None = None
    _partial: bytes = b""

    def feed_line(self, line: str) -> None:
        if _COST_RE.search(line):
            try:
                rec = json.loads(line)
                self.cost_usd = float(rec["totalCostUSD"]) if rec.get("totalCostUSD") is not None else self.cost_usd
                if rec.get("startTime"):
                    self.started_at = float(rec["startTime"]) / 1000.0
            except (json.JSONDecodeError, ValueError, TypeError):
                pass
            return
        if _COMPACT_RE.search(line):
            self.compactions += 1
            return
        if _PR_LINK_RE.search(line):
            try:
                n = int(json.loads(line).get("prNumber"))
            except (ValueError, TypeError, json.JSONDecodeError):
                return
            if n in self.pr_numbers:
                self.pr_numbers.remove(n)
            self.pr_numbers.append(n)
            m = _TS_RE.search(line)
            self.pr_link_ts[n] = parse_ts(m.group(1)) if m else None
            return
        is_assistant = bool(_ASSISTANT_RE.search(line))
        is_user = not is_assistant and bool(_USER_RE.search(line))
        if not (is_assistant or is_user):
            return
        m = _TS_RE.search(line)
        ts = parse_ts(m.group(1)) if m else None
        if ts and (self.last_at is None or ts > self.last_at):
            self.last_at = ts
        c = _CWD_RE.search(line)
        if c:
            self.cwd = c.group(1)
        if is_user:
            for name in _COMMAND_RE.findall(line):
                self._skill(name)
            if not _NOT_PROMPT_RE.search(line):
                try:
                    content = (json.loads(line).get("message") or {}).get("content")
                except json.JSONDecodeError:
                    content = None
                text = content if isinstance(content, str) else " ".join(
                    b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")
                if text.strip() and not text.lstrip().startswith(_HARNESS_PREFIXES):
                    self.turns += 1
            for tid in _TOOL_RESULT_RE.findall(line):
                self.pending_agents.discard(tid)
                if tid == self._question_id:
                    self.pending_question, self._question_id = None, None
            return
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            return
        msg = rec.get("message") or {}
        if not isinstance(msg, dict):
            return
        msg_id = msg.get("id")
        usage = msg.get("usage") or {}
        model = msg.get("model")
        if isinstance(model, str) and model and not model.startswith("<") and not rec.get("isSidechain"):
            self.model = model
        if usage and ts and msg_id != self._last_msg_id:
            tin, tout = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
            day = local_day(ts)
            self.tokens_by_day[day] = self.tokens_by_day.get(day, 0) + tin + tout
            self.tokens_in_by_day[day] = self.tokens_in_by_day.get(day, 0) + tin
            self.tokens_out_by_day[day] = self.tokens_out_by_day.get(day, 0) + tout
        if usage and not rec.get("isSidechain"):
            self.context_tokens = (int(usage.get("input_tokens") or 0) + int(usage.get("cache_read_input_tokens") or 0)
                                   + int(usage.get("cache_creation_input_tokens") or 0)
                                   + int(usage.get("output_tokens") or 0))
        self._last_msg_id = msg_id
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                    if not rec.get("isSidechain"):
                        self.last_assistant_preview = " ".join(str(block["text"]).split())[:120]
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    name = block.get("name")
                    if isinstance(name, str):
                        self.last_tool = name
                        self.tool_calls += 1
                        if name in AGENT_TOOLS and block.get("id"):
                            self.pending_agents.add(block["id"])
                        if name == "Skill" and isinstance((block.get("input") or {}).get("skill"), str):
                            self._skill(block["input"]["skill"])
                        if name == QUESTION_TOOL:
                            q = parse_question(block.get("input") or {})
                            if q:
                                self.pending_question, self._question_id = q, block.get("id")

    def _skill(self, name: str) -> None:
        name = name.rsplit(":", 1)[-1]
        if name in self.recent_skills:
            self.recent_skills.remove(name)
        self.recent_skills.append(name)
        del self.recent_skills[:-RECENT_SKILLS]

    def feed_bytes(self, data: bytes) -> None:
        buf = self._partial + data
        lines = buf.split(b"\n")
        self._partial = lines.pop()
        for raw in lines:
            if raw:
                self.feed_line(raw.decode("utf-8", errors="replace"))

    def live_subagents(self, now: float) -> int:
        sub = Path(self.path).with_suffix("") / "subagents"
        recent = 0
        try:
            for f in sub.glob("*.jsonl"):
                if now - f.stat().st_mtime <= config.SUBAGENT_LIVE_S:
                    recent += 1
        except OSError:
            pass
        return max(recent, len(self.pending_agents))

    def summary(self, now: float) -> dict:
        day = local_day(now)
        try:
            size = Path(self.path).stat().st_size
        except OSError:
            size = None
        return {
            "model": self.model, "context_tokens": self.context_tokens,
            "tokens_in_today": self.tokens_in_by_day.get(day, 0), "tokens_out_today": self.tokens_out_by_day.get(day, 0),
            "cost_usd_session": self.cost_usd, "session_started_at": self.started_at or self.first_ts,
            "transcript_size_bytes": size, "turns": self.turns, "compactions": self.compactions,
            "session_id": self.session_id,
            "account": self.account,
            "last_at": self.last_at,
            "last_tool": self.last_tool,
            "cwd": self.cwd,
            "subagents": self.live_subagents(now),
            "pr_numbers": list(self.pr_numbers),
            "tokens_today": self.tokens_by_day.get(local_day(now), 0),
            "tool_calls": self.tool_calls,
            "pending_question": self.pending_question,
            "last_assistant_preview": self.last_assistant_preview,
            "pr_link_ts": dict(self.pr_link_ts),
            "recent_skills": list(self.recent_skills),
        }


class TranscriptIndex:
    def __init__(self, roots: dict[str, Path] | None = None):
        self.roots = roots or config.TRANSCRIPT_ROOTS
        self.sessions: dict[str, SessionStats] = {}

    def _candidates(self, wanted: set[str], now: float, prefixes: tuple[str, ...] = ()) -> dict[str, tuple[str, Path]]:
        found: dict[str, tuple[str, Path, float]] = {}
        for account, root in self.roots.items():
            if not root.is_dir():
                continue
            for f in root.glob("*/*.jsonl"):
                sid = f.stem
                try:
                    mtime = f.stat().st_mtime
                except OSError:
                    continue
                if (sid not in wanted and sid not in self.sessions and not sid.startswith(prefixes)
                        and now - mtime > config.TRANSCRIPT_RECENT_S):
                    continue
                prev = found.get(sid)
                if prev is None or mtime > prev[2]:
                    found[sid] = (account, f, mtime)
        return {sid: (a, p) for sid, (a, p, _) in found.items()}

    def scan(self, wanted: set[str] | None = None, now: float | None = None,
             prefixes: set[str] | None = None) -> dict[str, dict]:
        now = now or time.time()
        for sid, (account, path) in self._candidates(wanted or set(), now, tuple(prefixes or ())).items():
            st = self.sessions.get(sid)
            if st is None or st.path != str(path):
                st = SessionStats(session_id=sid, account=account, path=str(path))
                self.sessions[sid] = st
            self._read(st)
        return {sid: st.summary(now) for sid, st in self.sessions.items()}

    @staticmethod
    def _read(st: SessionStats) -> None:
        try:
            size = Path(st.path).stat().st_size
        except OSError:
            return
        if size < st.offset:
            st.offset, st._partial = 0, b""
        if size == st.offset:
            return
        with open(st.path, "rb") as fh:
            if st.offset == 0 and st.first_ts is None:
                head = fh.read(65536).decode("utf-8", errors="replace")
                m = _TS_RE.search(head)
                st.first_ts = parse_ts(m.group(1)) if m else None
                fh.seek(0)
            if st.offset == 0 and size > config.TRANSCRIPT_FIRST_READ_MAX:
                fh.seek(size - config.TRANSCRIPT_FIRST_READ_MAX)
                fh.readline()
            else:
                fh.seek(st.offset)
            while chunk := fh.read(4 * 1024 * 1024):
                st.feed_bytes(chunk)
            st.offset = fh.tell()
