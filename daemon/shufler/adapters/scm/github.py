from __future__ import annotations

from ... import runner
from .._util import json_cmd

OPEN_FIELDS = ("number,title,headRefName,isDraft,updatedAt,statusCheckRollup,reviewDecision,labels,url,createdAt,"
               "latestReviews,additions,deletions")


def slim_pr(p: dict) -> dict:
    checks = []
    for c in p.get("statusCheckRollup") or []:
        checks.append({
            "name": c.get("name") or c.get("context"),
            "status": c.get("status") or ("COMPLETED" if c.get("state") not in (None, "PENDING", "EXPECTED") else "IN_PROGRESS"),
            "conclusion": c.get("conclusion") or (c.get("state") if c.get("state") not in ("PENDING", "EXPECTED") else None),
            "url": c.get("detailsUrl") or c.get("targetUrl"),
        })
    reviews = [
        {"login": (r.get("author") or {}).get("login"), "state": r.get("state"), "at": r.get("submittedAt")}
        for r in p.get("latestReviews") or []
    ]
    return {
        "number": p["number"], "title": p.get("title"), "branch": p.get("headRefName"),
        "draft": bool(p.get("isDraft")), "updated_at": p.get("updatedAt"), "created_at": p.get("createdAt"),
        "url": p.get("url"), "review_decision": p.get("reviewDecision") or None,
        "labels": [l.get("name") for l in p.get("labels") or []],
        "checks": checks, "reviews": reviews,
        "additions": p.get("additions"), "deletions": p.get("deletions"),
    }


class GitHubAdapter:
    """GitHub through the gh CLI, scoped to the caller's own PRs (--author @me)."""

    name = "github"

    def __init__(self, gh: str, repo: str, deploy_workflow: str = "", deploy_branch: str = "main"):
        self.gh, self.repo = gh, repo
        self.deploy_workflow, self.deploy_branch = deploy_workflow, deploy_branch

    def open_prs(self) -> list[dict]:
        d = json_cmd([self.gh, "pr", "list", "--repo", self.repo, "--state", "open", "--author", "@me",
                      "--limit", "100", "--json", OPEN_FIELDS], timeout=45)
        return [slim_pr(p) for p in d]

    def pr_detail(self, n: int) -> dict:
        d = json_cmd([self.gh, "pr", "view", str(n), "--repo", self.repo, "--json",
                      "mergeable,mergeStateStatus,headRefOid,commits",
                      "--jq", "{mergeable, mergeStateStatus, headRefOid, last: (.commits[-1].committedDate)}"],
                     timeout=30)
        return {"mergeable": d.get("mergeable"), "merge_state": d.get("mergeStateStatus"),
                "head_sha": d.get("headRefOid"), "head_at": d.get("last")}

    def merged_since(self, day: str) -> list[dict]:
        d = json_cmd([self.gh, "pr", "list", "--repo", self.repo, "--state", "merged", "--author", "@me",
                      "--search", f"merged:>={day}", "--limit", "100",
                      "--json", "number,title,headRefName,baseRefName,mergedAt,mergeCommit,url,labels,additions,deletions"],
                     timeout=45)
        return [{
            "number": p["number"], "title": p.get("title"), "branch": p.get("headRefName"),
            "base": p.get("baseRefName"), "merged_at": p.get("mergedAt"), "merge_sha": (p.get("mergeCommit") or {}).get("oid"),
            "url": p.get("url"), "labels": [l.get("name") for l in p.get("labels") or []],
            "additions": p.get("additions"), "deletions": p.get("deletions"),
        } for p in d]

    def branch_status(self, branch: str) -> dict:
        """The newest PR with this head branch (any state, any author) and whether the remote branch exists."""
        prs = json_cmd([self.gh, "pr", "list", "--repo", self.repo, "--head", branch, "--state", "all",
                        "--limit", "5", "--json", "number,state,title,url,mergedAt,createdAt"], timeout=30)
        pr = max(prs, key=lambda x: x.get("createdAt") or "") if prs else None
        r = runner.run([self.gh, "api", f"repos/{self.repo}/branches/{branch}", "--jq", ".name"], timeout=30)
        if not r.ok and "404" not in (r.stderr or "") and "Not Found" not in (r.stderr or ""):
            raise RuntimeError(f"rc={r.rc} {r.stderr.strip()[:200]}")
        return {"pr": pr and {"number": pr["number"], "state": (pr.get("state") or "").lower(), "title": pr.get("title"),
                              "url": pr.get("url"), "merged_at": pr.get("mergedAt")},
                "remote": r.ok}

    def prs_for_head(self, branch: str) -> list[dict]:
        """Every PR with this head branch (any state, any author): number, state, base, merge time and SHA."""
        d = json_cmd([self.gh, "pr", "list", "--repo", self.repo, "--head", branch, "--state", "all", "--limit", "10",
                      "--json", "number,state,baseRefName,mergedAt,mergeCommit,createdAt"], timeout=30)
        return [{"number": p["number"], "state": (p.get("state") or "").lower(), "base": p.get("baseRefName"),
                 "merged_at": p.get("mergedAt"), "merge_sha": (p.get("mergeCommit") or {}).get("oid"),
                 "created_at": p.get("createdAt")} for p in d]

    def deploy_runs(self) -> list[dict]:
        if not self.deploy_workflow:
            return []
        return json_cmd([self.gh, "run", "list", "--repo", self.repo, "--workflow", self.deploy_workflow,
                         "--branch", self.deploy_branch, "--limit", "10",
                         "--json", "databaseId,status,conclusion,headSha,createdAt"], timeout=45)

    def contains(self, base_sha: str, head_sha: str) -> bool:
        cmp = json_cmd([self.gh, "api", f"repos/{self.repo}/compare/{base_sha}...{head_sha}",
                        "--jq", "{status: .status}"], timeout=30)
        return cmp.get("status") in ("identical", "ahead")

    def pr_history(self, since_day: str) -> list[dict]:
        """Own PRs touched since a day: open, merge and review times (for history backfill)."""
        d = json_cmd([self.gh, "pr", "list", "--repo", self.repo, "--state", "all", "--author", "@me",
                      "--search", f"updated:>={since_day}", "--limit", "300",
                      "--json", "number,createdAt,mergedAt,closedAt,headRefName,latestReviews"], timeout=90)
        return [{"number": p["number"], "created_at": p.get("createdAt"), "merged_at": p.get("mergedAt"),
                 "branch": p.get("headRefName"),
                 "reviews": [{"login": (r.get("author") or {}).get("login"), "state": r.get("state"),
                              "at": r.get("submittedAt")} for r in p.get("latestReviews") or []]} for p in d]

    def deploy_history(self, since_day: str) -> list[dict]:
        """Successful production deploy runs since a day, oldest first."""
        if not self.deploy_workflow:
            return []
        runs = json_cmd([self.gh, "run", "list", "--repo", self.repo, "--workflow", self.deploy_workflow,
                         "--branch", self.deploy_branch, "--created", f">={since_day}", "--status", "success",
                         "--limit", "300", "--json", "databaseId,headSha,createdAt"], timeout=90)
        return sorted(runs, key=lambda r: r["createdAt"])

    def pr_url(self, n: int) -> str:
        return f"https://github.com/{self.repo}/pull/{n}"

    def merge_argv(self, n: int) -> list[str]:
        return [self.gh, "pr", "merge", str(n), "--repo", self.repo, "--squash"]

    def ready_argv(self, n: int, undo: bool = False) -> list[str]:
        return [self.gh, "pr", "ready", str(n), *(["--undo"] if undo else []), "--repo", self.repo]

    def rerun_argv(self, run_id: int | str) -> list[str]:
        return [self.gh, "run", "rerun", str(run_id), "--failed", "--repo", self.repo]

    def comment_argv(self, n: int, body: str) -> list[str]:
        return [self.gh, "pr", "comment", str(n), "--repo", self.repo, "--body", body]
