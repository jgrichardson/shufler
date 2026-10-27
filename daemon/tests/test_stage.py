import pytest

from shufler.snapshot import (activity_status, derive_ci, derive_reviewer, derive_reviewer_at_head, derive_stage,
                              parse_description)

BASE = dict(merged=False, deployed=False, reviewer="none", ci="none", draft=False, preview_label=False, note_state=None,
            reviewer_at_head=True)


@pytest.mark.parametrize("overrides,expected", [
    ({"merged": True, "deployed": True}, "deployed"),
    ({"merged": True}, "merged"),
    ({"merged": True, "reviewer": "approved", "ci": "success"}, "merged"),
    ({"reviewer": "approved", "ci": "success"}, "ready"),
    ({"reviewer": "approved", "ci": "success", "draft": True}, "build"),
    ({"reviewer": "approved", "ci": "success", "preview_label": True}, "ready"),
    ({"preview_label": True, "ci": "failure"}, "preview"),
    ({"note_state": "staging"}, "preview"),
    ({"ci": "pending"}, "ci"),
    ({"ci": "failure", "draft": True}, "ci"),
    ({"reviewer": "pending"}, "reviewer"),
    ({"reviewer": "changes_requested", "ci": "success"}, "reviewer"),
    ({"reviewer": "pending", "draft": True}, "build"),
    ({"draft": True}, "build"),
    ({"reviewer": "approved", "ci": "success", "reviewer_at_head": False}, "reviewer"),
    ({"reviewer": "approved", "ci": "success", "reviewer_at_head": False, "draft": True}, "build"),
    ({"reviewer": "approved", "ci": "pending", "reviewer_at_head": False}, "ci"),
    ({}, "intake"),
    ({"ci": "success"}, "intake"),
    ({"reviewer": "off", "ci": "success"}, "ready"),
    ({"reviewer": "off", "ci": "pending"}, "ci"),
    ({"reviewer": "off", "ci": "success", "draft": True}, "build"),
])
def test_derive_stage_first_match(overrides, expected):
    assert derive_stage(**{**BASE, **overrides}) == expected


def test_derive_ci():
    assert derive_ci([]) == "none"
    assert derive_ci([{"status": "COMPLETED", "conclusion": "SUCCESS"}, {"status": "COMPLETED", "conclusion": "SKIPPED"}]) == "success"
    assert derive_ci([{"status": "IN_PROGRESS", "conclusion": None}, {"status": "COMPLETED", "conclusion": "SUCCESS"}]) == "pending"
    assert derive_ci([{"status": "IN_PROGRESS"}, {"status": "COMPLETED", "conclusion": "FAILURE"}]) == "failure"
    assert derive_ci([{"status": "COMPLETED", "conclusion": "CANCELLED"}]) == "success"


def test_derive_reviewer():
    bot = lambda state, at="2026-10-21T00:00:00Z": {"login": "reviewbot", "state": state, "at": at}
    assert derive_reviewer([], None) == "none"
    assert derive_reviewer([bot("APPROVED")], None) == "approved"
    assert derive_reviewer([bot("CHANGES_REQUESTED")], None) == "changes_requested"
    assert derive_reviewer([bot("COMMENTED")], None) == "pending"
    assert derive_reviewer([bot("APPROVED", "2026-10-20"), bot("CHANGES_REQUESTED", "2026-10-21")], None) == "changes_requested"
    assert derive_reviewer([{"login": "ReviewBot-1", "state": "APPROVED", "at": "x"}], None) == "approved"
    assert derive_reviewer([{"login": "sam", "state": "APPROVED", "at": "x"}], None) == "none"
    assert derive_reviewer([], {"status": "awaiting-review"}) == "pending"
    assert derive_reviewer([], {"status": "changes (before epoch)"}) == "changes_requested"
    assert derive_reviewer([], {"status": "approved"}) == "approved"
    assert derive_reviewer([bot("APPROVED")], None, enabled=False) == "off"


def test_derive_reviewer_at_head():
    approved = [{"login": "reviewbot", "state": "APPROVED", "at": "2026-10-21T10:00:00Z"}]
    assert derive_reviewer_at_head(approved, "2026-10-21T09:59:00Z") is True
    assert derive_reviewer_at_head(approved, "2026-10-21T10:05:00Z") is False  # pushed after approval
    assert derive_reviewer_at_head(approved, None) is False
    assert derive_reviewer_at_head([{"login": "reviewbot", "state": "COMMENTED", "at": "2026-10-21T11:00:00Z"}, *approved],
                                "2026-10-21T09:00:00Z") is False
    assert derive_reviewer_at_head([{"login": "sam", "state": "APPROVED", "at": "2026-10-22T00:00:00Z"}],
                                "2026-10-21T09:00:00Z") is False


def test_activity_status():
    assert activity_status("working", 10) == "active"
    assert activity_status("working", 901) == "stalled"
    assert activity_status("me", 5000) == "idle"
    assert activity_status("working", None) == "idle"


def test_parse_description():
    assert parse_description("● me · Owner: merge #1") == {"state": "me", "text": "Owner: merge #1", "ts": None}
    assert parse_description("other line\n● working · build it") == {"state": "working", "text": "build it", "ts": None}
    assert parse_description("● bogus · x") is None
    assert parse_description(None) is None
