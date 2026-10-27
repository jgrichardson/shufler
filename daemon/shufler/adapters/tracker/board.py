from __future__ import annotations

import re

from ... import runner

CARD_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def _fill(template: list[str], **values: str) -> list[str]:
    out = []
    for a in template:
        for k, v in values.items():
            a = a.replace("{" + k + "}", v)
        out.append(a)
    return out


class BoardAdapter:
    """An external board CLI with one card per intake record. The argv templates come from [board]:
    `get_args` (prints the card's stage, read with `stage_pattern`), `stage_args` and `note_args`."""

    name = "board"

    def __init__(self, command: str, stages: tuple[str, ...], get_args: list[str] | None = None,
                 stage_args: list[str] | None = None, note_args: list[str] | None = None,
                 stage_pattern: str = r"stage=(\S+)"):
        self.command, self.stages = command, tuple(stages)
        self.get_args = get_args or ["get", "{id}"]
        self.stage_args = stage_args or ["stage", "{id}", "{stage}"]
        self.note_args = note_args or ["note", "{id}", "{text}"]
        self.stage_re = re.compile(stage_pattern)

    def collect(self, records: dict | None) -> dict[str, str]:
        """Stage per card linked to a live intake record."""
        out: dict[str, str] = {}
        errors = []
        for rec in (records or {}).values():
            cid = rec.get("card_id")
            if not cid or not CARD_ID_RE.fullmatch(cid) or rec.get("state") in ("done", "closed"):
                continue
            r = runner.run([self.command, *_fill(self.get_args, id=cid)], timeout=30)
            m = self.stage_re.search(r.stdout)
            if r.ok and m:
                out[cid] = m.group(1).lower().replace(" ", "_")
            else:
                errors.append(cid)
        if errors and not out:
            raise RuntimeError(f"board get failed for {len(errors)} cards")
        return out

    def stage_argv(self, cid: str, stage: str) -> list[str]:
        return [self.command, *_fill(self.stage_args, id=cid, stage=stage)]

    def note_argv(self, cid: str, text: str) -> list[str]:
        return [self.command, *_fill(self.note_args, id=cid, text=text)]
