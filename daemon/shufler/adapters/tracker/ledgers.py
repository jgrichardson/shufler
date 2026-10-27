from __future__ import annotations

import re
from pathlib import Path

BRANCH_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,200}")


def ledger_branch(row: dict) -> str | None:
    """The branch a ledger row is keyed by, or None when the cell is not a plain branch name."""
    b = (row.get("branch") or "").strip().strip("`")
    return b if BRANCH_RE.fullmatch(b) and ".." not in b else None


LEDGER_COLS = ("branch", "pr", "topic", "state", "ball", "next", "worktree", "session")


def parse_ledger(text: str) -> list[dict]:
    """Rows of the markdown table under `## Open` (header row starts with Branch)."""
    rows: list[dict] = []
    in_open = False
    header_seen = False
    for line in text.splitlines():
        if line.startswith("## "):
            in_open = line.strip().lower() == "## open"
            header_seen = False
            continue
        if not in_open or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if not header_seen:
            header_seen = cells[:1] == ["Branch"]
            continue
        if all(set(c) <= set("-: ") for c in cells):
            continue
        row = dict(zip(LEDGER_COLS, cells))
        row = {k: ("" if v in ("—", "-") else v) for k, v in row.items()}
        row["pr_numbers"] = [int(n) for n in re.findall(r"#(\d{1,7})", row.get("pr", ""))]
        rows.append(row)
    return rows


class LedgerAdapter:
    """Area ledgers: `<dir>/<area>/ledger.md`, one markdown table of open work per work area."""

    name = "ledgers"

    def __init__(self, directory: Path):
        self.dir = directory

    def collect(self, directory: Path | None = None) -> dict[str, list[dict]]:
        d = directory or self.dir
        if not d.is_dir():
            raise FileNotFoundError(str(d))
        return {f.parent.name: [dict(r, ledger_path=str(f)) for r in parse_ledger(f.read_text())]
                for f in sorted(d.glob("*/ledger.md"))}
