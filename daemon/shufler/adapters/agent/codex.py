"""OpenAI Codex CLI: rollout transcripts, process matching, screen reading.

Codex writes one rollout per session under $CODEX_HOME/sessions (default ~/.codex/sessions):
`YYYY/MM/DD/rollout-<local time>-<session uuid>.jsonl`, one JSON record per line, each
`{"timestamp", "type", "payload"}` with type session_meta (id, cwd, cli_version), turn_context (cwd, model,
approval_policy), response_item (message / function_call / custom_tool_call / local_shell_call and their outputs),
event_msg (task_started, task_complete, turn_aborted, token_count, user_message, agent_message, ...) and compacted.
Early builds wrote `sessions/rollout-<date>-<uuid>.json`, one JSON object `{session, items}`; those are read for
their id, start time and turns only. Unknown record types are ignored, a partial last line waits for the next read,
and a large file is read from its tail, as for Claude Code (transcripts.py).

Codex does not record approval prompts in the rollout. A session sitting in a turn with no new records is probed on
screen instead (collectors.ScreenProbe, `parse_approval_screen`): the overlay names its options and their keys.

As in transcripts.py only metadata leaves the summary (timestamps, tool names, counts, token totals, cwd, model,
the pending question and a 120-character preview); message text is served by conversation.py on request.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

ROLLOUT_RE = re.compile(r"^rollout-.*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
                        r"\.jsonl?$")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_PR_URL_RE = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/pull/(\d{1,7})\b")
# User-role messages Codex injects itself (environment, AGENTS.md, aborted-turn markers): not prompts.
_INJECTED_PREFIXES = ("<", "# AGENTS.md instructions", "# Context from my IDE")
RECENT_S = 24 * 3600
FIRST_READ_MAX = 64 * 1024 * 1024
TOOL_SUMMARY_MAX = 100

# Subcommands that are not an interactive session (`codex exec` is the headless run, like `claude -p`).
NON_INTERACTIVE = {"exec", "e", "review", "login", "logout", "mcp", "mcp-server", "app-server", "app", "completion",
                   "update", "doctor", "sandbox", "debug", "apply", "a", "cloud", "exec-server", "features", "help",
                   "plugin", "agents", "remote-control", "queue", "archive", "delete", "unarchive",
                   "migrate-rollouts", "responses-api-proxy", "generate-ts", "proto"}
# Options that take a value, so the token after them is not the subcommand or prompt.
VALUE_FLAGS = {"-c", "--config", "--enable", "--disable", "--remote", "-m", "--model", "-p", "--profile", "-s",
               "--sandbox", "-a", "--ask-for-approval", "-C", "--cd", "-i", "--image", "--local-provider",
               "--add-dir", "--remote-auth-token-env"}
LAUNCHERS = ("node", "bun", "deno")


# ---------------------------------------------------------------- processes

def match_process(tokens: list[str]) -> dict | None:
    """A `ps` command line split on spaces → {session_id, name, cwd_arg, launcher} for an interactive Codex
    session, else None. The npm package runs `node …/bin/codex` which starts the native `…/bin/codex`; both
    match (launcher True/False) and processes.parse_ps keeps one per tty."""
    if not tokens:
        return None
    first = os.path.basename(tokens[0])
    launcher = False
    if first in LAUNCHERS and len(tokens) > 1 and os.path.basename(tokens[1]) in ("codex", "codex.js"):
        args, launcher = tokens[2:], True
    elif first == "codex":
        args = tokens[1:]
    else:
        return None
    positional: list[str] = []
    cwd_arg = None
    i = 0
    while i < len(args):
        t = args[i]
        if t in VALUE_FLAGS:
            if t in ("-C", "--cd") and i + 1 < len(args):
                cwd_arg = args[i + 1]
            i += 2
            continue
        if t.startswith("--cd="):
            cwd_arg = t[5:]
        elif not t.startswith("-"):
            positional.append(t)
        i += 1
    sub = positional[0] if positional else None
    if sub in NON_INTERACTIVE:
        return None
    session_id = None
    if sub == "resume" and len(positional) > 1 and UUID_RE.match(positional[1]):
        session_id = positional[1].lower()
    return {"session_id": session_id, "name": None, "cwd_arg": cwd_arg, "launcher": launcher}


# ---------------------------------------------------------------- screen

# The composer's dimmed placeholders (current builds, then the rotating examples of earlier ones).
_PLACEHOLDERS = ("ask codex to do anything", "ask a follow-up question", "explain this codebase",
                 "summarize recent commits", "implement {feature}", "find and fix a bug in @filename",
                 "write tests for @filename", "improve documentation in @filename", "run /review on my current changes",
                 "use /skills to list available skills")
_OPTION_RE = re.compile(r"^(?:›\s*)?(\d+)\.\s+(.+?)(?:\s+\(([^()]{1,12})\))?\s*$")
_STATUS_HINTS = (" · ", "context left", "for shortcuts", "to interrupt")


def _clean(line: str) -> str:
    return line.replace("\xa0", " ").rstrip()


def input_draft(screen: str) -> str | None:
    """Text sitting unsent in Codex's composer, "" when empty, None when no composer is on screen.

    The composer is the last `›` line followed by Codex's status line (model · cwd, or "? for shortcuts").
    The plain-text screen does not show that the placeholder is dimmed, so the stock placeholder counts as empty;
    a numbered `› 1. …` line is a selection list (approval, picker), not the composer."""
    lines = [_clean(l) for l in screen.splitlines()]
    for i in range(len(lines) - 1, -1, -1):
        s = lines[i].lstrip()
        if not s.startswith("›") or _OPTION_RE.match(s):
            continue
        body = [s[1:].strip()]
        for nxt in lines[i + 1:i + 8]:
            low = nxt.strip().lower()
            if any(h in low for h in _STATUS_HINTS) and not nxt.startswith("    "):
                text = " ".join(b for b in body if b)
                return "" if text.lower() in _PLACEHOLDERS else text
            if nxt.startswith("  ") and nxt.strip():
                body.append(nxt.strip())
            elif nxt.strip():
                break
        return None
    return None


def echo_line(screen: str, text: str) -> str | None:
    """The transcript line where the sent prompt shows up after Enter (Codex echoes it after `›`)."""
    probe = " ".join(text.split())[:40]
    for line in reversed([_clean(l).strip() for l in screen.splitlines()]):
        flat = " ".join(line.split())
        if probe and probe[:20] in flat:
            return flat[:200]
    return None


APPROVAL_HEADS = ("would you like to", "allow codex to", "do you want to approve")


def parse_approval_screen(screen: str) -> dict | None:
    """Codex's approval overlay on a plain-text screen → a pending question, else None.

        Would you like to run the following command?        (or: make the following edits?)
          Reason: …
          $ cargo test
        › 1. Yes, proceed (y)
          2. Yes, and don't ask again for this command (a)
          3. No, and tell Codex what to do differently (esc)
          Press enter to confirm or esc to cancel

    Each option keeps the key shown in brackets, so answering presses exactly what the overlay offers."""
    lines = [_clean(l) for l in screen.splitlines()]
    head = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip().lower().startswith(APPROVAL_HEADS):
            head = i
            break
    if head is None:
        return None
    detail: list[str] = []
    options: list[dict] = []
    for line in lines[head + 1:]:
        s = line.strip()
        if not s:
            continue
        m = _OPTION_RE.match(s)
        if m:
            label, key = m.group(2).strip(), (m.group(3) or "").strip().lower()
            options.append({"label": label[:200], "description": "", "recommended": False,
                            "key": "Escape" if key in ("esc", "escape") else key or None})
            continue
        if options:
            break  # the footer ("Press enter to confirm …") ends the list
        detail.append(s)
    if not options:
        return None
    question = lines[head].strip()
    what = next((d for d in detail if d.startswith("$ ")), None) or next(
        (d for d in detail if not d.lower().startswith(("reason:", "description:"))), None)
    if what:
        question = f"{question} {what}"
    reason = next((d.split(":", 1)[1].strip() for d in detail if d.lower().startswith("reason:")), "")
    if reason:
        options[0]["description"] = reason[:500]
    return {"question": question[:1000], "header": "Approval", "options": options, "multi_select": False,
            "more": 0, "kind": "approval", "source": "screen"}


# Fallback options when a rollout itself says an approval is pending (no screen to read the keys from).
APPROVAL_OPTIONS = (
    ("Yes, proceed", "y"),
    ("Yes, and don't ask again for this command", "a"),
    ("No, and tell Codex what to do differently", "Escape"),
)


def approval_question(question: str, reason: str | None = None) -> dict:
    opts = [{"label": l, "description": "", "recommended": False, "key": k} for l, k in APPROVAL_OPTIONS]
    if reason:
        opts[0]["description"] = str(reason)[:500]
    return {"question": question[:1000], "header": "Approval", "options": opts, "multi_select": False, "more": 0,
            "kind": "approval", "source": "transcript"}


def answer_keys(question: dict | None, text: str) -> list[tuple[str, str]] | None:
    """How to answer `question` with `text` in Codex's TUI: [("text"|"key", value)], or None to type `text` and press
    Return like any prompt. An approval option (by label, number or key) is its single key; any other answer
    declines with Esc and then sends the text as what Codex should do instead."""
    if not question or question.get("kind") != "approval":
        return None
    want = " ".join(text.split()).lower()
    opts = question.get("options") or []
    for n, o in enumerate(opts, 1):
        key = o.get("key")
        if want in ((o.get("label") or "").lower(), str(n), (key or "").lower()) and key:
            return [("key", key)] if len(key) > 1 else [("text", key)]
    if want in ("yes", "y", "approve"):
        return [("text", "y")]
    if want in ("no", "n", "deny", "decline"):
        return [("key", "Escape")]
    return [("key", "Escape"), ("text", " ".join(text.split())), ("key", "Return")]


# ---------------------------------------------------------------- transcripts

def parse_ts(value) -> float | None:
    from ...transcripts import parse_ts as _p
    return _p(value) if isinstance(value, str) else None


def local_day(epoch: float) -> str:
    from ...transcripts import local_day as _d
    return _d(epoch)


def session_id_of(path: str | Path) -> str | None:
    m = ROLLOUT_RE.match(Path(path).name)
    return m.group(1).lower() if m else None


def records(rec: dict) -> tuple[str | None, dict]:
    """A rollout line → (record type, payload). Lines from builds that wrote bare items (no wrapper) come back as
    ("response_item", item); a bare session header as ("session_meta", header)."""
    if not isinstance(rec, dict):
        return None, {}
    payload = rec.get("payload")
    if isinstance(payload, dict) and isinstance(rec.get("type"), str):
        return rec["type"], payload
    if rec.get("record_type") == "state":
        return "state", rec
    if "type" not in rec and rec.get("id") and rec.get("timestamp"):
        return "session_meta", rec
    if isinstance(rec.get("type"), str):
        return "response_item", rec
    return None, {}


def content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(c.get("text") or "") for c in content
                         if isinstance(c, dict) and c.get("type") in ("input_text", "output_text", "text"))
    return ""


def is_prompt(text: str) -> bool:
    t = text.lstrip()
    return bool(t) and not t.startswith(_INJECTED_PREFIXES)


def _args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}
    return v if isinstance(v, dict) else {}


def _command_text(cmd) -> str:
    if isinstance(cmd, list):
        parts = [str(x) for x in cmd]
        if len(parts) >= 3 and parts[0].endswith(("bash", "zsh", "sh")) and parts[1] in ("-lc", "-c"):
            return parts[2]
        return " ".join(parts)
    return str(cmd or "")


def tool_name(item: dict) -> str | None:
    t = item.get("type")
    if t == "local_shell_call":
        return "shell"
    if t in ("function_call", "custom_tool_call"):
        return str(item.get("name") or t)
    if t == "web_search_call":
        return "web_search"
    return None


def tool_summary(item: dict) -> str:
    """One line for a Codex tool call: the command, the patched file, or the first line of a code cell."""
    t = item.get("type")
    if t == "local_shell_call":
        return _command_text((item.get("action") or {}).get("command"))[:TOOL_SUMMARY_MAX]
    if t == "custom_tool_call":
        text = str(item.get("input") or "")
        m = re.search(r"\*\*\* (?:Update|Add|Delete) File: (\S+)", text)
        if m:
            return m.group(1)[:TOOL_SUMMARY_MAX]
        first = next((l.strip() for l in text.splitlines() if l.strip()), "")
        return first[:TOOL_SUMMARY_MAX]
    if t == "function_call":
        a = _args(item.get("arguments"))
        for key in ("cmd", "command"):
            if a.get(key):
                return _command_text(a[key])[:TOOL_SUMMARY_MAX]
        qs = a.get("questions")
        if isinstance(qs, list) and qs and isinstance(qs[0], dict):
            return str(qs[0].get("question") or "")[:TOOL_SUMMARY_MAX]
        for key in ("path", "file_path", "query", "url", "plan", "explanation"):
            if isinstance(a.get(key), str) and a[key]:
                return a[key][:TOOL_SUMMARY_MAX]
    if t == "web_search_call":
        return str((item.get("action") or {}).get("query") or "")[:TOOL_SUMMARY_MAX]
    return ""


def _escalated(item: dict) -> bool:
    a = _args(item.get("arguments")) if item.get("type") == "function_call" else {}
    return a.get("sandbox_permissions") == "require_escalated" or a.get("with_escalated_permissions") is True


def _output_text(item: dict) -> str:
    out = item.get("output")
    if isinstance(out, str):
        try:
            v = json.loads(out)
            if isinstance(v, dict) and isinstance(v.get("output"), str):
                return v["output"]
        except json.JSONDecodeError:
            pass
        return out
    if isinstance(out, list):
        return content_text(out)
    if isinstance(out, dict):
        return str(out.get("output") or out.get("content") or "")
    return ""


@dataclass
class CodexSession:
    """Incremental state of one rollout; `summary()` has the same keys as transcripts.SessionStats.summary."""

    session_id: str
    account: str
    path: str
    offset: int = 0
    last_at: float | None = None
    last_tool: str | None = None
    cwd: str | None = None
    model: str | None = None
    started_at: float | None = None
    tool_calls: int = 0
    turns: int = 0
    compactions: int = 0
    context_tokens: int | None = None
    context_window: int | None = None
    rate_limit: dict | None = None
    tokens_in_by_day: dict[str, int] = field(default_factory=dict)
    tokens_out_by_day: dict[str, int] = field(default_factory=dict)
    pr_numbers: list[int] = field(default_factory=list)
    pr_link_ts: dict[int, float | None] = field(default_factory=dict)
    last_assistant_preview: str | None = None
    pending_question: dict | None = None
    approval_policy: str | None = None
    in_turn: bool = False
    pending_calls: dict[str, dict] = field(default_factory=dict)
    _question_call: str | None = None
    _pr_calls: set[str] = field(default_factory=set)
    _totals: tuple[int, int] | None = None
    _from_start: bool = True
    _partial: bytes = b""

    # ---- feeding

    def feed_bytes(self, data: bytes) -> None:
        buf = self._partial + data
        lines = buf.split(b"\n")
        self._partial = lines.pop()
        for raw in lines:
            if raw.strip():
                self.feed_line(raw.decode("utf-8", errors="replace"))

    def feed_line(self, line: str) -> None:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            return
        self.feed_record(rec)

    def feed_record(self, rec: dict) -> None:
        kind, p = records(rec)
        if kind is None:
            return
        ts = parse_ts(rec.get("timestamp")) if isinstance(rec, dict) else None
        if ts and kind != "session_meta" and (self.last_at is None or ts > self.last_at):
            self.last_at = ts
        if kind == "session_meta":
            self.cwd = p.get("cwd") or self.cwd
            self.started_at = self.started_at or parse_ts(p.get("timestamp")) or ts
        elif kind == "turn_context":
            self.cwd = p.get("cwd") or self.cwd
            self.model = p.get("model") or self.model
            self.approval_policy = p.get("approval_policy") or self.approval_policy
        elif kind == "compacted":
            self.compactions += 1
        elif kind == "token_usage_record":
            self._usage(p.get("usage"), p.get("thread_token_usage"), ts)
        elif kind == "event_msg":
            self._event(p, ts)
        elif kind == "response_item":
            self._item(p, ts)

    def _event(self, p: dict, ts: float | None) -> None:
        t = p.get("type")
        if t == "task_started":
            self.in_turn = True
            if isinstance(p.get("model_context_window"), int):
                self.context_window = p["model_context_window"]
        elif t in ("task_complete", "turn_aborted"):
            self.in_turn = False
            self.pending_calls.clear()
            self._clear_question()
            if t == "task_complete" and isinstance(p.get("last_agent_message"), str) and p["last_agent_message"].strip():
                self.last_assistant_preview = " ".join(p["last_agent_message"].split())[:120]
        elif t == "context_compacted":
            self.compactions += 1
        elif t == "thread_settings_applied":
            s = p.get("thread_settings") or {}
            self.model = s.get("model") or self.model
            self.approval_policy = s.get("approval_policy") or self.approval_policy
            self.cwd = s.get("cwd") or self.cwd
        elif t == "token_count":
            self._tokens(p, ts)
        elif t in ("exec_approval_request", "apply_patch_approval_request"):
            if t == "exec_approval_request":
                q = f"Would you like to run the following command? $ {_command_text(p.get('command'))}"
            else:
                n = len(p.get("changes") or {})
                q = f"Would you like to make the following edits? ({n} file{'s' if n != 1 else ''})"
            self.pending_question, self._question_call = approval_question(q, p.get("reason")), p.get("call_id")
        elif t == "request_user_input":
            self._ask(p.get("questions"), p.get("call_id"))
        elif t in ("exec_command_end", "patch_apply_end") and p.get("call_id") == self._question_call:
            self._clear_question()

    def _ask(self, questions, call_id) -> None:
        from ...transcripts import parse_question
        q = parse_question({"questions": questions})
        if q:
            q["kind"] = "input"
            self.pending_question, self._question_call = q, call_id

    def _clear_question(self) -> None:
        self.pending_question, self._question_call = None, None

    def _usage(self, last, total, ts: float | None) -> None:
        """One response's usage (the context it filled) and the session's running total (today's tokens are the
        deltas). `token_count` events and `token_usage_record` lines report the same totals; a repeat adds 0."""
        if isinstance(last, dict) and last:
            self.context_tokens = int(last.get("input_tokens") or 0) + int(last.get("output_tokens") or 0)
        if isinstance(total, dict) and total:
            cur = (int(total.get("input_tokens") or 0), int(total.get("output_tokens") or 0))
            # The first total seen after a tail read is a baseline; from the file start it is the delta.
            prev = self._totals if self._totals is not None else ((0, 0) if self._from_start else cur)
            din, dout = max(0, cur[0] - prev[0]), max(0, cur[1] - prev[1])
            if ts and (din or dout):
                day = local_day(ts)
                self.tokens_in_by_day[day] = self.tokens_in_by_day.get(day, 0) + din
                self.tokens_out_by_day[day] = self.tokens_out_by_day.get(day, 0) + dout
            self._totals = max(cur, self._totals or cur)

    def _tokens(self, p: dict, ts: float | None) -> None:
        info = p.get("info") or {}
        if isinstance(info, dict):
            self._usage(info.get("last_token_usage"), info.get("total_token_usage"), ts)
            if isinstance(info.get("model_context_window"), int):
                self.context_window = info["model_context_window"]
        rl = p.get("rate_limits") or {}
        primary = rl.get("primary") if isinstance(rl, dict) else None
        if isinstance(primary, dict) and isinstance(primary.get("used_percent"), (int, float)):
            sec = rl.get("secondary") if isinstance(rl.get("secondary"), dict) else {}
            self.rate_limit = {"five_hour_pct": round(float(primary["used_percent"]), 1),
                               "week_pct": sec.get("used_percent"), "as_of": ts}

    def _item(self, p: dict, ts: float | None) -> None:
        t = p.get("type")
        if t == "message":
            text = content_text(p.get("content"))
            if p.get("role") == "user" and is_prompt(text):
                self.turns += 1
                self.pending_calls.clear()
                self._clear_question()
            elif p.get("role") == "assistant" and text.strip():
                self.last_assistant_preview = " ".join(text.split())[:120]
            return
        name = tool_name(p)
        if name:
            self.last_tool = name
            self.tool_calls += 1
            cid = p.get("call_id") or p.get("id")
            if cid:
                self.pending_calls[cid] = {"name": name, "ts": ts}
                raw = str(p.get("arguments") or p.get("input") or (p.get("action") or {}).get("command") or "")
                if "gh pr create" in raw:
                    self._pr_calls.add(cid)
            if t == "function_call" and name == "request_user_input":
                self._ask(_args(p.get("arguments")).get("questions"), cid)
            elif _escalated(p) and (self.approval_policy or "on-request") != "never":
                q = f"Would you like to run the following command? $ {tool_summary(p)}"
                self.pending_question, self._question_call = approval_question(
                    q, _args(p.get("arguments")).get("justification")), cid
            return
        if t in ("function_call_output", "custom_tool_call_output", "local_shell_call_output"):
            cid = p.get("call_id")
            self.pending_calls.pop(cid, None)
            if cid and cid == self._question_call:
                self._clear_question()
            if cid in self._pr_calls:
                self._pr_calls.discard(cid)
                for n in _PR_URL_RE.findall(_output_text(p)):
                    n = int(n)
                    if n in self.pr_numbers:
                        self.pr_numbers.remove(n)
                    self.pr_numbers.append(n)
                    self.pr_link_ts[n] = ts

    # ---- legacy whole-file sessions

    def feed_legacy(self, data: dict, mtime: float | None) -> None:
        sess = data.get("session") or {}
        self.started_at = parse_ts(sess.get("timestamp"))
        self.last_at = mtime or self.started_at
        for item in data.get("items") or []:
            if isinstance(item, dict):
                self._item(item, None)
        self.pending_calls.clear()
        self._clear_question()

    # ---- output

    def summary(self, now: float) -> dict:
        day = local_day(now)
        try:
            size = Path(self.path).stat().st_size
        except OSError:
            size = None
        tin, tout = self.tokens_in_by_day.get(day, 0), self.tokens_out_by_day.get(day, 0)
        return {
            "harness": "codex",
            "model": self.model, "context_tokens": self.context_tokens, "context_window": self.context_window,
            "tokens_in_today": tin, "tokens_out_today": tout,
            "cost_usd_session": None, "session_started_at": self.started_at,
            "transcript_size_bytes": size, "turns": self.turns, "compactions": self.compactions,
            "session_id": self.session_id,
            "account": self.account,
            "last_at": self.last_at,
            "last_tool": self.last_tool,
            "cwd": self.cwd,
            "subagents": 0,
            "pr_numbers": list(self.pr_numbers),
            "tokens_today": tin + tout,
            "tool_calls": self.tool_calls,
            "pending_question": self.pending_question,
            "last_assistant_preview": self.last_assistant_preview,
            "pr_link_ts": dict(self.pr_link_ts),
            "recent_skills": [],
            "in_turn": self.in_turn or bool(self.pending_calls),
            "quota": self.rate_limit,
        }


class CodexTranscriptIndex:
    """Same interface as transcripts.TranscriptIndex: `scan()` → {session_id: summary}, `sessions[sid].path`."""

    def __init__(self, roots: dict[str, Path]):
        self.roots = roots
        self.sessions: dict[str, CodexSession] = {}

    def _files(self, root: Path):
        yield from root.glob("*/*/*/rollout-*.jsonl")
        yield from root.glob("rollout-*.json")
        yield from root.glob("rollout-*.jsonl")

    def _candidates(self, wanted: set[str], now: float, prefixes: tuple[str, ...]) -> dict[str, tuple[str, Path]]:
        found: dict[str, tuple[str, Path, float]] = {}
        for account, root in self.roots.items():
            root = Path(root)
            if not root.is_dir():
                continue
            for f in self._files(root):
                sid = session_id_of(f)
                if not sid:
                    continue
                try:
                    mtime = f.stat().st_mtime
                except OSError:
                    continue
                if (sid not in wanted and sid not in self.sessions and not sid.startswith(prefixes)
                        and now - mtime > RECENT_S):
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
                st = CodexSession(session_id=sid, account=account, path=str(path))
                self.sessions[sid] = st
            self._read(st)
        return {sid: st.summary(now) for sid, st in self.sessions.items()}

    @staticmethod
    def _read(st: CodexSession) -> None:
        try:
            stat = Path(st.path).stat()
        except OSError:
            return
        size = stat.st_size
        if size < st.offset:
            fresh = CodexSession(session_id=st.session_id, account=st.account, path=st.path)
            st.__dict__.update(fresh.__dict__)
        if size == st.offset:
            return
        if st.path.endswith(".json"):
            try:
                data = json.loads(Path(st.path).read_text())
            except (OSError, json.JSONDecodeError):
                return
            if isinstance(data, dict):
                fresh = CodexSession(session_id=st.session_id, account=st.account, path=st.path)
                fresh.feed_legacy(data, stat.st_mtime)
                st.__dict__.update(fresh.__dict__)
            st.offset = size
            return
        with open(st.path, "rb") as fh:
            if st.offset == 0 and size > FIRST_READ_MAX:
                head = fh.readline()  # session_meta: cwd and start time even when the rest is read from the tail
                st.feed_bytes(head if head.endswith(b"\n") else head + b"\n")
                fh.seek(size - FIRST_READ_MAX)
                fh.readline()
                st._from_start = False  # token totals: the first one seen is a baseline, not today's usage
            else:
                fh.seek(st.offset)
            while chunk := fh.read(4 * 1024 * 1024):
                st.feed_bytes(chunk)
            st.offset = fh.tell()
        if st.last_at is None:
            st.last_at = stat.st_mtime


# ---------------------------------------------------------------- conversation (contract: Conversation panel)

def parse_turns(lines: list[str], *, results: bool = False, result_cap: int = 2048) -> list[dict]:
    """Rollout lines → conversation turns shaped like conversation.parse_turns (user / assistant, tools)."""
    turns: list[dict] = []
    by_call: dict[str, dict] = {}
    items: list[tuple[dict, float | None]] = []
    for line in lines:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(rec, dict) and isinstance(rec.get("items"), list) and isinstance(rec.get("session"), dict):
            items += [(i, None) for i in rec["items"] if isinstance(i, dict)]  # a legacy whole-file session
            continue
        kind, p = records(rec)
        if kind == "response_item":
            items.append((p, parse_ts(rec.get("timestamp"))))
    for p, ts in items:
        t = p.get("type")
        if t == "message":
            text = content_text(p.get("content")).strip()
            if p.get("role") == "user" and is_prompt(text):
                turns.append({"ts": ts, "role": "user", "text": text, "tools": []})
            elif p.get("role") == "assistant" and text:
                turns.append({"ts": ts, "role": "assistant", "text": text, "tools": []})
            continue
        name = tool_name(p)
        if name:
            if not turns or turns[-1]["role"] != "assistant":
                turns.append({"ts": ts, "role": "assistant", "text": "", "tools": []})
            tool = {"name": name, "summary": tool_summary(p)}
            turns[-1]["tools"].append(tool)
            if p.get("call_id"):
                by_call[p["call_id"]] = tool
        elif results and t in ("function_call_output", "custom_tool_call_output", "local_shell_call_output"):
            tool = by_call.get(p.get("call_id"))
            if tool is not None:
                tool["result"] = _output_text(p)[:result_cap]
    return [t for t in turns if t["text"] or t["tools"]]


def history_records(lines) -> dict:
    """Whole-file pass for the history summary: start, prompts, PR links, files touched, compactions."""
    st = CodexSession("", "", "")
    files: set[str] = set()
    compactions: list[float | None] = []
    for line in lines:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind, p = records(rec)
        ts = parse_ts(rec.get("timestamp")) if isinstance(rec, dict) else None
        if kind == "compacted" or (kind == "event_msg" and p.get("type") == "context_compacted"):
            compactions.append(ts)
        if kind == "response_item" and p.get("type") == "custom_tool_call":
            files.update(re.findall(r"\*\*\* (?:Update|Add) File: (\S+)", str(p.get("input") or "")))
        st.feed_record(rec)
    return {"started_at": st.started_at, "turns": st.turns,
            "pr_links": [{"pr": n, "ts": st.pr_link_ts.get(n)} for n in st.pr_numbers],
            "skills_used": [], "files_touched_count": len(files), "compactions": compactions,
            "prior_session_ids": []}


# ---------------------------------------------------------------- adapter

def codex_home(cfg: dict | None = None) -> Path:
    """$SHUFLER_CODEX_HOME, else [codex] home, else $CODEX_HOME, else ~/.codex."""
    s = (cfg or {}).get("codex") or {}
    v = os.environ.get("SHUFLER_CODEX_HOME") or s.get("home") or os.environ.get("CODEX_HOME") or "~/.codex"
    return Path(str(v)).expanduser()


class CodexAdapter:
    """OpenAI Codex CLI: $CODEX_HOME/sessions rollouts, `codex` processes, the approval overlay on screen."""

    name = "codex"
    harness = "codex"
    label = "Codex"
    # config keys this adapter reads ([codex]), with defaults (docs/AGENTS.md)
    CONFIG_DEFAULTS = {"home": "~/.codex", "bin": "codex"}
    # read the screen of a session that is mid-turn and quiet: approvals are not in the rollout
    probe_screen = True
    QUIET_S = 3.0

    def __init__(self, home: Path, bin: str = "codex"):
        self.home = Path(home)
        self.bin = bin
        self.transcript_roots = {"codex": self.home / "sessions"}

    @classmethod
    def from_config(cls, cfg: dict) -> "CodexAdapter":
        s = (cfg or {}).get("codex") or {}
        return cls(codex_home(cfg), str(s.get("bin") or "codex"))

    @classmethod
    def detect(cls, cfg: dict | None = None) -> "Detection":
        from ..terminal.base import Detection
        a = cls.from_config(cfg or {})
        b = shutil.which(a.bin) if "/" not in a.bin else (a.bin if Path(a.bin).expanduser().is_file() else None)
        sessions = a.transcript_roots["codex"]
        has = sessions.is_dir()
        detail = ", ".join(x for x in (f"bin {b}" if b else "codex not on PATH",
                                       f"sessions in {sessions}" if has else "no sessions dir yet") if x)
        return Detection(bool(b) or has, False, detail)

    match_process = staticmethod(match_process)
    input_draft = staticmethod(input_draft)
    echo_line = staticmethod(echo_line)
    parse_screen = staticmethod(parse_approval_screen)
    answer_keys = staticmethod(answer_keys)

    def transcript_index(self):
        return CodexTranscriptIndex(self.transcript_roots)

    def skill_index(self):
        from .skills import SkillIndex
        return SkillIndex([])

    def accounts(self) -> dict[str, dict]:
        """One pseudo-account; context window and quota come per session from the rollout's token counts."""
        return {"codex": {"label": "codex", "email_masked": None, "context_window": None, "quota": None}}

    def session_history(self, since: float) -> list[dict]:
        """Per rollout modified since `since`: id, cwd, first/last timestamp, PR links (backfill.py)."""
        out = []
        idx = CodexTranscriptIndex(self.transcript_roots)
        for root in self.transcript_roots.values():
            if not Path(root).is_dir():
                continue
            for f in idx._files(Path(root)):
                sid = session_id_of(f)
                try:
                    if not sid or f.stat().st_mtime < since:
                        continue
                except OSError:
                    continue
                st = CodexSession(session_id=sid, account="codex", path=str(f))
                CodexTranscriptIndex._read(st)
                out.append({"session_id": sid, "account": "codex", "started_at": st.started_at, "ended_at": st.last_at,
                            "cwd": st.cwd, "pr_links": [{"pr": n, "ts": st.pr_link_ts.get(n)} for n in st.pr_numbers]})
        return out
