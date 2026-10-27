import json

import pytest

from shufler.collectors import collect_accounts, mask_email
from shufler.conversation import history_summary, read_conversation, search_history
from shufler.snapshot import telemetry
from shufler.transcripts import TranscriptIndex
from tests.conftest import NOW

SID = "cccc3333-0000-0000-0000-000000000000"


def rec(**kw):
    return json.dumps(kw)


@pytest.fixture
def transcript(tmp_path):
    proj = tmp_path / "projects" / "-p"
    proj.mkdir(parents=True)
    f = proj / f"{SID}.jsonl"
    lines = [
        rec(type="user", timestamp="2026-10-21T08:00:00Z", sessionId=SID, message={"content": "Fix the billing booking bug"}),
        rec(type="assistant", timestamp="2026-10-21T08:00:05Z", sessionId=SID, message={
            "id": "a1", "model": "claude-opus-5-5", "content": [
                {"type": "text", "text": "Looking at the Invoice service now."},
                {"type": "tool_use", "id": "t1", "name": "Skill", "input": {"skill": "pr-pre-review"}},
                {"type": "tool_use", "id": "t2", "name": "Edit", "input": {"file_path": "/a/billing.rb"}},
                {"type": "tool_use", "id": "t3", "name": "Edit", "input": {"file_path": "/a/billing.rb"}},
                {"type": "tool_use", "id": "t4", "name": "Write", "input": {"file_path": "/a/new.rb"}}],
            "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 70}}),
        rec(type="pr-link", sessionId=SID, prNumber=260, timestamp="2026-10-21T08:01:00Z"),
        rec(type="system", subtype="compact_boundary", sessionId=SID, timestamp="2026-10-21T09:00:00Z",
            compactMetadata={"trigger": "auto", "preTokens": 380000}),
        rec(type="user", timestamp="2026-10-21T09:00:01Z", sessionId=SID, isCompactSummary=True,
            message={"content": "This session is being continued from a previous conversation. SUMMARY TEXT"}),
        rec(type="user", timestamp="2026-10-21T09:10:00Z", sessionId="older-session-id", message={"content": "<system-reminder>x</system-reminder>"}),
        rec(type="user", timestamp="2026-10-21T09:30:00Z", sessionId=SID, message={"content": "Now push it, invoices look right"}),
        rec(type="assistant", timestamp="2026-10-21T09:30:05Z", sessionId=SID, message={
            "id": "a2", "model": "<synthetic>", "content": [{"type": "text", "text": "Pushed."}],
            "usage": {"input_tokens": 5, "output_tokens": 7, "cache_read_input_tokens": 2000}}),
        rec(type="cost-state", sessionId=SID, totalCostUSD=12.3456, startTime=1792569600000),
    ]
    f.write_text("\n".join(lines) + "\n")
    return f


def test_tailer_telemetry_fields(transcript):
    idx = TranscriptIndex({"personal": transcript.parents[1]})
    s = idx.scan({SID}, now=NOW)[SID]
    assert s["model"] == "claude-opus-5-5"            # <synthetic> ignored
    assert s["context_tokens"] == 5 + 7 + 2000         # last main-thread usage
    assert (s["tokens_in_today"], s["tokens_out_today"]) == (15, 27)
    assert s["cost_usd_session"] == pytest.approx(12.3456)
    assert s["session_started_at"] == 1792569600.0
    assert s["turns"] == 2                             # compact summary and harness text are not prompts
    assert s["compactions"] == 1
    assert s["transcript_size_bytes"] == transcript.stat().st_size


def test_telemetry_assembly():
    acct = {"label": "personal", "email_masked": "ow…@example.com", "context_window": 400000,
            "quota": {"five_hour_pct": 12, "week_pct": 47, "as_of": "2026-10-22T00:27:25-0400"}}
    t = {"model": "claude-opus-5-5", "context_tokens": 300000, "cost_usd_session": 12.3456, "tokens_in_today": 1,
         "tokens_out_today": 2, "session_started_at": NOW - 3600, "transcript_size_bytes": 10, "turns": 4, "compactions": 1}
    tel = telemetry(t, acct, NOW)
    assert tel["context_pct"] == 75.0 and tel["context_window"] == 400000 and tel["cost_usd_session"] == 12.35
    assert tel["rate_limit"] == {"remaining_pct": 88, "used_pct": 12, "resets_at": None, "week_used_pct": 47,
                                 "as_of": "2026-10-22T00:27:25-0400"}
    assert tel["uptime_s"] == 3600 and tel["account_label"] == "personal"
    empty = telemetry(None, None, NOW)
    assert all(v is None for v in empty.values())


def test_station_carries_telemetry(snapshot):
    st = next(s for s in snapshot["stations"] if s["id"] == "WS-B")
    assert set(st["telemetry"]) >= {"model", "account_label", "context_pct", "rate_limit", "uptime_s", "turns"}
    assert st["telemetry"]["turns"] == 1


def test_collect_accounts(tmp_path):
    cj = tmp_path / "claude.json"
    cj.write_text(json.dumps({"oauthAccount": {"emailAddress": "owner@example.com"}}))
    st = tmp_path / "settings.json"
    st.write_text(json.dumps({"autoCompactWindow": 400000}))
    usage = tmp_path / "usage"
    usage.mkdir()
    (usage / "personal.json").write_text(json.dumps({"account": "personal", "five_hour_pct": 12, "week_pct": 47, "ts": "t"}))
    out = collect_accounts({"personal": {"label": "personal", "claude_json": cj, "settings": st},
                            "work": {"label": "work", "claude_json": tmp_path / "nope", "settings": tmp_path / "nope"}}, usage)
    assert out["personal"] == {"label": "personal", "email_masked": "ow…@example.com", "context_window": 400000,
                               "quota": {"five_hour_pct": 12, "week_pct": 47, "as_of": "t"}}
    assert out["work"] == {"label": "work", "email_masked": None, "context_window": None, "quota": None}
    assert mask_email("ab") is None


def test_history_summary(transcript):
    s = history_summary(transcript, SID)
    assert s["started_at"] is not None and s["turns"] == 2
    assert s["pr_links"] == [{"pr": 260, "ts": pytest.approx(1792569660.0)}]
    assert s["skills_used"] == [{"skill": "pr-pre-review", "count": 1}]
    assert s["files_touched_count"] == 2
    assert len(s["compactions"]) == 1
    assert s["prior_session_ids"] == ["older-session-id"]


def test_history_search(transcript):
    r = search_history(transcript, "INVOICE")
    assert [x["role"] for x in r["results"]] == ["assistant", "user"] and r["truncated"] is False
    assert "Invoice" in r["results"][0]["snippet"]
    assert search_history(transcript, "SUMMARY TEXT")["results"] == []  # compact summary is not searchable
    assert search_history(transcript, "")["results"] == []
    assert len(search_history(transcript, "e", limit=1)["results"]) == 1


def test_conversation_skips_compact_summary(transcript):
    texts = [t["text"] for t in read_conversation(transcript)["turns"]]
    assert not any("SUMMARY TEXT" in t for t in texts)
