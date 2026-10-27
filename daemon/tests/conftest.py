import json
import os
from pathlib import Path

os.environ["SHUFLER_CONFIG"] = str(Path(__file__).parent / "fixtures" / "config.toml")
os.environ["SHUFLER_HISTORY"] = "0"  # tests build their own HistoryStore under tmp_path
os.environ.setdefault("SHUFLER_CACHE_DIR", "/tmp/shufler-test-cache")
os.environ.setdefault("SHUFLER_LIBRARY", "/tmp/shufler-test-cache/library.json")  # tests swap in tmp_path stores

import pytest

from shufler import collectors, runner
from shufler.runner import RunResult
from shufler.snapshot import build_snapshot
from shufler.world import PhaseMemory, enrich, load_domains
from shufler.transcripts import TranscriptIndex, parse_ts

FIX = Path(__file__).parent / "fixtures"
DOMAINS = FIX / "config.toml"
NOW = parse_ts("2026-10-21T10:01:00Z")  # 50s after the fixture transcript's last record


def fake_run_factory(outputs: dict[str, str]):
    def fake_run(argv, timeout=30, env=None):
        key = " ".join(argv[1:3])
        return RunResult(0, outputs.get(key, "{}"), "")
    return fake_run


@pytest.fixture
def raw_data(monkeypatch):
    monkeypatch.setattr(runner, "run", fake_run_factory({
        "workspace list": (FIX / "cmux_workspaces.json").read_text(),
        "workspace-group list": (FIX / "cmux_groups.json").read_text(),
    }))
    idx = TranscriptIndex({"personal": FIX / "projects", "work": FIX / "missing"})
    notes = collectors.collect_notes(FIX / "notes")
    return {
        "terminal": collectors.collect_terminal(),
        "groups": collectors.collect_groups(),
        "notes": notes,
        "intake": collectors.collect_intake(FIX / "intake"),
        "ledgers": collectors.collect_ledgers(FIX / "ledgers"),
        "transcripts": idx.scan(set(notes), now=NOW),
        "gh": json.loads((FIX / "gh_open.json").read_text()),
        "gh_merged": json.loads((FIX / "gh_merged.json").read_text()),
        "deploys": {"prs": {"171": {"deployed": True, "deployed_at": "2026-10-20T13:00:00Z"}}},
        "reviewer_watch": {"253": {"cycle": 2, "status": "approved"}},
        "board": {"5383072": "in_review"},
        "gh_detail": {
            "253": {"mergeable": "MERGEABLE", "merge_state": "CLEAN", "head_sha": "a", "head_at": "2026-10-21T08:00:00Z"},
            "260": {"mergeable": "CONFLICTING", "merge_state": "DIRTY", "head_sha": "b", "head_at": "2026-10-21T08:00:00Z"},
        },
    }


@pytest.fixture
def snapshot(raw_data):
    health = {"cmux": {"ok": True, "age": 1.0}, "gh": {"ok": False, "age": None, "error": "boom"}}
    snap = build_snapshot(raw_data, health, NOW)
    return enrich(snap, raw_data, NOW, PhaseMemory(Path("/dev/null")), set(), load_domains(DOMAINS))
