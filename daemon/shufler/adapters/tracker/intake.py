from __future__ import annotations

import json
from pathlib import Path


def tail_events(path: Path, n: int = 3) -> list[dict]:
    """Last n events of a record, type and ts only."""
    try:
        with open(path, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 16384))
            lines = fh.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out = []
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        out.append({"type": e.get("type"), "ts": e.get("ts")})
        if len(out) == n:
            break
    return out


class IntakeAdapter:
    """Work-item records: one `<slug>.json` per item plus `<slug>.events.jsonl`, with an optional CLI that takes
    `set <slug> key=value`. A record may link a board card under `card_key` ({"id": ..., "stage": ...})."""

    name = "intake"

    def __init__(self, directory: Path, set_command: str | None = None, card_key: str = "card"):
        self.dir, self.set_command, self.card_key = directory, set_command, card_key

    def collect(self, directory: Path | None = None) -> dict[str, dict]:
        records_dir = directory or self.dir
        if not records_dir.is_dir():
            raise FileNotFoundError(str(records_dir))
        out: dict[str, dict] = {}
        for f in sorted(records_dir.glob("*.json")):
            try:
                d = json.loads(f.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            pr = d.get("pr") or {}
            card = d.get(self.card_key) or {}
            session = d.get("session") or {}
            source = d.get("source") or {}
            slug = d.get("slug") or f.stem
            out[slug] = {
                "slug": slug, "title": d.get("title"), "state": d.get("state"), "domain": d.get("domain"),
                "events": tail_events(records_dir / f"{slug}.events.jsonl"),
                "pr": pr.get("number") if isinstance(pr, dict) else None,
                "reporter": source.get("reporter") if isinstance(source, dict) else None,
                "card_id": str(card.get("id")) if isinstance(card, dict) and card.get("id") else None,
                "card_stage": card.get("stage") if isinstance(card, dict) else None,
                "session_id": session.get("id") if isinstance(session, dict) else None,
            }
        return out

    def set_argv(self, slug: str, key: str, value) -> list[str] | None:
        return [self.set_command, "set", slug, f"{key}={value}"] if self.set_command else None
