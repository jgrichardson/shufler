# Agent access (MCP)

`shufler mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio. Add it to Claude
Code or Codex and your agents can ask Shufler what is running, what is waiting on you, and whether a PR is green,
the same facts the 3D floor shows you.

It is a client of the running daemon. It reads the same HTTP endpoints the web app reads, sends the same
`Origin` header the web app and `shufler library` send, and keeps no state of its own. The daemon contract
(`CONTRACT.md`) is unchanged: anything the MCP server can do, the web app can already do.

## Set it up

Start the daemon (`shufler start`), then print ready-to-paste snippets:

```bash
shufler mcp --print-config
```

From a clone the command is `bin/shufler`; the snippets then point at the clone's `bin/shufler`, and in a
packaged install (Homebrew, `pipx`, `uv tool`) at the `shufler` on your `PATH`.

For Claude Code it prints a `claude mcp add` line:

```bash
claude mcp add shufler --scope user -- /path/to/shufler/bin/shufler mcp
```

For Codex it prints a block for `~/.codex/config.toml`:

```toml
[mcp_servers.shufler]
command = "/path/to/shufler/bin/shufler"
args = ["mcp"]
```

When `SHUFLER_PORT` or `SHUFLER_CONFIG` is set in your shell, the snippets pass it on. If the daemon is not
running, every tool returns an error that says so; start the daemon and ask again.

## Tools

### Read-only, always on

| Tool | Arguments | Returns |
|---|---|---|
| `status` | none | Counts (sessions by active, idle, stalled or closed; open questions; items waiting on you; work items by phase), one line per session (title, harness, state, note, open question, linked PRs, context use), failing sources, and which session is the caller when it can tell |
| `needs_you` | none | Everything waiting on you, most urgent first, each with a plain `why`: open agent questions with their options, PRs ready to merge, notes that ask for you, reporter replies, close-outs, and items whose ball is with you. Also the stuck items |
| `get_pr` | `pr` (`253` or `"#253"`) | Phase, stage, CI, failed run count, review bot verdict and whether it covers the head commit, GitHub's review decision, mergeable state, what blocks a merge (from the daemon's own merge planner), whose move it is, the ledger row and the owning session |
| `read_session` | `station` (id, ref or title), `turns` (1 to 50, default 10), `max_chars` (500 to 20,000, default 8,000) | The session's state, its open question and its recent conversation: user and assistant text (2,000 characters per turn at most) and tool calls as one-line summaries. Older turns are dropped first when the budget runs out, and `truncated` says so |
| `list_work_items` | `phase`, `kind`, `include_shipped` (all optional) | PRs and other work items (issues, plans, data fixes, docs, branches) with phase, CI, reviewer, whose move it is and the owning session; 100 at most |

Results are compact JSON. They carry only what the snapshot already carries, minus the account details: no
email address (not even the masked one), no token or quota figures beyond context use. `read_session` reads
message text through the same endpoint the Conversation panel uses; nothing else in the server touches message
text.

### Dispatch, off by default

With this in your config file, three more tools appear:

```toml
[mcp]
allow_dispatch = true
```

| Tool | Arguments | Does |
|---|---|---|
| `send_prompt` | `station`, `text` | Previews typing `text` into another session. Sends nothing |
| `answer_question` | `station`, `text` (an option label or free text) | Previews answering that session's open question. Refused when the session has none. Sends nothing |
| `confirm_dispatch` | `confirm_id` | Sends one previewed prompt or answer |

The flow mirrors the app's confirm panel. A preview calls the daemon's `/api/actions/preview`, which plans the
exact terminal commands, and returns them with the daemon's warnings (the session is mid-turn, its note says
done, newlines were collapsed) and a `confirm_id`. Only `confirm_dispatch` with that id calls `/api/actions`,
which plans again from fresh state and runs it. A `confirm_id` works once, expires after two minutes, and is
bound to the exact target and text that were previewed: the agent cannot change either between preview and
send.

The same rules as the app apply, checked in the MCP server and again in the daemon:

- **Never-do guard.** Text that contains a force push, `reset --hard`, worktree removal, a process kill, a chat
  post or an outbound send is refused.
- **Plain text only.** Control characters (escape sequences, C1 codes such as an 8-bit CSI, NUL) and the
  invisible bidirectional overrides are refused. At most 4,000 characters.
- **No talking to yourself.** A session cannot prompt or answer itself. The server works out which session
  launched it from the terminal's pane id in its environment (`CMUX_WORKSPACE_ID`, `ITERM_SESSION_ID`,
  `TMUX_PANE`), from the agent process among its parent processes, and from the session id when the harness
  exports one. When it cannot tell, the preview says so.
- **Draft check.** The daemon refuses to type over text already waiting in the target's input box.
- **Brakes.** At most five previews wait at once, and at most six prompts a minute go out through one MCP
  server.
- **Audit.** Every send is logged in `actions.jsonl` like any other action, with `"via": "mcp"` in its params.

## Threat model

Read this before turning dispatch on.

**What the read-only tools expose.** An agent with these tools can see what your other sessions are doing,
including their recent messages through `read_session`. That is no more than the agent could read from the
transcript files on your disk, but it is easier, and it puts text from one session into another session's
context.

**Prompt injection from one agent into another.** Text from another session (its messages, its question, its
note, a PR title, a ledger row) is data written by another agent or pulled from a repository, and it may contain
instructions. An agent that reads it might act on them. Every result that carries such text says so in a `note`,
but a note is advice to the model, not a control.

Dispatch turns that into a path for action: session A reads something hostile, then types a prompt into
session B, which runs with B's permissions in B's repository. The never-do guard blocks the most destructive
commands by pattern, but a prompt such as "delete the tests and push" is ordinary text and passes. Pattern
checks cannot tell a good instruction from a bad one.

**What stands in the way.**

1. Dispatch is off unless you turn it on in your config file.
2. Nothing is sent from a preview. Sending takes a second tool call, `confirm_dispatch`.
3. Claude Code asks before it runs an MCP tool you have not allowed; check your Codex approval settings for
   the same. Keep `confirm_dispatch` off every auto-allow list (in Claude Code that is
   `mcp__shufler__confirm_dispatch`), so a person sees the previewed text and approves each send. If you
   auto-allow it, an agent can prompt your other agents with no person in the loop.
4. A session cannot target itself, and the rate limit slows two agents that keep prompting each other. Neither
   stops a chain through a third session.

**What this does not protect against.** The daemon trusts any local program that sends the right `Origin`
header; that is how the web app and `shufler library` work. An agent with a shell can already call the daemon's
HTTP API with `curl`, or type into a pane with your terminal's own CLI, without this server. The dispatch gate
makes the safe path the easy one; it is not a sandbox. Run Shufler only on a machine where every local program
is one you trust, and never expose its port.

## Why not the MCP SDK

The server implements the stdio transport and the tool methods itself (`initialize`, `ping`, `tools/list`,
`tools/call`, one JSON-RPC message per line) in `daemon/shufler/mcp_server.py`. The official Python SDK would
add about twenty packages to the daemon's environment for a handful of methods, and its 2.0 release renamed or
removed much of the 1.x API. The server was checked end to end against the SDK's own stdio client (`mcp` 2.3).

## Future: a foreman agent

The roadmap has a "foreman": one agent that watches the whole floor and nudges sessions that are stuck or
waiting. These tools are its building blocks, but the foreman itself is not built. With dispatch off it could
only report; with dispatch on, every nudge still goes through `confirm_dispatch` and your approval.
