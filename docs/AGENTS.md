# Agent harnesses

Shufler draws one row per terminal pane that hosts an agent session. The agent in that pane is a **harness**:
Claude Code or OpenAI's Codex CLI today. A harness decides which running processes are sessions, where their
transcripts live and how to read them, what the input box looks like on screen, and how to answer the agent's
questions. The core daemon does not depend on any one harness: everything harness-specific lives in a small
adapter under `daemon/shufler/adapters/agent/`, and Claude Code and Codex rows mix freely on one floor.

| Harness | Id | Status | Transcripts | Questions it raises |
|---|---|---|---|---|
| [Claude Code](#claude-code) | `claude` | supported (the original) | `~/.claude*/projects/<cwd>/<session>.jsonl` | `AskUserQuestion` in the transcript |
| [Codex CLI](#codex-cli) | `codex` | supported | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` | approval prompts, read from the screen |

## Choosing harnesses

```toml
[agents]
enabled = "auto"                 # the default: Claude Code always, plus every other harness that is installed
# enabled = ["claude", "codex"]  # an explicit list
# enabled = ["codex"]            # Codex only
```

With `enabled` unset or `"auto"`, Claude Code is always on (so an existing config behaves exactly as before)
and Codex joins when `codex` is on your `PATH` or `~/.codex/sessions` exists. `SHUFLER_AGENTS=claude,codex`
overrides the setting for one run.

```bash
shufler setup --agents claude,codex   # write [agents] enabled (or --agents auto)
shufler status                        # shows the terminal, then the harnesses that run and what was found
```

`shufler setup` lists every registered harness with what it detected. The snapshot reports the enabled ones in
`capabilities.agents` and each row's harness in `station.harness` (`"claude"`, `"codex"`, or `null` for an
empty pane). The web shows a small `codex` tag on Codex rows and names the harness in the hover card.

## How each harness maps

| | Claude Code | Codex CLI |
|---|---|---|
| Process | `claude …` (not `-p` / `--print`, not `--chrome-native-host`) | `codex …`, or `node …/bin/codex` with its native child (one row, not two); not `codex exec`, `mcp-server`, `app-server`, `login`, … |
| Session id from argv | `--resume <id>`, `--session-id <id>` | `codex resume <id>` |
| Session id otherwise | the newest Claude transcript in the process cwd | the newest Codex rollout in the process cwd (`-C <dir>` counts as the cwd) |
| Transcript | one JSONL per session per account | one rollout JSONL per session; early builds wrote one `.json` |
| cwd, model | each record | `session_meta`, `turn_context` |
| Activity | last user / assistant record | last record of any kind |
| Tokens today, context | `usage` on assistant records; window from `settings.json` | `token_count` totals (deltas per day); window from the rollout |
| Quota | statusline usage cache per account | `rate_limits.primary` in the rollout |
| PR links | `pr-link` records | a `github.com/…/pull/N` URL in the output of a `gh pr create` call |
| Pending question | `AskUserQuestion` tool call without a result | the approval overlay on screen; a `request_user_input` call; an escalated command without output |
| Input box on screen | `❯` between two rules | `›` above the model · cwd status line |
| Answer an option | type its label, Return | press the key the overlay shows (`y`, `a`, `p`, Esc); any other text is Esc, then the text, Return |
| Library message | `/add-dir` for outside folders, then `@` mentions | one prompt with absolute paths (no `/add-dir`, no `@`) |

Matching a process to a row is the terminal's job and works the same for every harness (docs/TERMINALS.md):
the terminal's id in the process environment, then the tty, then the joined session, then a unique cwd. A
Claude process never takes a Codex transcript and the other way round, even in the same directory.

## Claude Code

```toml
[[agent.accounts]]
name = "personal"
label = "personal"
projects_dir = "~/.claude/projects"
claude_json = "~/.claude.json"
settings = "~/.claude/settings.json"
usage_cache = "~/.claude/usage-cache/personal.json"
```

One entry per Claude config directory you run sessions from; `daemon/config.example.toml` explains each key.
Skills, slash commands and the plugin cache are discovered from these directories too.

## Codex CLI

```toml
[codex]
# home = "~/.codex"     # default: $CODEX_HOME, else ~/.codex
# bin = "codex"
```

Nothing to set up when Codex uses its default home. `SHUFLER_CODEX_HOME` overrides `home` for one run.

**Transcripts.** Codex writes `sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl`, one
`{timestamp, type, payload}` record per line. Shufler reads `session_meta`, `turn_context`, `response_item`
(messages, tool calls and their outputs), `event_msg` (`task_started`, `task_complete`, `turn_aborted`,
`token_count`, approval and input requests when a build records them) and `compacted`; anything else is
skipped. Reads are incremental, a half-written last line waits for the next read, and a rollout larger than
64 MB is read from its tail. As for Claude Code, only metadata goes into the snapshot; message text is served
by the Conversation panel on request. Codex injects some user-role messages itself (`<environment_context>`,
AGENTS.md instructions); they are not counted or shown as prompts.

**Approvals.** Codex does not write its approval prompts to the rollout. When a Codex session is in the middle
of a turn and its rollout has been quiet for a few seconds, the daemon reads that pane's screen (the same
read-only call the dispatch path uses, at most six panes every five seconds) and parses the overlay:

```
  Would you like to run the following command?
  Reason: Fetches the schema over the network
  $ make migrate
› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `make` (p)
  3. No, and tell Codex what to do differently (esc)
```

The row turns red with the question, and "Your move" lists it. Answering an option presses exactly the key in
brackets, with no Return. Typed text that is not an option declines with Esc and then sends the text, which is
Codex's own "tell Codex what to do differently". This needs the terminal's `can_read_screen` and `can_send`.
When the screen cannot be read, an escalated command (`sandbox_permissions = "require_escalated"`) that has no
output yet is shown as a pending approval with Codex's default keys.

**Limits.**

- Codex's composer shows a dimmed placeholder ("Ask Codex to do anything", "Ask a follow-up question") that the
  plain-text screen cannot tell apart from typed text. Codex's known placeholders count as empty; any other text
  is treated as an unsent draft, so a send to that row is refused until the box is cleared.
- Plan-mode questions (`request_user_input`) are answered like Claude's: the option label is typed and sent.
- Skills and slash-command discovery read Claude Code's directories only; Codex rows get no skill buttons of
  their own.
- Codex has no per-session cost figure, so the telemetry cost stays empty.

## Writing a harness adapter

A harness adapter is one Python module plus one line in the registry. Aider, Gemini CLI, OpenCode or Cursor's
agent would each be a good first contribution.

### The contract

`daemon/shufler/adapters/agent/__init__.py` defines `AgentAdapter`. The class:

| member | what it does |
|---|---|
| `name`, `harness`, `label` | adapter name, the short id in `[agents] enabled` and `station.harness`, and the display name |
| `CONFIG_DEFAULTS` | the keys your `[<harness>]` config section takes, with defaults |
| `detect(cfg)` (classmethod) | `Detection(installed, running, detail)` for setup and auto mode; quick and read-only |
| `from_config(cfg)` (classmethod) | build the adapter from the whole parsed config |
| `match_process(tokens)` | a `ps` command line split on spaces → `{session_id, name}` for an interactive session, else `None`; may add `cwd_arg` (a working-directory flag) and `launcher` (an outer process whose child on the same tty is the real session) |
| `transcript_index()` | an object with `scan(wanted, now=, prefixes=)` → `{session_id: summary}` and `sessions[sid].path` |
| `input_draft(screen)` | unsent text in the input box, `""` when empty, `None` when no input box is on screen |
| `echo_line(screen, text)` | the screen line where a sent prompt shows up, or `None` |
| `answer_keys(question, text)` | `[("text", "y")]`, `[("key", "Escape")]`, ... to answer with keys, or `None` to type the text and press Return |
| `accounts()` | `{account: {label, email_masked, context_window, quota}}` for telemetry |
| `skill_index()` | a `skills.SkillIndex` (an empty one is fine) |
| `session_history(since)` | per transcript changed since `since`: `{session_id, account, started_at, ended_at, cwd, pr_links}` for the history backfill |
| `probe_screen`, `parse_screen(screen)` | optional: set `probe_screen = True` and parse the screen into a pending question when the agent's prompts are not in its transcript |

A **summary** has the keys of `transcripts.SessionStats.summary()` (`session_id`, `account`, `cwd`, `last_at`,
`last_tool`, `tool_calls`, `turns`, `pending_question`, `last_assistant_preview`, `pr_numbers`, `pr_link_ts`,
`tokens_today`, `tokens_in_today`, `tokens_out_today`, `context_tokens`, `model`, `session_started_at`,
`compactions`, `subagents`, `recent_skills`, ...) plus `harness`. Optional: `context_window` and `quota` when
the transcript reports them per session, and `in_turn` (mid-turn, which is when a screen probe runs).
A `pending_question` is `{question, header, options: [{label, description, recommended, key?}], multi_select,
more, kind?}`; `kind = "approval"` with a `key` per option makes the answer a key press.

### Skeleton

```python
# daemon/shufler/adapters/agent/aider.py
from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..terminal.base import Detection


def match_process(tokens: list[str]) -> dict | None:
    if not tokens or os.path.basename(tokens[0]) != "aider" or "--message" in tokens:
        return None
    return {"session_id": None, "name": None}


class AiderAdapter:
    name = harness = "aider"
    label = "Aider"
    CONFIG_DEFAULTS = {"history": ".aider.chat.history.md"}

    def __init__(self, history: str = ".aider.chat.history.md"):
        self.history = history

    @classmethod
    def from_config(cls, cfg: dict) -> "AiderAdapter":
        return cls(((cfg or {}).get("aider") or {}).get("history") or ".aider.chat.history.md")

    @classmethod
    def detect(cls, cfg: dict | None = None) -> Detection:
        b = shutil.which("aider")
        return Detection(bool(b), False, f"bin {b}" if b else "aider not on PATH")

    match_process = staticmethod(match_process)

    def transcript_index(self): ...          # scan() → {session_id: summary with "harness": "aider"}
    def input_draft(self, screen): ...       # Aider's `>` prompt line
    def echo_line(self, screen, text): ...
    def answer_keys(self, question, text): return None
    def accounts(self): return {}
    def skill_index(self):
        from .skills import SkillIndex
        return SkillIndex([])
    def session_history(self, since): return []
```

Register it with one line in `REGISTRY` in `adapters/agent/__init__.py`:

```python
REGISTRY = {"claude": ClaudeCodeAdapter, "codex": CodexAdapter, "aider": AiderAdapter}
```

or, from a separate package, with an entry point (no change to Shufler itself):

```toml
[project.entry-points."shufler.agents"]
aider = "my_package.aider:AiderAdapter"
```

Then add the id to `HARNESS_FORMATS` in `daemon/shufler/library.py` (and a composer in `HARNESSES` when the
agent wants context in a form other than plain paths), and to `harnessLabel` in `web/src/lib/library.ts` so
the row tag reads well.

### Testing

Tests never read a real home directory or run a real agent. Write small synthetic transcripts by hand from the
schema (made-up paths under `/Users/demo`, made-up ids) and feed them to your index; monkeypatch
`shufler.runner.run` for anything that calls a command. `daemon/tests/test_codex.py` has worked examples:
rollout parsing, partial lines, tail reads, process matching, the snapshot's `harness` field, screen parsing,
answering with keys and library composition. If you try a live session by hand, use a throwaway tmux server
(`tmux -L scratch`) and a test daemon on its own port with `SHUFLER_CONFIG` pointing at a scratch config.

### Checklist

- [ ] `name`, `harness`, `label`, `CONFIG_DEFAULTS`, `detect`, `from_config`, `match_process`
- [ ] headless and helper processes of the agent do not match
- [ ] summaries carry every key of the Claude summary plus `harness`, and no message text beyond the preview
- [ ] unknown record types skipped, a partial last line kept for the next read, big files read from the tail
- [ ] `input_draft` returns `None` when it cannot see the input box, so the send goes ahead with a note
- [ ] one line in `REGISTRY` (or an entry point), a `[<harness>]` section with comments in `config.example.toml`
- [ ] unit tests with synthetic fixtures; `cd daemon && uv run pytest -q` is green
- [ ] a section in this file: mapping, setup, limits
