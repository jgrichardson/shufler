"""Settings, loaded once from config.toml with env overrides for tests.

Lookup order: $SHUFLER_CONFIG, ~/.config/shufler/config.toml, then the
in-repo config.example.toml (sample values, optional adapters off). Nothing
machine-specific lives in this file; it all comes from the TOML.

Environment overrides are read as SHUFLER_<NAME>.
"""

from __future__ import annotations

import os
import re
import tomllib
from pathlib import Path
from typing import Any

# The product's names, each defined once here. SLUG is the CLI name and the config/cache/data dir name;
# the Python package dir (daemon/shufler), pyproject and the bin script are named by hand to match.
PRODUCT_NAME = "Shufler"
SLUG = "shufler"
ENV_PREFIX = "SHUFLER_"

HOME = Path.home()
DAEMON_DIR = Path(__file__).resolve().parents[1]
EXAMPLE_CONFIG = DAEMON_DIR / "config.example.toml"

APP_DIR = SLUG


def env(name: str, default: str | None = None) -> str | None:
    """ENV_PREFIX + name from the environment, else `default`."""
    return os.environ.get(ENV_PREFIX + name, default)


def app_dir(base: Path) -> Path:
    return base / APP_DIR


CONFIG_DIR = app_dir(HOME / ".config")
CACHE_HOME = app_dir(HOME / ".cache")
DATA_DIR = app_dir(HOME / ".local" / "share")
USER_CONFIG = CONFIG_DIR / "config.toml"


def config_path() -> Path:
    if env("CONFIG"):
        return Path(env("CONFIG")).expanduser()
    return USER_CONFIG if USER_CONFIG.exists() else EXAMPLE_CONFIG


CONFIG_FILE = config_path()
CFG: dict[str, Any] = tomllib.loads(CONFIG_FILE.read_text())


def section(*keys: str) -> dict:
    d: Any = CFG
    for k in keys:
        d = d.get(k) or {} if isinstance(d, dict) else {}
    return d if isinstance(d, dict) else {}


def _path(value: str | None) -> Path | None:
    return Path(value).expanduser() if value else None


def _p(name: str, default: Path | str | None) -> Path | None:
    v = env(name)
    return _path(v) if v is not None else (_path(str(default)) if default else None)


def _cmd(sec: dict, key: str = "command", enabled: bool = True) -> str | None:
    """A configured CLI path, or None when the adapter is off or unset."""
    if not enabled or not sec.get(key):
        return None
    return str(Path(sec[key]).expanduser())


app = section("app")
HOST = "127.0.0.1"
PORT = int(env("PORT") or app.get("port") or 4700)

ROOT = _p("ROOT", DAEMON_DIR.parent)
WEB_DIST = _p("WEB_DIST", ROOT / "web" / "dist")
ACTIONS_LOG = _p("ACTIONS_LOG", app.get("actions_log") or ROOT / "actions.jsonl")
# Names that mean "the person running Shufler" in ledger ball cells and session notes ("me: merge #12").
OWNER_ALIASES = tuple(a.lower() for a in (app.get("owner_aliases") or ["me"]))
CACHE_DIR = _p("CACHE_DIR", app.get("cache_dir") or CACHE_HOME)

# terminal: `kind` picks the adapter (adapters/terminal REGISTRY); "auto" (the default) detects it on first use.
# Each adapter reads its own section ([cmux], [iterm2], [tmux]).
terminal = section("terminal")
TERMINAL_KIND = (env("TERMINAL") or terminal.get("kind") or "auto").strip().lower()
cmux_cfg = section("cmux")
CMUX = env("CMUX") or cmux_cfg.get("bin") or "cmux"
COMMAND_TITLES = {str(t).upper() for t in terminal.get("command_titles") or []}
# Utility rows (tools, not work): no row in the world, still reachable from the terminal drawer.
UTILITY_TITLES = [str(x) for x in (terminal.get("utility") or [])]
PROCESSES_ENABLED = terminal.get("processes", True) is not False and env("PROCESSES") != "0"
PROCESS_SESSION_RECENT_S = 3600

# agent accounts
agent = section("agent")
AGENT_ADAPTER = agent.get("adapter", "claude-code")
ACCOUNTS: dict[str, dict] = {}
TRANSCRIPT_ROOTS: dict[str, Path] = {}
USAGE_CACHE: dict[str, Path] = {}
for a in agent.get("accounts") or []:
    name = a["name"]
    ACCOUNTS[name] = {"label": a.get("label", name), "claude_json": _path(a.get("claude_json")),
                      "settings": _path(a.get("settings"))}
    TRANSCRIPT_ROOTS[name] = _p(f"TRANSCRIPTS_{name.upper()}", a.get("projects_dir")) or Path("/nonexistent")
    if a.get("usage_cache"):
        USAGE_CACHE[name] = _path(a["usage_cache"])

# scm
scm = section("scm")
SCM_ADAPTER = scm.get("adapter", "github")
GH = env("GH") or scm.get("gh") or "gh"
REPO = scm.get("repo") or ""
DEPLOY_WORKFLOW = scm.get("deploy_workflow") or ""
DEPLOY_BRANCH = scm.get("deploy_branch") or "main"
PREVIEW_URL = scm.get("preview_url") or ""
WORKTREE_ROOTS = [str(x) for x in (scm.get("worktree_roots") or ["~/worktrees"])]
PR_URL = f"https://github.com/{REPO}/pull/{{pr}}" if REPO else ""

# external reviewer bot (optional): a bot that reviews PRs under a known GitHub login
review = section("reviewer")
REVIEW_ENABLED = bool(review.get("enabled")) and bool(review.get("login_regex"))
REVIEWER_LOGIN_RE = env("REVIEWER_LOGIN_RE") or (review.get("login_regex") if REVIEW_ENABLED else None) or r"(?!x)x"


def _argv(value) -> list[str] | None:
    """An argv template from config (a list of strings), first element ~-expanded; None when unset."""
    if not value:
        return None
    if isinstance(value, str):
        value = [value]
    out = [str(x) for x in value]
    out[0] = str(Path(out[0]).expanduser())
    return out


# Status watcher: an argv printing {"prs": {"<n>": {"status": ..., "cycle": n}}} as JSON.
REVIEWER_STATUS_ARGV = _argv(review.get("status_command")) if REVIEW_ENABLED else None
# How to ask for a re-review: an argv template with {pr}, else a PR comment (gh pr comment) with {pr} filled.
REVIEWER_RETRIGGER_ARGV = _argv(review.get("retrigger_command")) if REVIEW_ENABLED else None
REVIEWER_RETRIGGER_COMMENT = (review.get("retrigger_comment") or "") if REVIEW_ENABLED else ""

# intake (optional): work-item records on disk, and a workspace that takes new items
intake = section("intake")
INTAKE_ENABLED = bool(intake.get("enabled"))
ISSUES_DIR = _p("INTAKE_DIR", intake.get("dir") if INTAKE_ENABLED else None)
ISSUE_CMD = _cmd(intake, "set_command", INTAKE_ENABLED)
INTAKE_TITLE = (intake.get("workspace") or "") if INTAKE_ENABLED else ""
INTAKE_PROMPT = intake.get("prompt") or "{text}"
REPLY_EVENTS = tuple(intake.get("reply_events") or ("user_replied", "ready_for_owner"))

# area ledgers (optional): <dir>/<area>/ledger.md, one markdown "## Open" table per work area
ledgers = section("ledgers")
LEDGERS_DIR = _p("LEDGERS_DIR", ledgers.get("dir") if ledgers.get("enabled") else None)
# The env var naming a session's area on its agent process (`LEDGER_AREA=billing claude`).
LEDGER_AREA_ENV = str(ledgers.get("area_env") or "LEDGER_AREA")
# A ledger row whose Session cell contains this word belongs to the session running that area.
LEDGER_SESSION_MARKER = str(ledgers.get("session_marker") or "area").lower()

# board (optional): an external board CLI holding one card per intake record
board = section("board")
BOARD_CMD = _cmd(board, enabled=bool(board.get("enabled")))
BOARD_STAGES = tuple(board.get("stages") or ("backlog", "in_progress", "in_review", "done"))
BOARD_GET_ARGS = [str(x) for x in board.get("get_args") or ["get", "{id}"]]
BOARD_STAGE_ARGS = [str(x) for x in board.get("stage_args") or ["stage", "{id}", "{stage}"]]
BOARD_NOTE_ARGS = [str(x) for x in board.get("note_args") or ["note", "{id}", "{text}"]]
BOARD_STAGE_RE = board.get("stage_pattern") or r"stage=(\S+)"
BOARD_RECORD_KEY = str(board.get("record_key") or "card")   # the intake record's key holding {id, stage}

# work phases (the seven districts, left to right)
DEFAULT_PHASES = (
    ("brainstorm", "Brainstorm", "#9aa4b2", "Exploring the idea."),
    ("plan", "Plan", "#7c8cf8", "Planning the work."),
    ("build", "Build", "#f2b544", "Building on a branch or draft PR."),
    ("qa", "QA", "#45c7e0", "Testers have it on preview."),
    ("review", "Review", "#f28c38", "In review: PR review, review bot, CI."),
    ("merge", "Merge", "#a56cf0", "Ready to merge."),
    ("deploy", "Deploy", "#3dd68c", "Merged, waiting on the production deploy."),
)
_DEFAULT_DESC = {i: d for i, _, _, d in DEFAULT_PHASES}
PHASES: tuple[dict, ...] = tuple(
    {"id": str(p["id"]), "label": str(p.get("label") or str(p["id"]).title()), "color": p.get("color"),
     "description": p.get("description") or _DEFAULT_DESC.get(str(p["id"]), "")}
    for p in (section("pipeline").get("stages") or [])
    if isinstance(p, dict) and p.get("id")) or tuple(
    {"id": i, "label": label, "color": color, "description": desc} for i, label, color, desc in DEFAULT_PHASES)
PHASE_IDS = tuple(p["id"] for p in PHASES)

# session notes (optional): <dir>/<session-id>.json written by whatever tool you use to label sessions
notes = section("notes")
NOTES_ENABLED = bool(notes.get("enabled"))
SESSION_NOTES_DIR = _p("SESSION_NOTES_DIR", notes.get("dir") if NOTES_ENABLED else None)

ACTION_TIMEOUT_DEFAULT = 30

# custom commands ([[commands]]): named CLIs shown as levers, run through the confirm panel
COMMAND_ID_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,40}")
COMMAND_INPUT_TYPES = ("text", "choice", "flag")
COMMAND_CONFIRM = ("none", "tap", "typed")


def _commands(items) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for c in items or ():
        if not isinstance(c, dict) or not COMMAND_ID_RE.fullmatch(str(c.get("id") or "")) or not c.get("argv"):
            continue
        inputs = []
        for i in c.get("inputs") or ():
            if not isinstance(i, dict) or not re.fullmatch(r"[a-z_][a-z0-9_]{0,30}", str(i.get("name") or "")):
                continue
            kind = i.get("type") or ("choice" if i.get("choices") else "text")
            if kind not in COMMAND_INPUT_TYPES:
                continue
            inputs.append({"name": i["name"], "label": str(i.get("label") or i["name"].replace("_", " ").title()),
                           "type": kind, "choices": [str(x) for x in i.get("choices") or []],
                           "max": int(i.get("max") or 2000), "multiline": bool(i.get("multiline")),
                           "placeholder": str(i.get("placeholder") or ""), "default": i.get("default"),
                           "arg": str(i.get("arg") or ""), "optional": bool(i.get("optional"))})
        confirm = c.get("confirm") if c.get("confirm") in COMMAND_CONFIRM else "tap"
        out[c["id"]] = {
            "id": c["id"], "label": str(c.get("label") or c["id"]), "description": str(c.get("description") or ""),
            "scope": "station" if c.get("scope") == "station" else "global", "confirm": confirm,
            "prod": bool(c.get("prod")), "inputs": inputs, "argv": _argv(c["argv"]),
            "env": {str(k): str(v) for k, v in (c.get("env") or {}).items()},
            "timeout": float(c.get("timeout") or ACTION_TIMEOUT_DEFAULT),
        }
    return out


COMMANDS: dict[str, dict] = _commands(CFG.get("commands"))

# prompts
prompts = section("prompts")
POSTMERGE_PROMPT = prompts.get("postmerge") or "{pr} is merged. Give me the short message to close with the user."
def _canned(items) -> tuple[dict, ...]:
    """Canned dispatch prompts as {group, label, text}; plain strings load as group "Custom"."""
    out = []
    for c in items or ():
        if isinstance(c, str) and c.strip():
            out.append({"group": "Custom", "label": c if len(c) <= 28 else c[:28].rstrip() + "…", "text": c})
        elif isinstance(c, dict) and isinstance(c.get("text"), str) and c["text"].strip():
            out.append({"group": str(c.get("group") or "Custom"), "label": str(c.get("label") or c["text"][:28]),
                        "text": c["text"]})
    return tuple(out)


CANNED_DISPATCH = _canned(prompts.get("canned"))

# web terminals
terms = section("terminals")
TERMINALS_ENABLED = terms.get("enabled", True) is not False
MAX_TERMINALS = int(terms.get("max") or 6)
TERMINAL_IDLE_S = int(terms.get("idle_close_s") or 7200)
TERMINAL_PRESETS: dict[str, dict] = {k: dict(v) for k, v in (terms.get("presets") or {}).items()}

# history (time travel)
hist = section("history")
HISTORY_ENABLED = hist.get("enabled", True) is not False and env("HISTORY") != "0"
HISTORY_DB = _p("HISTORY_DB", hist.get("path") or DATA_DIR / "history.sqlite")
HISTORY_RETENTION_DAYS = int(hist.get("retention_days") or 90)
HISTORY_BACKFILL_DAYS = int(hist.get("backfill_days") if hist.get("backfill_days") is not None else 30)

# world layout
world = section("world")
FALLBACK_DOMAIN = world.get("fallback_domain") or "unassigned"
COMMAND_DOMAIN = world.get("command_domain") or "command"
# Branches and ledger topics matching this are drawn as data fixes rather than features.
FIX_PATTERN = world.get("fix_pattern") or r"data|backfill|migrat|repair"
DOMAINS: list[dict] = list(CFG.get("domain") or [])

# context library: next to the active config.toml, or the user config dir while the in-repo example is active
LIBRARY_FILE = _p("LIBRARY", (USER_CONFIG.parent if CONFIG_FILE.resolve() == EXAMPLE_CONFIG.resolve()
                                      else CONFIG_FILE.parent) / "library.json")

ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
if env("DEV") == "1":
    ALLOWED_ORIGINS |= {"http://127.0.0.1:5173", "http://localhost:5173"}

ACTION_TIMEOUT = ACTION_TIMEOUT_DEFAULT
OUTPUT_LIMIT = 20_000

ACTIVE_WINDOW_S = 120
STALLED_AFTER_S = 900
SUBAGENT_LIVE_S = 90
TRANSCRIPT_RECENT_S = 24 * 3600
TRANSCRIPT_FIRST_READ_MAX = 64 * 1024 * 1024


def terminal_kind() -> str:
    """The configured terminal, with "auto" resolved (once) by the adapter registry."""
    from .adapters.terminal import resolve_kind
    return resolve_kind(TERMINAL_KIND, CFG)


def public_commands() -> list[dict]:
    """[[commands]] as the web sees them: no argv or env (the confirm panel shows the filled command)."""
    keep = ("id", "label", "description", "scope", "confirm", "prod")
    return [{**{k: c[k] for k in keep},
             "inputs": [{k: v for k, v in i.items() if k != "arg"} for i in c["inputs"]]} for c in COMMANDS.values()]


def capabilities() -> dict:
    """What the configured adapters can do; the web hides levers that are off."""
    tracker = [n for n, on in (("intake", bool(ISSUES_DIR)), ("ledgers", bool(LEDGERS_DIR)),
                               ("board", bool(BOARD_CMD))) if on]
    return {
        "product": PRODUCT_NAME,
        "terminal": terminal_kind(),
        "agent": AGENT_ADAPTER,
        "scm": SCM_ADAPTER if REPO else None,
        "reviewer": bool(REVIEW_ENABLED),
        "reviewer_retrigger": bool(REVIEW_ENABLED and (REVIEWER_RETRIGGER_ARGV or (REVIEWER_RETRIGGER_COMMENT and REPO))),
        "tracker": tracker,
        "board_stages": list(BOARD_STAGES) if BOARD_CMD else [],
        "issue_set": bool(ISSUE_CMD),
        "session_notes": bool(SESSION_NOTES_DIR),
        "commands": public_commands(),
        "owner_aliases": list(OWNER_ALIASES),
        "command_titles": sorted(COMMAND_TITLES),
        "deploys": bool(REPO and DEPLOY_WORKFLOW),
        "preview": bool(PREVIEW_URL),
        "intake": bool(INTAKE_TITLE),
        "terminals": TERMINALS_ENABLED,
        "skills": True,
        "history": HISTORY_ENABLED,
        "skills_config_writable": CONFIG_FILE.resolve() != EXAMPLE_CONFIG.resolve(),
        "terminal_presets": sorted(["shell_here", *(k for k, v in TERMINAL_PRESETS.items() if v.get("command"))]),
    }


# ---------------------------------------------------------------- skills ([skills] in config.toml)

SKILL_CONFIRM_LEVELS = ("none", "tap", "typed")
# Where a pinned skill shows as a button: the session panel, the PR panel, the world panel, the question box, or nowhere.
SKILL_PLACEMENTS = ("station", "pr", "global", "question", "none")
SKILL_KEYS = ("target", "args_template", "confirm", "pin", "placement")


def _load_skills(cfg: dict) -> tuple[list[str], list[str], dict[str, dict]]:
    sk = cfg.get("skills") or {}
    per = {k: {kk: vv for kk, vv in v.items() if kk in SKILL_KEYS} for k, v in sk.items() if isinstance(v, dict)}
    return list(sk.get("expose") or []), list(sk.get("hide") or []), per


SKILLS_EXPOSE, SKILLS_HIDE, SKILL_SETTINGS = _load_skills(CFG)


def _toml_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _toml_key(k: str) -> str:
    return k if all(c.isalnum() or c in "-_" for c in k) else _toml_str(k)


def _toml_val(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_toml_val(x) for x in v) + "]"
    return _toml_str(str(v))


def render_skills_toml(expose: list[str], hide: list[str], settings: dict[str, dict]) -> str:
    out = ["[skills]", f"expose = {_toml_val(expose)}", f"hide = {_toml_val(hide)}"]
    for name in sorted(settings):
        vals = {k: v for k, v in settings[name].items() if k in SKILL_KEYS and v not in (None, "")}
        if vals:
            out.append("")
            out.append(f"[skills.{_toml_key(name)}]")
            out += [f"{k} = {_toml_val(v)}" for k, v in vals.items()]
    return "\n".join(out) + "\n"


def replace_skills_section(text: str, block: str) -> str:
    """Drop every [skills] / [skills.*] table from the TOML text and append `block`."""
    kept, skipping = [], False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("[") and not s.startswith("[["):
            skipping = s == "[skills]" or s.startswith("[skills.")
        elif s.startswith("[["):
            skipping = False
        if not skipping:
            kept.append(line)
    body = "\n".join(kept).rstrip() + "\n\n"
    return body + block


def save_skills(expose: list[str], hide: list[str], settings: dict[str, dict], path: Path | None = None) -> Path:
    """Persist [skills] to the active config file; the in-repo example is never written."""
    global SKILLS_EXPOSE, SKILLS_HIDE, SKILL_SETTINGS
    path = path or CONFIG_FILE
    if path.resolve() == EXAMPLE_CONFIG.resolve():
        raise PermissionError(f"no user config yet: run `bin/{SLUG} init` first")
    text = replace_skills_section(path.read_text(), render_skills_toml(expose, hide, settings))
    tomllib.loads(text)  # never write a file that no longer parses
    tmp = path.with_suffix(".toml.tmp")
    tmp.write_text(text)
    tmp.replace(path)
    SKILLS_EXPOSE, SKILLS_HIDE, SKILL_SETTINGS = list(expose), list(hide), {k: dict(v) for k, v in settings.items()}
    return path


# ---------------------------------------------------------------- manual domain aliases ([[domain]] manual = [...])

ALIAS_RE = re.compile(r"[A-Za-z0-9_./ -]{1,100}")


def check_alias(alias: str) -> str:
    """Aliases come from PR titles, branches and workspace titles (external text): strict charset only."""
    if not isinstance(alias, str) or not ALIAS_RE.fullmatch(alias) or not alias.strip():
        raise ValueError("alias may only contain letters, digits, space and _ . / - (1 to 100 characters)")
    return alias


def _without_manual(cfg: dict) -> dict:
    out = dict(cfg)
    out["domain"] = [{k: v for k, v in d.items() if k != "manual"} for d in cfg.get("domain") or []]
    return out


def set_domain_alias_text(text: str, domain: str, alias: str) -> str:
    """Return the TOML text with `alias` in the `manual` list of the [[domain]] table `domain`, and removed from
    every other domain's `manual` list. Round-trips through tomlkit, then proves the only change is `manual`."""
    import tomlkit
    check_alias(alias)
    before = tomllib.loads(text)
    doms = before.get("domain") or []
    if not any(d.get("id") == domain for d in doms):
        raise ValueError(f"no [[domain]] with id {domain!r} in the config")
    doc = tomlkit.parse(text)
    expected: dict[str, list[str]] = {}
    for d in doc["domain"]:
        cur = [a for a in (d.get("manual") or []) if a != alias]
        if d.get("id") == domain:
            cur.append(alias)
        if cur:
            d["manual"] = cur
        elif "manual" in d:
            del d["manual"]
        expected[str(d.get("id"))] = cur
    out = tomlkit.dumps(doc)
    after = tomllib.loads(out)
    if _without_manual(after) != _without_manual(before):
        raise ValueError("refused: the config rewrite changed more than the manual aliases")
    got = {str(d.get("id")): list(d.get("manual") or []) for d in after.get("domain") or []}
    if got != expected:
        raise ValueError("refused: the manual aliases did not round-trip")
    return out


def _write_config(path: Path, text: str) -> Path:
    """Back up the current file to <name>.bak, then replace it atomically."""
    if path.resolve() == EXAMPLE_CONFIG.resolve():
        raise PermissionError(f"no user config yet: run `bin/{SLUG} init` first")
    tomllib.loads(text)
    if path.exists():
        path.with_suffix(".toml.bak").write_text(path.read_text())
    tmp = path.with_suffix(".toml.tmp")
    tmp.write_text(text)
    tmp.replace(path)
    return path


def save_domain_alias(domain: str, alias: str, path: Path | None = None) -> Path:
    path = path or CONFIG_FILE
    if path.resolve() == EXAMPLE_CONFIG.resolve():
        raise PermissionError(f"no user config yet: run `bin/{SLUG} init` first")
    return _write_config(path, set_domain_alias_text(path.read_text(), domain, alias))


def set_config_value_text(text: str, table: str, key: str, value: Any) -> str:
    """Set [table] key = value through tomlkit; refuse unless re-parsing shows only that key changed."""
    import tomlkit
    before = tomllib.loads(text)
    doc = tomlkit.parse(text)
    if table not in doc:
        doc[table] = tomlkit.table()
    doc[table][key] = value
    out = tomlkit.dumps(doc)
    after = tomllib.loads(out)
    strip = lambda cfg: {**cfg, table: {k: v for k, v in (cfg.get(table) or {}).items() if k != key}}  # noqa: E731
    if strip(after) != strip(before) or after.get(table, {}).get(key) != value:
        raise ValueError(f"refused: the config rewrite changed more than [{table}] {key}")
    return out


def save_config_value(table: str, key: str, value: Any, path: Path | None = None) -> Path:
    path = path or CONFIG_FILE
    return _write_config(path, set_config_value_text(path.read_text(), table, key, value))
