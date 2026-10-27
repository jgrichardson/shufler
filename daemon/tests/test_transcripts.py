from shufler.transcripts import SessionStats, TranscriptIndex
from tests.conftest import FIX, NOW


def test_transcript_metadata_only():
    idx = TranscriptIndex({"personal": FIX / "projects"})
    out = idx.scan({"bbbb2222-0000-0000-0000-000000000000"}, now=NOW)
    s = out["bbbb2222-0000-0000-0000-000000000000"]
    assert s["last_tool"] == "Bash"
    assert s["pr_numbers"] == [253]
    assert s["cwd"] == "/Users/demo/widgets"
    assert s["tool_calls"] == 3
    st = idx.sessions["bbbb2222-0000-0000-0000-000000000000"]
    # msg_1 is split over two records with the same usage: counted once.
    assert sum(st.tokens_by_day.values()) == 150 + 15 + 3
    assert st.pending_agents == {"toolu_B"}
    assert "PRIVATE" not in repr(st.__dict__)


def test_incremental_tail_handles_partial_lines(tmp_path):
    proj = tmp_path / "p"
    proj.mkdir()
    f = proj / "s1.jsonl"
    line = '{"type":"assistant","timestamp":"2026-10-21T10:00:00Z","message":{"id":"m","content":[{"type":"tool_use","id":"t","name":"Read"}],"usage":{"input_tokens":1,"output_tokens":1}}}'
    f.write_text(line[:40])
    idx = TranscriptIndex({"personal": tmp_path})
    idx.scan({"s1"}, now=NOW)
    assert idx.sessions["s1"].last_tool is None
    with open(f, "a") as fh:
        fh.write(line[40:] + "\n")
    idx.scan({"s1"}, now=NOW)
    assert idx.sessions["s1"].last_tool == "Read"


def test_pr_link_order_most_recent_last():
    st = SessionStats("s", "personal", "/x")
    for n in (1, 2, 1):
        st.feed_line('{"type":"pr-link","prNumber":%d}' % n)
    assert st.pr_numbers == [2, 1]


def test_recent_skills_from_slash_commands_and_skill_tool():
    st = SessionStats("s", "personal", "/x")
    st.feed_line('{"type":"user","message":{"content":"<command-name>/compound-engineering:ce-plan</command-name>"}}')
    st.feed_line('{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"Skill",'
                 '"input":{"skill":"ce-brainstorm"}}]}}')
    st.feed_line('{"type":"user","message":{"content":"<command-name>/ce-plan</command-name>"}}')
    assert st.recent_skills == ["ce-brainstorm", "ce-plan"]
    assert st.summary(NOW)["recent_skills"] == ["ce-brainstorm", "ce-plan"]
