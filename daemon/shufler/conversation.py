"""On-demand conversation view of one session's transcript (contract: Conversation panel).

Message text is returned only through this module's endpoints, never in the broadcast snapshot.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .transcripts import parse_ts

TAIL_START = 2 * 1024 * 1024
TAIL_MAX = 48 * 1024 * 1024
RESULT_CAP = 2048
_TURN_LINE_RE = re.compile(r'"type":\s?"(user|assistant)"')
_HARNESS_RE = re.compile(
    r"<(system-reminder|task-notification|local-command-stdout|local-command-stderr|command-message|"
    r"command-args|teammate-message)[^>]*>.*?</\1>", re.S)
_HARNESS_PREFIXES = ("<local-command", "<task-notification", "<system-reminder", "Caveat: The messages below")


def _clean_user_text(text: str) -> str:
    text = _HARNESS_RE.sub("", text)
    m = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if m:
        text = re.sub(r"<command-name>.*?</command-name>", "", text, flags=re.S).strip()
        text = (m.group(1).strip() + (" " + text if text else "")).strip()
    text = text.strip()
    return "" if text.startswith(_HARNESS_PREFIXES) else text


def tool_summary(name: str, inp: dict) -> str:
    if not isinstance(inp, dict):
        return ""
    if name == "Bash":
        return str(inp.get("command") or "")[:100]
    if name in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        return str(inp.get("file_path") or inp.get("notebook_path") or "")
    if name in ("Agent", "Task"):
        return str(inp.get("description") or "")[:100]
    if name in ("Grep", "Glob"):
        return str(inp.get("pattern") or "")[:100]
    if name == "AskUserQuestion":
        qs = inp.get("questions") or [{}]
        return str((qs[0] or {}).get("question") or "")[:100] if isinstance(qs, list) else ""
    for key in ("description", "query", "url", "prompt", "skill", "to"):
        if inp.get(key):
            return str(inp[key])[:100]
    return ""


def _result_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def _read_tail(path: Path, nbytes: int) -> tuple[list[str], bool]:
    """Last whole lines within nbytes; second value says whether the file start was reached."""
    with open(path, "rb") as fh:
        fh.seek(0, 2)
        size = fh.tell()
        start = max(0, size - nbytes)
        fh.seek(start)
        if start:
            fh.readline()
        data = fh.read()
    return data.decode("utf-8", errors="replace").splitlines(), start == 0


def parse_turns(lines: list[str], *, results: bool = False) -> list[dict]:
    turns: list[dict] = []
    by_tool_id: dict[str, dict] = {}
    last_msg_id = None
    for line in lines:
        if not _TURN_LINE_RE.search(line):
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (rec.get("isMeta") or rec.get("isSidechain") or rec.get("isCompactSummary")
                or rec.get("type") not in ("user", "assistant")):
            continue
        msg = rec.get("message") or {}
        content = msg.get("content")
        ts = parse_ts(rec.get("timestamp"))
        if rec["type"] == "user":
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
            texts = []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    t = _clean_user_text(b.get("text") or "")
                    if t:
                        texts.append(t)
                elif b.get("type") == "tool_result" and results:
                    tool = by_tool_id.get(b.get("tool_use_id"))
                    if tool is not None:
                        tool["result"] = _result_text(b.get("content"))[:RESULT_CAP]
            if texts:
                turns.append({"ts": ts, "role": "user", "text": "\n\n".join(texts), "tools": []})
                last_msg_id = None
            continue
        mid = msg.get("id")
        if turns and turns[-1]["role"] == "assistant" and mid and mid == last_msg_id:
            turn = turns[-1]
        else:
            turn = {"ts": ts, "role": "assistant", "text": "", "tools": []}
            turns.append(turn)
        last_msg_id = mid
        for b in content if isinstance(content, list) else []:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text" and b.get("text"):
                turn["text"] = (turn["text"] + "\n\n" + b["text"]).strip()
            elif b.get("type") == "tool_use":
                tool = {"name": b.get("name"), "summary": tool_summary(b.get("name") or "", b.get("input") or {})}
                turn["tools"].append(tool)
                if b.get("id"):
                    by_tool_id[b["id"]] = tool
    return [t for t in turns if t["text"] or t["tools"]]


def read_conversation(path: str | Path, n: int = 20, before: float | None = None,
                      results: bool = False, pr: int | None = None) -> dict:
    path = Path(path)
    n = max(1, min(int(n), 200))
    nbytes = TAIL_START
    while True:
        lines, at_start = _read_tail(path, nbytes)
        turns = parse_turns(lines, results=results)
        if before is not None:
            turns = [t for t in turns if (t["ts"] or 0) < before]
        filtered = turns
        if pr is not None:
            pat = re.compile(rf"#{pr}\b|/pull/{pr}\b")
            filtered = [t for t in turns if pat.search(t["text"]) or any(pat.search(x["summary"]) for x in t["tools"])]
        if len(filtered) > n or at_start or nbytes >= TAIL_MAX:
            break
        nbytes *= 4
    if pr is not None and not filtered:
        filtered = turns
        pr_matched = False
    else:
        pr_matched = pr is not None
    page = filtered[-n:]
    out = {"turns": page, "has_more": len(filtered) > n or not at_start}
    if pr is not None:
        out["filtered_by_pr"] = pr_matched
    return out


SEARCH_MAX = 200
FILE_TOOLS = ("Edit", "Write", "NotebookEdit", "MultiEdit")


def _all_lines(path: Path):
    with open(path, "rb") as fh:
        for raw in fh:
            yield raw.decode("utf-8", errors="replace")


def search_history(path: str | Path, q: str, limit: int = SEARCH_MAX) -> dict:
    """Case-insensitive substring search over user and assistant text across the whole transcript."""
    needle = (q or "").strip().lower()
    if not needle:
        return {"results": [], "truncated": False}
    results = []
    for line in _all_lines(Path(path)):
        if needle not in line.lower() or not _TURN_LINE_RE.search(line):
            continue
        for turn in parse_turns([line]):
            low = turn["text"].lower()
            i = low.find(needle)
            if i < 0:
                continue
            start = max(0, i - 60)
            snippet = turn["text"][start:i + len(needle) + 60].replace("\n", " ")
            results.append({"ts": turn["ts"], "role": turn["role"],
                            "snippet": ("…" if start else "") + snippet + ("…" if i + len(needle) + 60 < len(low) else "")})
            if len(results) >= limit:
                return {"results": results, "truncated": True}
    return {"results": results, "truncated": False}


def history_summary(path: str | Path, session_id: str | None = None) -> dict:
    """Whole-file pass: start, prompt count, PR links, skills, files touched, compactions, prior sessions."""
    started = None
    turns = 0
    pr_links: list[dict] = []
    seen_prs: set[int] = set()
    skills: dict[str, int] = {}
    files: set[str] = set()
    compactions: list[float | None] = []
    other_sessions: list[str] = []
    for line in _all_lines(Path(path)):
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = parse_ts(rec.get("timestamp"))
        if started is None and ts:
            started = ts
        sid = rec.get("sessionId")
        if session_id and sid and sid != session_id and sid not in other_sessions:
            other_sessions.append(sid)
        rtype = rec.get("type")
        if rtype == "pr-link":
            n = rec.get("prNumber")
            if isinstance(n, int) and n not in seen_prs:
                seen_prs.add(n)
                pr_links.append({"pr": n, "ts": ts})
        elif rtype == "system" and rec.get("subtype") == "compact_boundary":
            compactions.append(ts)
        elif rtype == "user":
            turns += sum(1 for t in parse_turns([line]) if t["role"] == "user")
        elif rtype == "assistant" and not rec.get("isSidechain"):
            for b in (rec.get("message") or {}).get("content") or []:
                if not isinstance(b, dict) or b.get("type") != "tool_use":
                    continue
                inp = b.get("input") or {}
                if b.get("name") == "Skill" and inp.get("skill"):
                    skills[str(inp["skill"])] = skills.get(str(inp["skill"]), 0) + 1
                if b.get("name") in FILE_TOOLS and (inp.get("file_path") or inp.get("notebook_path")):
                    files.add(str(inp.get("file_path") or inp.get("notebook_path")))
    return {"started_at": started, "turns": turns, "pr_links": pr_links,
            "skills_used": [{"skill": k, "count": v} for k, v in sorted(skills.items(), key=lambda kv: -kv[1])],
            "files_touched_count": len(files), "compactions": compactions, "prior_session_ids": other_sessions}
