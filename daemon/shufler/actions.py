"""Action planning (validation + exact argv) and execution.

`plan()` is pure: it validates params against the current snapshot and returns
the exact commands. Preview and execute share it, so the confirm panel shows
precisely what runs.
"""

from __future__ import annotations

import json
import re
import shlex
import time
from dataclasses import dataclass, field
from typing import Any

from . import adapters, config
from .adapters.terminal import NEW_SURFACE_PLACEHOLDER, SURFACE_PLACEHOLDER, caps_of
from .runner import RunResult, run

BOARD_STAGES = config.BOARD_STAGES
CANNED_DISPATCH = config.CANNED_DISPATCH
POSTMERGE_PROMPT = config.POSTMERGE_PROMPT
INTAKE_TITLE = config.INTAKE_TITLE
DISPATCH_ACTIONS = ("dispatch", "answer_question", "postmerge", "new_item", "run_skill", "library_send")
SKILL_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9:_.-]{0,100}")
TOKEN_RE = re.compile(r"\{([a-z_]+)\}")
# Terminal capability each terminal lever needs (adapters/terminal CAPABILITY_FLAGS). `open_tab` opens a new
# tab/window in whichever terminal is configured.
TERMINAL_NEEDS = {
    "focus": (("can_focus", "focus a session"),),
    "open_tab": (("can_open", "open a new tab"),),
    **{a: (("can_send", "type into a session"), ("can_read_screen", "read a session's screen"))
       for a in DISPATCH_ACTIONS},
}
SKILL_TOKENS = ("pr", "branch", "station", "link", "link_or_text", "text", "question")
CONFIRM_LEVELS = {
    "focus": "none", "open_pr": "none", "open_preview": "none", "ack": "none",
    "merge": "typed",
}  # everything else: "tap"

# Never-do list, enforced on every command and every prompt sent to a session, whatever the UI asks.
NEVER_DO = (
    (re.compile(r"\breset\s+--hard\b", re.I), "git reset --hard"),
    (re.compile(r"\bpush\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)", re.I), "force push"),
    (re.compile(r"\bworktree\s+(remove|prune)\b", re.I), "worktree removal"),
    (re.compile(r"\b(pkill|killall)\b|\bkill\s+-?\d|\bkill\s+%", re.I), "process kill"),
    (re.compile(r"chat\.postMessage|slack-draft\s+(send|post)|\bslack\b[^\n]*\bpost\b[^\n]*--send", re.I), "Slack post"),
    (re.compile(r"\bsend_email\b|\bsendmail\b", re.I), "outbound send"),
)
# Caller-identity env from the daemon's own terminal must not leak into actions; the target is always explicit.
SCRUB_ENV = ("CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID", "CMUX_PANEL_ID", "CMUX_TAB_ID", "ITERM_SESSION_ID", "TMUX_PANE")


class ActionError(ValueError):
    pass


@dataclass
class Plan:
    action: str
    steps: list[list[str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    timeout: float = config.ACTION_TIMEOUT
    url: str | None = None
    facts: dict[str, Any] = field(default_factory=dict)

    @property
    def command(self) -> str:
        prefix = " ".join(f"{k}={shlex.quote(v)}" for k, v in self.env.items())
        lines = [shlex.join(s) for s in self.steps]
        if prefix:
            lines = [f"{prefix} {l}" for l in lines]
        if self.url and not lines:
            return f"open {self.url}"
        return "\n".join(lines)


def never_do_check(text: str) -> None:
    for pattern, label in NEVER_DO:
        if pattern.search(text or ""):
            raise ActionError(f"refused by the never-do guard: {label}")


# ---------------------------------------------------------------- validation helpers

def _station(snapshot: dict, params: dict) -> dict:
    sid = params.get("station_id")
    for s in [*snapshot.get("stations", []), *snapshot.get("utility_stations", [])]:
        if s["id"] == sid or s.get("ref") == sid:
            return s
    raise ActionError(f"unknown station_id: {sid!r}")


def _pr(snapshot: dict, params: dict, *, open_only: bool = True) -> tuple[int, dict]:
    raw = params.get("pr")
    try:
        n = int(str(raw).lstrip("#"))
    except (TypeError, ValueError):
        raise ActionError(f"pr must be a number, got {raw!r}") from None
    for w in snapshot.get("workpieces", []):
        if w["pr"] == n and (not open_only or w["stage"] not in ("merged", "deployed")):
            return n, w
    raise ActionError(f"#{n} is not one of your {'open ' if open_only else ''}PRs on the floor")


def _text(params: dict, key: str = "text", limit: int = 4000) -> str:
    t = params.get(key)
    if not isinstance(t, str) or not t.strip():
        raise ActionError(f"{key} is required")
    t = t.strip()
    if len(t) > limit:
        raise ActionError(f"{key} is longer than {limit} characters")
    if any(ord(c) < 32 and c not in "\n\t" for c in t):
        raise ActionError(f"{key} contains control characters")
    return t


def _skill_context(snapshot: dict, params: dict, st: dict) -> dict[str, str]:
    ctx = {k: v for k, v in (params.get("context") or {}).items() if isinstance(v, (str, int))}
    ctx.setdefault("station", st.get("title") or "")
    pr = params.get("pr") or ctx.get("pr")
    if not pr and str(st.get("focus_workpiece_id") or "").startswith("pr:"):
        pr = st["focus_workpiece_id"][3:]
    if pr:
        n, w = _pr(snapshot, {"pr": pr}, open_only=False)
        ctx["pr"] = str(n)
        if w.get("branch"):
            ctx.setdefault("branch", w["branch"])
    for k in ("link", "link_or_text", "text", "question"):
        if isinstance(params.get(k), str):
            ctx.setdefault(k, params[k])
    return {k: str(v) for k, v in ctx.items()}


def fill_tokens(template: str, ctx: dict[str, str]) -> str:
    unknown = sorted({t for t in TOKEN_RE.findall(template) if t not in SKILL_TOKENS})
    if unknown:
        raise ActionError(f"unknown token(s): {', '.join('{' + t + '}' for t in unknown)}")
    missing = sorted({t for t in TOKEN_RE.findall(template) if not ctx.get(t)})
    if missing:
        raise ActionError(f"args need {', '.join('{' + t + '}' for t in missing)}")
    return TOKEN_RE.sub(lambda m: ctx[m.group(1)], template)


def term_label(term=None) -> str:
    """The terminal's display name for messages ("cmux", "iTerm2", "tmux")."""
    term = term or adapters.current().terminal
    return getattr(term, "label", None) or getattr(term, "name", None) or "the terminal"


def _need(thing, what: str):
    if not thing:
        raise ActionError(f"{what} is not configured (see config.toml)")
    return thing


def _card_id(params: dict) -> str:
    cid = str(params.get("card_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cid):
        raise ActionError("card_id must be letters, digits, _ or - (1 to 64 characters)")
    return cid


# ---------------------------------------------------------------- custom commands ([[commands]])

COMMAND_TOKEN_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")
STATION_TOKENS = ("station_id", "station", "session_id", "cwd")


def _command_values(cmd: dict, params: dict) -> dict[str, str]:
    raw = params.get("values") or {}
    if not isinstance(raw, dict):
        raise ActionError("values must be an object")
    out: dict[str, str] = {}
    for i in cmd["inputs"]:
        v = raw.get(i["name"])
        if i["type"] == "flag":
            out[i["name"]] = i["arg"] if v is True or v == "true" else ""
            continue
        if v is None or (isinstance(v, str) and not v.strip()):
            if i.get("default") not in (None, ""):
                v = str(i["default"])
            elif i["optional"]:
                out[i["name"]] = ""
                continue
            else:
                raise ActionError(f"{i['label']} is required")
        if not isinstance(v, (str, int, float)):
            raise ActionError(f"{i['label']} must be text")
        v = str(v).strip()
        if len(v) > i["max"]:
            raise ActionError(f"{i['label']} is longer than {i['max']} characters")
        if any(ord(c) < 32 and c not in ("\n\t" if i["multiline"] else "") for c in v):
            raise ActionError(f"{i['label']} contains control characters" if i["multiline"]
                              else f"{i['label']} must be one line")
        if i["type"] == "choice" and v not in i["choices"]:
            raise ActionError(f"{i['label']} must be one of {', '.join(i['choices'])}")
        out[i["name"]] = v
    return out


def _fill_command(template: str, ctx: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        if m.group(1) not in ctx:
            raise ActionError(f"command template uses unknown token {{{m.group(1)}}}")
        return ctx[m.group(1)]
    return COMMAND_TOKEN_RE.sub(sub, template)


def _run_command(p: Plan, snapshot: dict, params: dict) -> None:
    """A [[commands]] entry: fill its argv (and env) from the inputs and, for station scope, the session."""
    cid = str(params.get("command") or "")
    cmd = config.COMMANDS.get(cid)
    if not cmd:
        raise ActionError(f"unknown command {cid!r}" + (f"; configured: {', '.join(config.COMMANDS)}"
                                                          if config.COMMANDS else " (none configured)"))
    ctx = _command_values(cmd, params)
    if cmd["scope"] == "station":
        st = _station(snapshot, params)
        ctx.update({"station_id": st["id"], "station": st.get("title") or "", "session_id": st.get("session_id") or "",
                    "cwd": st.get("cwd") or ""})
        uses = {t for a in [*cmd["argv"], *cmd["env"].values()] for t in COMMAND_TOKEN_RE.findall(a)}
        if "session_id" in uses and not ctx["session_id"]:
            raise ActionError(f"{st.get('title')} has no known agent session id")
        p.facts["station"] = st.get("title")
    whole = {i["name"] for i in cmd["inputs"]}
    argv: list[str] = []
    for a in cmd["argv"]:
        m = COMMAND_TOKEN_RE.fullmatch(a)
        if m and m.group(1) in whole and ctx.get(m.group(1)) == "":
            continue  # an empty optional input or an unset flag drops its whole argument
        argv.append(_fill_command(a, ctx))
    p.steps = [argv]
    p.env = {k: _fill_command(v, ctx) for k, v in cmd["env"].items()}
    p.timeout = cmd["timeout"]
    p.facts.update({"command_id": cid, "label": cmd["label"], "prod": cmd["prod"], "confirm": cmd["confirm"]})
    if cmd["prod"]:
        p.warnings.append(f"PROD: {cmd['label']} runs against production")
    if cmd["confirm"] == "typed":
        p.facts["requires_typed_confirmation"] = cid


# ---------------------------------------------------------------- planning

def _dispatch_steps(p: Plan, st: dict, text: str) -> None:
    if "\n" in text or "\t" in text:
        text = " ".join(text.split())
        p.warnings.append("newlines were collapsed to spaces so the prompt is sent as one line")
    never_do_check(text)
    ws, t = st["id"], adapters.current().terminal
    p.steps = [
        t.list_surfaces_argv(ws),
        t.send_text_argv(ws, SURFACE_PLACEHOLDER, text),
        t.send_key_argv(ws, SURFACE_PLACEHOLDER, "Return"),
        t.read_screen_argv(ws, SURFACE_PLACEHOLDER, 20),
    ]
    if (st.get("activity") or {}).get("status") == "active":
        p.warnings.append("this session is active right now; the text queues behind its current turn")
    if (st.get("note") or {}).get("state") == "done":
        p.warnings.append("this session's note says done")
    p.facts.update({"station": st.get("title"), "session_id": st.get("session_id"), "text": text,
                    "harness": st.get("harness")})


def _keystroke_steps(p: Plan, st: dict, presses: list[tuple[str, str]]) -> None:
    """Answer a harness prompt with keys instead of a typed line: ("text", "y") types y, ("key", "Escape") presses
    Esc. Executed in order without the empty-input check (the prompt replaces the input box)."""
    ws, t = st["id"], adapters.current().terminal
    p.steps = [t.list_surfaces_argv(ws)]
    for kind, value in presses:
        if kind == "text":
            never_do_check(value)
            p.steps.append(t.send_text_argv(ws, SURFACE_PLACEHOLDER, value))
        else:
            p.steps.append(t.send_key_argv(ws, SURFACE_PLACEHOLDER, value))
    p.steps.append(t.read_screen_argv(ws, SURFACE_PLACEHOLDER, 20))
    shown = " then ".join(f"types {v}" if k == "text" else f"presses {v}" for k, v in presses)
    p.warnings.append(f"answers {st.get('harness') or 'the agent'}'s prompt with keys: {shown}")
    p.facts.update({"station": st.get("title"), "session_id": st.get("session_id"), "harness": st.get("harness"),
                    "keystrokes": [list(x) for x in presses],
                    "text": next((v for k, v in reversed(presses) if k == "text"), "")})


def _library_send(p: Plan, snapshot: dict, params: dict) -> None:
    """Compose the per-harness context message and plan it as one send + Return per line (dispatch's path)."""
    from . import library
    st = _station(snapshot, params)
    try:
        ids = library.parse_item_ids(params.get("item_ids"))
    except library.LibraryError as e:
        raise ActionError(str(e)) from None
    lib = library.current()
    items = [lib.item(i) for i in ids]
    missing = [i for i, it in zip(ids, items) if not it]
    if missing:
        raise ActionError(f"no library item {', '.join(missing)}")
    note = params.get("note") or ""
    if note:
        note = _text(params, key="note", limit=1000)
    harness = params.get("harness") or library.harness_for(st)
    if harness not in library.HARNESSES:
        raise ActionError(f"harness must be one of {', '.join(library.HARNESSES)}")
    status = {s["path"]: s for it in items for s in (library.path_status(x) for x in it["paths"])}
    kinds = {k: v["kind"] for k, v in status.items() if v["kind"]}
    composed = library.compose(harness, items, st.get("cwd"), note, kinds)
    if params.get("text"):
        # the confirm panel's edited message: /add-dir lines go first, everything else is one prompt
        text = _text(params, limit=8000)
        raw = [l.strip() for l in text.splitlines() if l.strip()]
        dirs = [l for l in raw if l.startswith("/add-dir ")]
        prompt = " ".join(l for l in raw if not l.startswith("/add-dir "))
        lines = [*dirs, *([prompt] if prompt else [])]
        if lines != composed:
            p.warnings.append("the message was edited in the confirm panel")
    else:
        lines = composed
    if not lines or len(lines) > 20:
        raise ActionError("the message must have 1 to 20 lines")
    if any(ord(c) < 32 or c == "\x7f" for l in lines for c in l):  # each line is typed as-is, then Return
        raise ActionError("the message must not contain control characters such as newlines inside a line")
    for line in lines:
        never_do_check(line)
    ws, t = st["id"], adapters.current().terminal
    p.steps = [t.list_surfaces_argv(ws)]
    for line in lines:
        p.steps += [t.send_text_argv(ws, SURFACE_PLACEHOLDER, line), t.send_key_argv(ws, SURFACE_PLACEHOLDER, "Return")]
    p.steps.append(t.read_screen_argv(ws, SURFACE_PLACEHOLDER, 20))
    gone = sorted(k for k, v in status.items() if not v["exists"])
    if gone:
        p.warnings.append(f"missing on disk: {', '.join(gone)}")
    if any(l.startswith("/add-dir ") for l in lines):
        p.warnings.append("each /add-dir is sent on its own; the send stops if the session is not back at an empty prompt after it")
    if (st.get("activity") or {}).get("status") == "active":
        p.warnings.append("this session is active right now; the text queues behind its current turn")
    p.facts.update({"station": st.get("title"), "session_id": st.get("session_id"), "harness": harness,
                    "items": ", ".join(it["name"] for it in items), "item_ids": ids,
                    "message": "\n".join(lines), "text": lines[-1]})


def plan(action: str, params: dict, snapshot: dict) -> Plan:
    params = params or {}
    a = adapters.current()
    term = a.terminal
    if not isinstance(action, str):
        raise ActionError("action must be a string")
    p = Plan(action)
    caps = caps_of(term)
    for flag, what in TERMINAL_NEEDS.get(action, ()):
        if not caps[flag]:
            raise ActionError(f"the {term_label(term)} adapter cannot {what}; this lever is off for this terminal")

    if action == "focus":
        st = _station(snapshot, params)
        p.steps = [term.focus_argv(st["id"])]

    elif action == "dispatch":
        _dispatch_steps(p, _station(snapshot, params), _text(params))

    elif action == "answer_question":
        st = _station(snapshot, params)
        q = st.get("pending_question")
        if not q:
            p.warnings.append("no open question is recorded for this session; the text goes in as a plain prompt")
        text = _text(params)
        keys = getattr(a.agent_for(st.get("harness")), "answer_keys", None)
        presses = keys(q, text) if keys and q else None
        if presses:
            _keystroke_steps(p, st, presses)  # a Codex approval: the option's key, no Return
        else:
            _dispatch_steps(p, st, text)
        p.facts["question"] = (q or {}).get("question")

    elif action == "postmerge":
        n, w = _pr(snapshot, params, open_only=False)
        if w.get("stage") not in ("merged", "deployed"):
            raise ActionError(f"#{n} is not merged yet")
        if not w.get("station_id"):
            raise ActionError(f"no station on the floor owns #{n}")
        st = _station(snapshot, {"station_id": w["station_id"]})
        _dispatch_steps(p, st, POSTMERGE_PROMPT.format(pr=f"#{n}"))

    elif action == "new_item":
        text = _text(params, limit=2000)
        _need(INTAKE_TITLE, "intake.workspace")
        desk = next((x for x in snapshot.get("stations", []) if x.get("title") == INTAKE_TITLE), None)
        if not desk:
            raise ActionError(f"no {INTAKE_TITLE} station on the floor")
        _dispatch_steps(p, desk, config.INTAKE_PROMPT.replace("{text}", text))

    elif action == "reviewer_retrigger":
        n, _ = _pr(snapshot, params)
        p.steps = [_need(a.reviewer and a.reviewer.retrigger_argv(n), "reviewer.retrigger_command or retrigger_comment")]
        p.warnings.append("asks the review bot for a new review")

    elif action == "ci_rerun":
        n, w = _pr(snapshot, params)
        runs = w.get("failed_run_ids") or []
        if not runs:
            raise ActionError(f"#{n} has no failed check run to re-run")
        p.steps = [_need(a.scm, "scm.repo").rerun_argv(r) for r in runs]
        p.facts = {"ci": w.get("ci"), "failed_runs": runs}

    elif action == "pr_ready":
        n, w = _pr(snapshot, params)
        if not w.get("draft"):
            p.warnings.append(f"#{n} is already marked ready")
        p.steps = [_need(a.scm, "scm.repo").ready_argv(n)]

    elif action == "pr_draft":
        n, w = _pr(snapshot, params)
        if w.get("draft"):
            p.warnings.append(f"#{n} is already a draft")
        p.steps = [_need(a.scm, "scm.repo").ready_argv(n, undo=True)]

    elif action == "merge":
        n, w = _pr(snapshot, params)
        p.facts = {"ci": w.get("ci"), "reviewer": w.get("reviewer"), "draft": w.get("draft")}
        p.steps = [_need(a.scm, "scm.repo").merge_argv(n)]
        p.facts["reviewer_at_head"] = w.get("reviewer_at_head")
        p.facts["mergeable"] = w.get("mergeable")
        problems = []
        if w.get("ci") != "success":
            problems.append(f"CI is {w.get('ci')}, not success")
        if w.get("reviewer") == "off":
            pass  # no review bot configured
        elif w.get("reviewer") != "approved":
            problems.append(f"the review bot is {w.get('reviewer')}, not approved")
        elif not w.get("reviewer_at_head"):
            problems.append("the review bot's approval is older than the head commit")
        if w.get("mergeable") == "CONFLICTING":
            problems.append("PR has merge conflicts")
        if w.get("draft"):
            problems.append("PR is a draft")
        p.warnings += problems
        p.facts["blocked"] = problems
        p.facts["requires_typed_confirmation"] = str(n)

    elif action == "open_pr":
        n, _ = _pr(snapshot, params, open_only=False)
        p.url = _need(a.scm, "scm.repo").pr_url(n)

    elif action == "open_preview":
        n, _ = _pr(snapshot, params, open_only=False)
        p.url = _need(config.PREVIEW_URL, "scm.preview_url").format(pr=n)

    elif action == "run_command":
        _run_command(p, snapshot, params)

    elif action == "board_stage":
        cid = _card_id(params)
        stage = params.get("stage")
        if stage not in BOARD_STAGES:
            raise ActionError(f"stage must be one of {', '.join(BOARD_STAGES)}")
        p.steps = [_need(a.trackers.get("board"), "board.command").stage_argv(cid, stage)]

    elif action == "board_note":
        cid = _card_id(params)
        text = _text(params, limit=2000)
        p.steps = [_need(a.trackers.get("board"), "board.command").note_argv(cid, text)]
        p.warnings.append("adds a note to the linked board card")

    elif action == "issue_set":
        slug = str(params.get("slug") or "")
        key = str(params.get("key") or "")
        value = params.get("value")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,100}", slug):
            raise ActionError("slug must be lowercase letters, digits and dashes")
        known = {s for st in snapshot.get("stations", []) for s in st.get("issue_slugs", [])}
        known |= {w.get("issue_slug") for w in snapshot.get("workpieces", []) if w.get("issue_slug")}
        if known and slug not in known:
            p.warnings.append(f"issue {slug} is not linked to anything on the floor")
        if not re.fullmatch(r"[a-z_][a-z0-9_.]{0,60}", key):
            raise ActionError("key must look like state or pr.number")
        if not isinstance(value, (str, int, float)) or "\n" in str(value) or len(str(value)) > 500:
            raise ActionError("value must be a single line under 500 characters")
        records = _need(a.trackers.get("intake"), "intake.dir")
        p.steps = [_need(records.set_argv(slug, key, value), "intake.set_command")]

    elif action == "open_tab":
        st = _station(snapshot, params)
        command = params.get("command") or ""
        if command:
            command = _text(params, key="command", limit=2000)
            if "\n" in command:
                raise ActionError("command must be one line")
            never_do_check(command)
        ws = st["id"]
        p.steps = [term.open_surface_argv(ws)]
        if command:
            p.steps.append(term.send_text_argv(ws, NEW_SURFACE_PLACEHOLDER, command))
            p.warnings.append("the command is typed into the new tab without Enter")
        p.facts = {"station": st.get("title"), "command": command or None}

    elif action == "run_skill":
        name = str(params.get("skill") or "").lstrip("/")
        if not SKILL_NAME_RE.fullmatch(name):
            raise ActionError("skill must be a skill name such as pr-pre-review")
        known = {n: sk for sk in snapshot.get("skills") or [] for n in (sk["name"], *sk.get("aliases", ()))}
        settings = config.SKILL_SETTINGS.get(name, {})
        if params.get("station_id"):
            st = _station(snapshot, params)
        elif settings.get("target"):
            st = next((x for x in snapshot.get("stations", []) if x.get("title") == settings["target"]), None)
            if not st:
                raise ActionError(f"no {settings['target']} station on the floor")
        else:
            raise ActionError("pick a station to run the skill in")
        if name not in known:
            p.warnings.append(f"/{name} was not found among discovered skills; it is typed as-is")
        elif name not in (st.get("skill_names") or [name]):
            p.warnings.append(f"/{name} is not available in {st.get('title')}'s project")
        raw_args = params.get("args")
        template = raw_args if isinstance(raw_args, str) and raw_args.strip() else (settings.get("args_template") or "")
        if len(template) > 2000:
            raise ActionError("args are longer than 2000 characters")
        args = fill_tokens(template, _skill_context(snapshot, params, st)).strip()
        if any(ord(c) < 32 and c not in "\n\t" for c in args):
            raise ActionError("args contain control characters")
        _dispatch_steps(p, st, f"/{name} {args}".strip())
        confirm = settings.get("confirm") if settings.get("confirm") in config.SKILL_CONFIRM_LEVELS else "tap"
        p.facts.update({"skill": name, "args": args, "confirm": confirm})
        if confirm == "typed":
            p.facts["requires_typed_confirmation"] = name

    elif action == "library_send":
        _library_send(p, snapshot, params)

    elif action == "set_domain":
        from .world import domain_alias_for, load_domains, with_fallback
        domain, target = params.get("domain"), params.get("target")
        ids = [d["id"] for d in with_fallback(load_domains())]
        if domain not in ids:
            raise ActionError(f"domain must be one of {', '.join(ids)}")
        try:
            alias, what = domain_alias_for(str(target or ""), snapshot)
        except ValueError as e:
            raise ActionError(str(e)) from None
        p.facts = {"target": target, "domain": domain, "alias": alias, "alias_kind": what,
                   "config_file": str(config.CONFIG_FILE)}
        p.warnings.append(f"adds {what} `{alias}` as a manual alias of {domain} in {config.CONFIG_FILE.name}; "
                          f"every item with the same {what} moves with it")

    elif action == "ack":
        if params.get("kind") not in ("closeout", "reply"):
            raise ActionError("only closeout and reply rows can be acknowledged")
        p.facts = {"id": params.get("id"), "persisted": False}

    else:
        raise ActionError(f"unknown action: {action!r}")

    return p


def preview(action: str, params: dict, snapshot: dict) -> dict:
    p = plan(action, params, snapshot)
    return {"command": p.command, "warnings": p.warnings, "facts": p.facts, "url": p.url,
            "confirm": p.facts.get("confirm") or CONFIRM_LEVELS.get(action, "tap"),
            "text": p.facts.get("text")}


# ---------------------------------------------------------------- execution

def _env(p: Plan) -> dict[str, str]:
    import os
    env = {k: v for k, v in os.environ.items() if k not in SCRUB_ENV}
    env.update(p.env)
    return env


def _run(argv: list[str], p: Plan) -> RunResult:
    return run(argv, timeout=p.timeout, env=_env(p))


def _first_terminal_surface(out: str) -> str | None:
    return adapters.current().terminal.first_terminal_surface(out)


def execute(action: str, params: dict, snapshot: dict) -> dict:
    started = time.time()
    try:
        p = plan(action, params, snapshot)
        if action == "merge":
            if p.facts.get("blocked"):
                raise ActionError("merge refused: " + "; ".join(p.facts["blocked"]))
            if str(params.get("typed_confirmation", "")).strip() != p.facts["requires_typed_confirmation"]:
                raise ActionError("merge refused: typed confirmation does not match the PR number")
        elif p.facts.get("requires_typed_confirmation"):
            if str(params.get("typed_confirmation", "")).strip().lstrip("/") != p.facts["requires_typed_confirmation"]:
                raise ActionError(f"refused: type {p.facts['requires_typed_confirmation']} to confirm")
        for step in p.steps:
            never_do_check(shlex.join(step))
        result = _execute_plan(p)
    except ActionError as e:
        result = {"ok": False, "output": "", "error": str(e), "command": None}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "output": "", "error": f"{type(e).__name__}: {e}", "command": None}
    result["duration_s"] = round(time.time() - started, 2)
    log_action(action, params, result)
    return result


def _execute_plan(p: Plan) -> dict:
    if not p.steps:
        return {"ok": True, "output": p.url or "", "error": None, "command": p.command, "url": p.url}
    outputs: list[str] = []
    steps = [list(s) for s in p.steps]
    if p.action == "open_tab":
        r = _run(steps[0], p)
        if not r.ok:
            return {"ok": False, "output": r.combined(), "error": f"rc={r.rc}", "command": p.command}
        ref = adapters.current().terminal.new_surface_ref(r.stdout)
        if len(steps) == 1:
            return {"ok": True, "output": r.combined(), "error": None, "command": p.command}
        if not ref:
            return {"ok": False, "output": r.combined(), "error": "could not read the new surface ref", "command": p.command}
        send = [ref if a == NEW_SURFACE_PLACEHOLDER else a for a in steps[1]]
        r2 = _run(send, p)
        return {"ok": r2.ok, "output": "\n".join([r.combined(), r2.combined()]).strip(),
                "error": None if r2.ok else f"rc={r2.rc}", "command": p.command}
    if p.action in DISPATCH_ACTIONS:
        agent = adapters.current().agent_for(p.facts.get("harness"))
        r = _run(steps[0], p)
        surface = _first_terminal_surface(r.stdout) if r.ok else None
        if not surface:
            return {"ok": False, "output": r.combined(), "error": "no terminal surface found in that workspace",
                    "command": p.command}
        filled = [[surface if a == SURFACE_PLACEHOLDER else a for a in s] for s in steps[1:]]
        if p.facts.get("keystrokes"):
            outputs.append(f"surface: {surface}")
            for s in filled[:-1]:
                r = _run(s, p)
                if not r.ok:
                    return {"ok": False, "output": "\n".join(outputs + [r.combined()]),
                            "error": f"step failed (rc={r.rc}): {shlex.join(s)}", "command": p.command}
                time.sleep(0.4)  # let the TUI take each key before the next
            after = _run(filled[-1], p)
            outputs.append(after.combined())
            return {"ok": True, "output": "\n".join(outputs), "error": None, "command": p.command,
                    "landed": None, "echo": None}
        pairs, read = [filled[i:i + 2] for i in range(0, len(filled) - 1, 2)], filled[-1]
        outputs.append(f"surface: {surface}")
        before = _run(read, p)
        if not before.ok:
            return {"ok": False, "output": "\n".join(outputs + [before.combined()]),
                    "error": f"could not read the session's screen (rc={before.rc})", "command": p.command}
        draft = agent.input_draft(before.stdout)
        if draft:
            return {"ok": False, "output": "\n".join(outputs), "command": p.command, "draft": draft[:200],
                    "error": f"that session has unsent text in its input; finish or clear it in {term_label()} first"}
        if draft is None:
            outputs.append(f"note: no {getattr(agent, 'label', None) or 'Claude Code'} input box found on screen; sent anyway")
        for n, pair in enumerate(pairs):
            for s in pair:
                r = _run(s, p)
                if not r.ok:
                    return {"ok": False, "output": "\n".join(outputs + [r.combined()]),
                            "error": f"step failed (rc={r.rc}): {shlex.join(s)}", "command": p.command}
            if n < len(pairs) - 1:
                # multi-line sends (library_send's /add-dir lines): wait for an empty prompt before the next line,
                # so text never lands in a dialog the previous line opened
                time.sleep(1.0)
                mid = _run(read, p)
                if not mid.ok or agent.input_draft(mid.stdout) != "":
                    return {"ok": False, "output": "\n".join(outputs + [mid.combined()]), "command": p.command,
                            "error": f"stopped after `{pair[0][-1]}`: the session is not back at an empty prompt "
                                     f"(it may be asking to confirm); finish it in {term_label()}, then send again"}
        time.sleep(1.0)  # give the TUI a moment to render the submitted prompt
        after = _run(read, p)
        echo = agent.echo_line(after.stdout, p.facts.get("text") or "") if after.ok else None
        outputs.append(after.combined())
        return {"ok": True, "output": "\n".join(outputs), "error": None, "command": p.command,
                "landed": echo is not None, "echo": echo}
    for s in steps:
        r = _run(s, p)
        outputs.append(r.combined())
        if not r.ok:
            return {"ok": False, "output": "\n".join(outputs)[: config.OUTPUT_LIMIT],
                    "error": f"rc={r.rc}", "command": p.command}
    return {"ok": True, "output": "\n".join(outputs)[: config.OUTPUT_LIMIT], "error": None,
            "command": p.command, "url": p.url}


def apply_set_domain(params: dict, snapshot: dict) -> dict:
    """Persist the manual alias for `set_domain`; the caller re-derives the snapshot."""
    try:
        p = plan("set_domain", params, snapshot)
        path = config.save_domain_alias(p.facts["domain"], p.facts["alias"])
    except (ActionError, ValueError, PermissionError) as e:
        return {"ok": False, "output": "", "error": str(e), "command": None}
    f = p.facts
    return {"ok": True, "error": None, "command": None, "facts": f,
            "output": f"{f['alias_kind']} `{f['alias']}` → {f['domain']} (manual alias in {path})"}


def log_action(action: str, params: dict, result: dict) -> None:
    rec = {"ts": time.time(), "action": action, "params": params,
           "result": {k: (v[:2000] if isinstance(v, str) else v) for k, v in result.items()}}
    try:
        config.ACTIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(config.ACTIONS_LOG, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
    except OSError:
        pass
