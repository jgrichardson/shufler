from __future__ import annotations

from typing import Protocol

from .board import BoardAdapter
from .intake import IntakeAdapter
from .ledgers import LedgerAdapter


class WorkItemSource(Protocol):
    """Somewhere work items live outside the code host: intake records, area ledgers, a board. Each one is
    optional and off by default."""

    name: str

    def collect(self, *args) -> dict: ...


__all__ = ["WorkItemSource", "IntakeAdapter", "LedgerAdapter", "BoardAdapter"]
