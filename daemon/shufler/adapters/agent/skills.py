"""Claude Code skill and slash-command discovery (read-only).

User scope:    <config dir>/skills/*/SKILL.md and <config dir>/commands/**/*.md
Plugin scope:  <config dir>/plugins/cache/<marketplace>/<plugin>/<version>/skills/*/SKILL.md
               (newest version wins; slash is /<plugin>:<skill>)
Project scope: <repo root>/.claude/skills, .claude/commands, docs/claude/skills
"""

from __future__ import annotations

import re
from pathlib import Path

DESC_LIMIT = 240
_HEAD_RE = re.compile(r"^##\s+(arguments?|inputs?)\b", re.I)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Flat `key: value` frontmatter (folded `>`/`|` blocks joined); returns (meta, body)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    meta: dict[str, str] = {}
    lines = text[3:end].splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", lines[i])
        i += 1
        if not m:
            continue
        key, val = m.group(1).lower(), m.group(2).strip()
        if val in (">", "|", ">-", "|-", ">+", "|+"):
            block = []
            while i < len(lines) and (lines[i].startswith((" ", "\t")) or not lines[i].strip()):
                block.append(lines[i].strip())
                i += 1
            val = " ".join(b for b in block if b)
        meta[key] = val.strip().strip('"').strip("'")
    return meta, text[end + 4:]


def _first_prose(body: str) -> str:
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", "|", "```", "<", "---")):
            return s
    return ""


def _args_hint(meta: dict, body: str) -> str | None:
    if meta.get("argument-hint"):
        return meta["argument-hint"][:120]
    lines = body.splitlines()
    for i, line in enumerate(lines):
        if _HEAD_RE.match(line.strip()):
            for nxt in lines[i + 1:i + 8]:
                s = nxt.strip()
                if s.startswith("#"):
                    return None
                if s and not s.startswith(("|", "```")):
                    return s[:120]
            return None
    return None


def read_skill(path: Path, name: str, scope: str) -> dict | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read(32768)
    except OSError:
        return None
    meta, body = parse_frontmatter(text)
    desc = meta.get("description") or _first_prose(body)
    return {"name": name, "slash": f"/{name}", "description": desc[:DESC_LIMIT], "scope": scope,
            "args_hint": _args_hint(meta, body), "source_path": str(path)}


def repo_root(cwd: str | None) -> Path | None:
    if not cwd:
        return None
    p = Path(cwd).expanduser()
    for d in (p, *p.parents):
        if (d / ".git").exists():
            return d
    return None


class SkillIndex:
    """Caches parsed skills by file mtime; `scan()` is cheap when nothing changed."""

    def __init__(self, config_dirs: list[Path]):
        self.config_dirs = config_dirs
        self._cache: dict[str, tuple[float, dict | None]] = {}

    def _read(self, path: Path, name: str, scope: str) -> dict | None:
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return None
        key = f"{scope}:{path}"
        hit = self._cache.get(key)
        if hit and hit[0] == mtime:
            return hit[1]
        sk = read_skill(path, name, scope)
        self._cache[key] = (mtime, sk)
        return sk

    @staticmethod
    def _skill_dirs(base: Path):
        if base.is_dir():
            for f in sorted(base.glob("*/SKILL.md")):
                yield f.parent.name, f

    @staticmethod
    def _command_files(base: Path):
        if base.is_dir():
            for f in sorted(base.rglob("*.md")):
                rel = f.relative_to(base).with_suffix("")
                yield ":".join(rel.parts), f

    def user_and_plugin(self) -> list[dict]:
        out: dict[str, dict] = {}
        for cdir in self.config_dirs:
            for name, f in [*self._skill_dirs(cdir / "skills"), *self._command_files(cdir / "commands")]:
                if name not in out and (sk := self._read(f, name, "user")):
                    out[name] = sk
            newest: dict[str, tuple[float, str, Path]] = {}
            for f in (cdir / "plugins" / "cache").glob("*/*/*/skills/*/SKILL.md"):
                plugin = f.parents[3].name
                name = f"{plugin}:{f.parent.name}"
                try:
                    m = f.stat().st_mtime
                except OSError:
                    continue
                if name not in newest or m > newest[name][0]:
                    newest[name] = (m, name, f)
            for _, name, f in newest.values():
                if name not in out and (sk := self._read(f, name, "plugin")):
                    out[name] = sk
        return sorted(out.values(), key=lambda s: s["name"])

    def project(self, root: Path) -> list[dict]:
        out: dict[str, dict] = {}
        for name, f in [*self._skill_dirs(root / ".claude" / "skills"),
                        *self._command_files(root / ".claude" / "commands"),
                        *self._skill_dirs(root / "docs" / "claude" / "skills")]:
            if name not in out and (sk := self._read(f, name, "project")):
                out[name] = sk
        return sorted(out.values(), key=lambda s: s["name"])
