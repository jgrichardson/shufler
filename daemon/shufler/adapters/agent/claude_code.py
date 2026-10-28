from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from ...processes import match_claude


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    return f"{local[:2]}…@{domain}"


_RULE_RE = re.compile(r"^\s*─{8,}")
_PROMPT_CHARS = ("❯", ">")


def _clean(line: str) -> str:
    return line.replace("\xa0", " ").rstrip()


def input_draft(screen: str) -> str | None:
    """Text sitting unsent in Claude Code's input box, "" when empty, None when no box is on screen.

    The box is the `❯` line between two horizontal rules near the bottom of the screen.
    """
    lines = [_clean(l) for l in screen.splitlines()]
    for i in range(len(lines) - 1, -1, -1):
        stripped = lines[i].lstrip()
        if stripped.startswith(_PROMPT_CHARS) and i > 0 and _RULE_RE.match(lines[i - 1]):
            body = [stripped[1:].strip()]
            for nxt in lines[i + 1:]:
                if _RULE_RE.match(nxt):
                    return " ".join(b for b in body if b)
                body.append(nxt.strip())
            return None
    return None


def echo_line(screen: str, text: str) -> str | None:
    """The transcript line where the sent prompt shows up after Enter."""
    probe = " ".join(text.split())[:40]
    for line in reversed([_clean(l).strip() for l in screen.splitlines()]):
        flat = " ".join(line.split())
        if probe and probe[:20] in flat and not _RULE_RE.match(line):
            return flat[:200]
    return None


_TS_RE = re.compile(rb'"timestamp"\s*:\s*"([^"]+)"')
_CWD_RE = re.compile(rb'"cwd"\s*:\s*"([^"]+)"')


def _scan_session(path: Path) -> dict:
    from ...transcripts import parse_ts
    first = last = cwd = None
    links: list[dict] = []
    with open(path, "rb") as fh:
        for line in fh:
            m = _TS_RE.search(line)
            if m:
                ts = parse_ts(m.group(1).decode(errors="replace"))
                if ts:
                    first = first or ts
                    last = ts
            if cwd is None:
                c = _CWD_RE.search(line)
                if c:
                    cwd = c.group(1).decode(errors="replace")
            if b'"pr-link"' in line:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                n = rec.get("prNumber")
                if isinstance(n, int):
                    links.append({"pr": n, "ts": parse_ts(rec.get("timestamp")) or last})
    return {"started_at": first, "ended_at": last, "cwd": cwd, "pr_links": links}


class ClaudeCodeAdapter:
    """Claude Code: ~/.claude*/projects/<cwd-slug>/<session>.jsonl transcripts,
    oauthAccount in .claude.json, autoCompactWindow in settings.json, and an
    optional statusline usage cache per account."""

    name = "claude-code"
    harness = "claude"
    label = "Claude Code"
    CONFIG_DEFAULTS: dict = {}
    probe_screen = False  # AskUserQuestion is in the transcript; nothing to read on screen

    def __init__(self, transcript_roots: dict[str, Path], accounts: dict[str, dict],
                 usage_cache: dict[str, Path] | None = None):
        self.transcript_roots = transcript_roots
        self.account_cfg = accounts
        self.usage_cache = usage_cache or {}

    @classmethod
    def from_config(cls, cfg: dict | None = None) -> "ClaudeCodeAdapter":
        from ... import config
        return cls(config.TRANSCRIPT_ROOTS, config.ACCOUNTS, config.USAGE_CACHE)

    @classmethod
    def detect(cls, cfg: dict | None = None):
        from ... import config
        from ..terminal.base import Detection
        b = shutil.which("claude")
        roots = [r for r in config.TRANSCRIPT_ROOTS.values() if Path(r).is_dir()]
        detail = ", ".join((f"bin {b}" if b else "claude not on PATH",
                            f"{len(roots)} of {len(config.TRANSCRIPT_ROOTS)} account transcript dirs found"))
        return Detection(bool(b) or bool(roots), False, detail)

    match_process = staticmethod(match_claude)

    @staticmethod
    def answer_keys(question: dict | None, text: str) -> None:
        """Claude Code questions are answered by typing the option label and pressing Return (actions.py)."""
        return None

    @property
    def config_dirs(self) -> list[Path]:
        """Each account's Claude config dir, i.e. the parent of its projects dir."""
        return [Path(r).parent for r in self.transcript_roots.values()]

    def session_history(self, since: float) -> list[dict]:
        """Per main transcript modified since `since`: session id, cwd, first/last timestamp and
        pr-link records. Reads bytes and parses only the lines it needs; never keeps message text."""
        out = []
        for account, root in self.transcript_roots.items():
            if not Path(root).is_dir():
                continue
            for f in Path(root).glob("*/*.jsonl"):
                try:
                    if f.stat().st_mtime < since:
                        continue
                    out.append({"session_id": f.stem, "account": account, **_scan_session(f)})
                except OSError:
                    continue
        return out

    input_draft = staticmethod(input_draft)
    echo_line = staticmethod(echo_line)

    def skill_index(self):
        from .skills import SkillIndex
        return SkillIndex(self.config_dirs)

    def transcript_index(self):
        from ...transcripts import TranscriptIndex
        return TranscriptIndex(self.transcript_roots)

    def accounts(self) -> dict[str, dict]:
        """Per account: label, masked email, compaction window and cached quota."""
        out: dict[str, dict] = {}
        for name, a in self.account_cfg.items():
            email = window = quota = None
            try:
                email = (json.loads(Path(a["claude_json"]).read_text()).get("oauthAccount") or {}).get("emailAddress")
            except (OSError, TypeError, json.JSONDecodeError):
                pass
            try:
                window = json.loads(Path(a["settings"]).read_text()).get("autoCompactWindow")
            except (OSError, TypeError, json.JSONDecodeError):
                pass
            try:
                q = json.loads(Path(self.usage_cache[name]).read_text())
                quota = {"five_hour_pct": q.get("five_hour_pct"), "week_pct": q.get("week_pct"), "as_of": q.get("ts")}
            except (KeyError, OSError, json.JSONDecodeError):
                pass
            out[name] = {"label": a["label"], "email_masked": mask_email(email),
                         "context_window": int(window) if isinstance(window, (int, float)) else None, "quota": quota}
        return out
