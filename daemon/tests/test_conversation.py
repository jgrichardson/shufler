import json

from shufler.conversation import parse_turns, read_conversation, tool_summary
from tests.conftest import FIX

T = FIX / "projects/-Users-demo-widgets/bbbb2222-0000-0000-0000-000000000000.jsonl"


def test_turns_shape_and_merging():
    out = read_conversation(T, n=20)
    roles = [(t["role"], t["text"][:20], [x["name"] for x in t["tools"]]) for t in out["turns"]]
    assert roles == [
        ("user", "PRIVATE USER PROMPT", []),
        ("assistant", "", ["Agent"]),           # msg_1: thinking + tool_use merged, thinking dropped
        ("assistant", "", ["Agent"]),           # msg_2
        ("assistant", "All tests pass. Push", ["Bash"]),
    ]
    assert out["turns"][-1]["tools"][0] == {"name": "Bash", "summary": "ls"}
    assert out["has_more"] is False
    assert "result" not in json.dumps(out)
    assert "PRIVATE THOUGHT" not in json.dumps(out) and "PRIVATE SUMMARY" not in json.dumps(out)


def test_results_opt_in_and_paging():
    out = read_conversation(T, n=20, results=True)
    assert out["turns"][1]["tools"][0]["result"] == "PRIVATE RESULT"
    last2 = read_conversation(T, n=2)
    assert len(last2["turns"]) == 2 and last2["has_more"] is True
    before = read_conversation(T, n=20, before=last2["turns"][0]["ts"])
    assert [t["role"] for t in before["turns"]] == ["user", "assistant"]


def test_pr_filter_with_fallback():
    out = read_conversation(T, pr=253)
    assert out["filtered_by_pr"] is True and len(out["turns"]) == 1
    out = read_conversation(T, pr=111)
    assert out["filtered_by_pr"] is False and len(out["turns"]) == 4


def test_harness_text_skipped_and_commands_kept():
    lines = [
        json.dumps({"type": "user", "timestamp": "2026-10-21T10:00:00Z", "message": {"content": "<system-reminder>x</system-reminder>"}}),
        json.dumps({"type": "user", "timestamp": "2026-10-21T10:00:01Z", "isMeta": True, "message": {"content": "meta"}}),
        json.dumps({"type": "user", "timestamp": "2026-10-21T10:00:02Z", "message": {"content": "<command-name>/pr-pre-review</command-name><command-args>253</command-args>"}}),
        json.dumps({"type": "user", "timestamp": "2026-10-21T10:00:03Z", "message": {"content": [{"type": "text", "text": "real ask<system-reminder>hidden</system-reminder>"}]}}),
        json.dumps({"type": "assistant", "isSidechain": True, "timestamp": "2026-10-21T10:00:04Z", "message": {"id": "s", "content": [{"type": "text", "text": "sidechain"}]}}),
    ]
    turns = parse_turns(lines)
    assert [t["text"] for t in turns] == ["/pr-pre-review", "real ask"]


def test_tool_summaries():
    assert tool_summary("Bash", {"command": "x" * 300}) == "x" * 100
    assert tool_summary("Edit", {"file_path": "/a/b.py", "old_string": "secret"}) == "/a/b.py"
    assert tool_summary("Agent", {"description": "Explore", "prompt": "long"}) == "Explore"
