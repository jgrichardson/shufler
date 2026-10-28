# Shufler protocol

Shufler is a 3D control room for developers who run many AI coding agent sessions at once. It has two
halves that talk over a small local protocol:

- **daemon** (`daemon/`, Python, FastAPI): reads your terminal, agent transcripts, GitHub and a few optional
  sources, derives one JSON **snapshot**, serves it over HTTP and WebSocket, and runs guarded **actions**.
- **web** (`web/`, React + three.js): renders the snapshot and sends actions back.

This file specifies that protocol and the configuration that shapes it. The code is the source of truth:
`daemon/shufler/snapshot.py` and `world.py` build the snapshot, `actions.py` plans actions, `app.py` serves
everything, `config.py` reads `config.toml` and builds `capabilities`. `web/src/types.ts` holds the TypeScript
types of the same shapes. Terminal adapters are covered in `docs/TERMINALS.md`, agent harnesses (Claude Code,
Codex) in `docs/AGENTS.md`.

Contents: [1 Transport](#1-transport) · [2 Snapshot](#2-snapshot) · [3 Derivations](#3-derivations) ·
[4 Actions](#4-actions) · [5 Configuration](#5-configuration) · [6 Other endpoints](#6-other-endpoints) ·
[7 Safety model](#7-safety-model)

## 1. Transport

The daemon binds `127.0.0.1` on port `4700` (`[app] port`, or `SHUFLER_PORT`). It also serves the built web app
(`web/dist`) at `/`; when the build is missing, `/` answers 503 with a hint.

**Host and origin rules**

| Rule | Applies to |
|---|---|
| `Host` must be `127.0.0.1` or `localhost` (DNS-rebinding guard; any other host is rejected) | every request |
| `Origin` must be `http://127.0.0.1:<port>` or `http://localhost:<port>` (plus `http://127.0.0.1:5173` and `http://localhost:5173` when `SHUFLER_DEV=1`); a missing `Origin` is refused with 403 | `POST /api/actions`, `POST /api/terminals`, `DELETE /api/terminals/{id}`, `POST /api/config/skills`, every `POST` and `DELETE` under `/api/library`, and the `/term/{id}` WebSocket |
| `Origin` is optional, but a foreign one is refused (403, or close code 1008 on a WebSocket) | `/ws`, `GET /api/library`, `GET /api/library/browse` |
| no origin check | all other `GET` endpoints and the action preview endpoints |

Unknown `/api/...` paths answer 404 `{"error": "no such endpoint: /api/..."}`. Request and response bodies are
JSON unless stated.

### WebSocket `/ws`

Server to client:

| Message | When |
|---|---|
| the full snapshot (`{"type": "snapshot", ...}`, section 2) | on connect, whenever the derived snapshot changed (checked every 0.5 s), and as a heartbeat at least every 15 s |
| `{"type": "pong", "ts": <epoch seconds>}` | reply to a client ping |
| `{"type": "subscribed", "station_id": <id or null>}` | reply to `subscribe`; `null` when the station is unknown |
| `{"type": "turn", "station_id": <id>, "turn": Turn}` | a new conversation turn in the subscribed station's transcript |

Client to server:

| Message | Effect |
|---|---|
| `ping` (bare text) or `{"type": "ping"}` | answered with `pong` |
| `{"type": "subscribe", "station_id": <id or ref>}` | stream new turns of that station's session. One subscription per socket; a new one replaces the old. Only turns written after subscribing are pushed (no backlog: fetch history over REST). |
| `{"type": "unsubscribe"}` | stop the turn stream |

A `Turn` is `{ts, role: "user"|"assistant", text, tools: [{name, summary, result?}]}`. Message text only ever
travels through turn messages and the conversation endpoints, never in the snapshot (except the short
`last_assistant_preview` and a pending question, section 2).

`GET /ws` without an upgrade answers 426.

### Core REST endpoints

| Endpoint | Response |
|---|---|
| `GET /api/snapshot` | the current snapshot |
| `GET /api/your_move` | `{your_move: [...], your_move_count: n}` |
| `GET /api/health` | `{ok: true, sources: {...}, clients: n}` |
| `GET /api/config` | `{product, canned_prompts, postmerge_prompt, domains, presets, skills, pipeline_stages, board_stages, capabilities}` (section 5) |
| `POST /api/actions` | run an action (section 4) |
| `GET` or `POST /api/actions/preview` | the exact command an action would run (section 4) |

The remaining endpoints (conversation, terminals, skills config, library, history) are in section 6.

## 2. Snapshot

One JSON object. Timestamps named `ts`, `since`, `last_at`, `phase_since` are epoch seconds (floats); fields
named `*_at` that come from GitHub or records are ISO 8601 strings. Absent data is `null`, never guessed.

```jsonc
{
  "type": "snapshot",
  "ts": 1790000000.0,
  "halls": [Hall],                    // terminal groups, with the ungrouped bucket last
  "groups": [Group],                  // terminal groups in sidebar order (for ordering rows)
  "stations": [Station],              // one per terminal row that hosts (or hosted) a session
  "utility_stations": [Station],      // tool rows: reachable by actions, not drawn as work rows
  "workpieces": [Workpiece],          // PRs and other work items
  "shipped": [Shipped],               // PRs merged since Monday 00:00 local time
  "domains": [Domain],                // lanes that currently have a station or a live item
  "pipeline_stages": [Phase],         // the work phases (districts), in order
  "your_move": [YourMove],            // what needs the owner, most severe first
  "your_move_count": 3,
  "events": [Event],                  // last 200 transitions, oldest first
  "sources": {"gh": {"ok": true, "age": 41.2}, "ledgers": {"ok": false, "age": null, "error": "..."}},
  "capabilities": Capabilities,       // section 5
  "skills": [Skill],
  "library": {"items": 4, "owed": {"<station id>": ["lib_0123abcd"]}},
  "stale_ledger_rows": [{"ledger_path": "...", "area": "billing", "branch": "feat/x", "title": "..."}],
  "focused_station_id": "<id>|null"   // the terminal's focused row (drives "Follow")
}
```

### Source health

`sources` has one entry per enabled source: `{ok, age, error?}` (`age` = seconds since the last successful
read; `error` is at most 300 characters). A failing source never stops the others and keeps its last good
data. Keys: the terminal adapter's name (`cmux`, `iterm2` or `tmux`), `groups`, `notes`, `intake`, `ledgers`,
`processes`, `transcripts`, `screens`, `skills`, `accounts`, `gh`, `gh_merged`, `gh_detail`, `ledger_branches`,
`deploys`, `reviewer_watch`, `board`. A source that is off in the config is absent.

| Source | Reads | Refresh |
|---|---|---|
| terminal | workspace rows from the terminal adapter | 2-3 s (adapter `poll_interval`) |
| `groups` | terminal groups | 10 s |
| `notes` | session note files (`[notes] dir`) | 2 s |
| `intake` | work-item records (`[intake] dir`) | 10 s |
| `ledgers` | area ledger files (`[ledgers] dir`) | 30 s |
| `processes` | running agent processes (`ps`, `lsof`) | 10 s |
| `transcripts` | agent session transcripts of every enabled harness (new bytes only) | 3 s |
| `screens` | the screen of a mid-turn, quiet session of a harness that asks on screen (Codex approvals); only with `processes` and a terminal that can read screens | 5 s |
| `skills` | discovered skills and commands | 60 s |
| `accounts` | per-account label, masked email, quota cache (Codex: one `codex` account) | 10 s |
| `gh` / `gh_merged` / `gh_detail` | open PRs / PRs merged since Monday / mergeability and head commit time of each open PR | 60 s / 60 s / 90 s |
| `ledger_branches` | GitHub status of branches that ledger rows name | 30 s |
| `deploys` | deploy workflow runs (`[scm] deploy_workflow`) | 120 s |
| `reviewer_watch` | reviewer status command (`[reviewer] status_command`) | 30 s |
| `board` | board card stages | 300 s |

The last open and merged PR answers are cached under the cache directory, so a restart shows data at once.

### Hall and Group

```jsonc
Hall  { "id": "AUTH", "name": "AUTH", "color": "#hex|null", "station_ids": ["<id>"] }
Group { "name": "AUTH", "pinned": false, "member_count": 3, "index": 0 }
```

A hall per terminal group (anchor workspaces excluded) in the terminal's group order, plus `UNGROUPED`
(`id` and `name`, `color: null`) for rows in no group. `groups` lists the same groups plus the ungrouped
pseudo-group (`name: ""`), ranked by the topmost row of each in the terminal's order.

### Station

One terminal row, joined to its agent session.

| Field | Type | Meaning |
|---|---|---|
| `id`, `ref` | string | the terminal's stable id and the handle actions target (often equal) |
| `title` | string | display title, with any trailing ` · <8 hex>` session suffix removed |
| `hall_id` | string | the hall (`UNGROUPED` when in no group); `group` is the same name or `null` |
| `color` | string or null | the terminal's row colour, when it has one |
| `cwd` | string or null | working directory |
| `ports` | int[] | listening ports, when the terminal reports them |
| `session_id` | string or null | the joined agent session |
| `harness` | string or null | the agent harness in this row: `claude` or `codex` (`docs/AGENTS.md`); the running process's harness, else the joined transcript's; null when neither is known |
| `session_id_source` | string | how it was joined: `title`, `note`, `cwd_match`, `process_name`, `process` or `none` |
| `account` | string or null | the `[[agent.accounts]]` name whose transcript directory holds the session; `codex` for Codex sessions |
| `note` | object or null | `{state, text, ts}` session note (section 3.7); `ts` is null for notes parsed from a terminal description |
| `activity` | object | `{last_at, last_tool, subagents, idle_seconds, status, tool_calls}`; `status` is `active`, `idle`, `stalled` or `closed` |
| `claude` | object or null | `{running, pid, since, sessions: [id], count}` for agent processes in this row, of any harness (the name predates Codex support); `null` when the process source is off |
| `tokens_today` | int | input + output tokens of the session today |
| `telemetry` | object | statusline-style figures, below |
| `context_pct`, `quota_pct` | number or null | copies of `telemetry.context_pct` and `telemetry.rate_limit.used_pct` |
| `pending_question` | object or null | `{question, header, options: [{label, description, recommended, key?}], multi_select, more, kind?, source?}`: the agent's open multiple-choice question. `kind` is `approval` for a Codex approval prompt (each option then has the `key` that answers it), `input` for a Codex plan-mode question; `source` is `screen` or `transcript` for Codex |
| `last_assistant_preview` | string or null | newest main-thread assistant text, whitespace collapsed, 120 characters at most |
| `last_prompt_at` | string or null | when the terminal last saw a submitted prompt |
| `selected` | bool | the terminal's focused row |
| `pr_numbers` | int[] | PRs linked to this station (from `links`) |
| `issue_slugs` | string[] | intake records of this session (not closed) |
| `issue_events` | object | `{<slug>: [{type, ts}]}`, newest first |
| `links` | object[] | `{id, pr, source, since}`: workpieces linked to this station, strongest first (3.5) |
| `workpiece_ids` | string[] | the ids in `links` |
| `focus_workpiece_id` | string or null | the item this station is working on now (3.5) |
| `domain`, `domain_source`, `domain_reason` | string | lane and why (3.3) |
| `empty` | bool | an untitled row with no session activity for 24 h |
| `ledger_area` | string or null | area of the session's agent process (3.6) |
| `anchor_for` | string or null | set when the row is a group's anchor workspace that runs a live session |
| `utility` | bool | row is in `utility_stations` |
| `sidebar_index`, `row_order` | int | 0-based position in the terminal's order across all rows (rows follow it) |
| `skill_names` | string[] | skills available to this station: user, plugin and configured skills plus those of its repo |

Group anchor workspaces (a terminal feature) are not rows: they are dropped unless a session is joined to them.
Utility stations (`[terminal] utility` titles, matched case-insensitively) hold the base fields (through
`telemetry`, plus `claude`, `ledger_area`, `anchor_for` and `utility`) with `domain: null`; they get no links,
focus, `group`, `sidebar_index`, `row_order` or `skill_names`.

`telemetry`: `{model, account_label, account_email_masked, context_pct, context_tokens, context_window,
cost_usd_session, tokens_in_today, tokens_out_today, rate_limit: {remaining_pct, used_pct, resets_at,
week_used_pct, as_of} | null, uptime_s, session_started_at, transcript_size_bytes, turns, compactions}`. Every
field is null when its source does not say. For Codex rows `context_window` and `rate_limit` come from the
session's rollout (`token_count`), and `cost_usd_session` is null.

### Workpiece

A PR or another unit of work. Ids are stable: `pr:<n>`, `issue:<slug>`, `fix:<slug>`, `plan:<slug>`,
`docs:<slug>`, `branch:<name>`; the daemon guarantees one workpiece per id.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | as above |
| `pr` | int or null | null for non-PR items |
| `kind` | enum | `pr`, `issue`, `data_fix`, `plan`, `docs`, `branch` |
| `title`, `label` | string | `label` is the title, else `#<pr>`, else `Untitled work` |
| `url`, `branch` | string or null | PR url and head branch |
| `draft` | bool | |
| `stage` | enum | `intake`, `build`, `reviewer`, `ci`, `preview`, `ready`, `merged`, `deployed` (3.1) |
| `ci` | enum | `pending`, `success`, `failure`, `none` |
| `reviewer` | enum | `approved`, `changes_requested`, `pending`, `none`, `off` (3.2) |
| `reviewer_at_head` | bool | the reviewer bot's latest review is an approval newer than the head commit |
| `reviewer_loop` | object or null | `{round, state}` from the reviewer status command |
| `review_decision` | enum or null | GitHub's `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` |
| `mergeable` | enum or null | `MERGEABLE`, `CONFLICTING`, `UNKNOWN`; null for merged PRs and non-PR items |
| `merge_state` | string or null | GitHub's merge state status (`CLEAN`, `BLOCKED`, ...); `MERGED` once merged |
| `closeout_owed` | bool | merged, and its intake record is not closed |
| `postmerge_owed` | bool | deployed, and `closeout_owed` or its ledger row state is `post-merge` |
| `labels` | string[] | PR labels |
| `failed_run_ids` | int[] | GitHub Actions run ids behind failing checks |
| `station_id`, `station_ids` | string, string[] | owning station (strongest link) and all linked stations |
| `issue_slug` | string or null | linked intake record |
| `board_stage` | string or null | the linked board card's stage |
| `ledger` | object or null | `{area, state, ball, next}` of the area-ledger row for this item |
| `merged_at`, `deployed_at`, `updated_at` | string or null | ISO times |
| `shipped_via` | int or null | parent PR whose deploy a stacked PR inherited |
| `domain`, `domain_source`, `domain_reason` | string | lane and why (3.3) |
| `phase`, `phase_since` | enum, number | work phase and when the item entered it (3.4) |
| `parked` | bool | on hold (3.4) |
| `ball` | object | `{who, name}` whose move it is (3.8) |
| `stuck` | bool | (3.8) |
| `size` | `S`, `M`, `L` | additions + deletions: under 150, under 800, else; `M` when unknown and for non-PR items |

`phase_since` is remembered per id in the cache directory, so it survives restarts. A client may debounce
`phase` before animating; the daemon always reports the current value.

### Shipped

`{pr, title, merged_at, deployed, domain}` for each PR merged since Monday 00:00 local time, newest first. A
stacked PR whose parent closed unmerged is omitted.

### Domain

`{id, label, code, color, lane, station_ids, workpiece_ids, counts: {live, owner, parked}}`. Only domains with a
station or a live (not `shipped`) item are listed, in configured order, with the fallback domain last; `lane` is
the index in this list. `counts.live` excludes parked items; `counts.owner` counts live items whose ball is
`owner`. The `command` domain (3.3) is not listed.

### Phase (`pipeline_stages`)

`{id, label, color, description}`, from `[pipeline] stages`. The default order, left to right: `brainstorm`,
`plan`, `build`, `qa`, `review`, `merge`, `deploy`. Workpieces use these ids plus `shipped`, which is not a
district.

### YourMove

What needs the owner's attention, most severe first, oldest first within a severity.

```jsonc
{ "id": "merge:253", "kind": "merge", "station_id": "<id>|null", "pr": 253, "prs": [253],
  "text": "Merge #253", "since": 1790000000.0, "severity": 3,
  "also": ["note"], "also_ids": ["note:<station>"] }
```

| kind | severity | one row when | id | text |
|---|---|---|---|---|
| `question` | 3 | a station has a `pending_question` | `question:<station>` | the question |
| `merge` | 3 | a PR is in the `merge` phase | `merge:<pr>` | `Merge #<pr>` |
| `reply` | 2 | an intake record's newest event type is in `[intake] reply_events` and the record is not closed | `reply:<slug>:<event ts>` | `Reporter replied: <title>` for `user_replied`, else `Ready for you: <title>` |
| `note` | 2 | a station's note state is `me` | `note:<station>` | the note text; `prs` lists PR numbers found in it |
| `closeout` | 1 | a shipped PR has `closeout_owed` | `closeout:<pr>` | `Close out #<pr> with the reporter` |

Stations with no running agent (`activity.status == "closed"`) add no `question` or `note` rows. Rows are
folded to one per PR: the most severe row stays, and the kinds and ids of the folded rows go in `also` and
`also_ids`. `reply` and `closeout` rows can be acknowledged (`ack`, section 4); the ack lasts until the daemon
restarts.

### Event

The last 200 transitions seen by diffing consecutive snapshots (in memory; the first snapshot after start, and
any snapshot while sources are still loading, only sets the baseline).

`{ts, kind, pr, workpiece_id, from, to, station_id}` with `kind`:

| kind | `from` / `to` |
|---|---|
| `phase` | previous and new phase |
| `ball` | previous and new ball (`<who>` or `<who>:<name>`) |
| `merge` | previous stage and `merged` |
| `deploy` | `merged` and `deployed` |
| `note` | previous and new note state; also carries `text` |

### Skill

Discovered skills merged with `[skills]` config.

`{name, slash, description, scope, args_hint, source_path, aliases?, exposed, pinned, target, args_template,
confirm, placement}`. `scope` is `user`, `plugin`, `project` or `configured` (named in config but not found on
disk, such as a built-in command). `placement` is `station`, `pr`, `global`, `question` or `none` (default
`station`): where a pinned skill's button shows. A plugin skill also answers to its bare name when that name is
unique. Discovery roots are in section 5.

## 3. Derivations

### 3.1 Stage

First match wins:

1. merged and deployed: `deployed`
2. merged: `merged`
3. `ready` (below)
4. a label containing `preview`, or the owner's note state is `staging`: `preview`
5. CI `pending` or `failure`: `ci`
6. reviewer `pending` or `changes_requested` (or `approved` but not at head), and not draft: `reviewer`
7. draft: `build`
8. otherwise `intake`

`ready` needs CI `success`, not draft, and either reviewer `off` or reviewer `approved` with
`reviewer_at_head`. CI is `failure` when any check concludes `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE`,
`ACTION_REQUIRED` or `ERROR`; `pending` when any check is not completed; `success` otherwise; `none` with no
checks. A merged PR is `deployed` once its merge commit is an ancestor of (or identical to) the head of the
latest successful run of the deploy workflow on the deploy branch. A stacked PR (base is not the deploy branch)
inherits the deploy state of the PR whose head is its base, following the chain; if that parent closed
unmerged the stacked PR is dropped.

### 3.2 Reviewer bot

The optional reviewer bot is configured in `[reviewer]`. `reviewer` is:

- `off`: no reviewer is configured and the PR is open. The reviewer gate is skipped: `ready` needs only CI
  success and not draft, and `merge` does not ask for an approval.
- `approved`, `changes_requested`, `pending`: the verdict of the bot's latest review (login matched by
  `[reviewer] login_regex`); with no review yet, the status command's entry for the PR (`approved` is
  `approved`, a status starting with `changes` is `changes_requested`, anything else is `pending`).
- `none`: a reviewer is configured but has not reviewed, or the item is merged or not a PR.

### 3.3 Domain

A domain is a lane. Matching is on lower-case text split at `_ - · / ( ) :` and whitespace, trying the whole
text, each token, and adjacent token pairs joined by `_` or `-`, against a domain's `id` and `aliases`.

Workpiece, first hit:

1. a manual alias (`manual` list of a `[[domain]]`) matching the PR title scope or the branch: `manual`
2. the intake record's `domain`: `issue`
3. the ledger area of its row: `ledger`
4. the PR title scope `type(scope): ...`: `scope`
5. the branch: `branch`
6. the owning station's domain, unless that is the fallback: `station`
7. the owning station's terminal group name: `group`
8. the fallback domain: `fallback`

Station, first hit: a manual alias matching the title (`manual`); the title (`title`); the domain most of its
linked items sit in, ties going to the earlier lane (`items`); `command` when the title is listed in
`[terminal] command_titles` (`command`); else the fallback (`fallback`). `domain_reason` is a human sentence for
the choice. The fallback domain (`[world] fallback_domain`, default `unassigned`) is always the last lane, and
`command` (`[world] command_domain`) is the lane id of control-room stations.

### 3.4 Phase

Non-PR items sit in `brainstorm` or `plan`. They are `plan` when their text mentions a plan or brainstorm
document, or the owning session recently ran a planning skill; `brainstorm` when it matches
`brainstorm|ideat|explor`; otherwise `plan`.

PR items, first hit:

1. deployed: `shipped`
2. merged: `deploy`
3. ledger row state is `review`: `review`
4. stage `ready` and not `CONFLICTING`: `merge`
5. a `preview` label, the owner's note state `staging`, or a ledger state, next, ball or topic matching
   `\bqa\b|\btesters?\b`: `qa`
6. not draft and (reviewer is neither `none` nor `off`, or `review_decision` is `APPROVED` or
   `CHANGES_REQUESTED`, or CI is `pending` or `failure`): `review`
7. zero additions and deletions (a tracking PR): `plan`
8. otherwise `build`

`parked` is true when the ledger row state contains `on-hold`, `on hold`, `parked` or `sidelined`, or the
owning station's terminal group is named `ON_HOLD`.

PR `kind`: `docs` when the title type or scope is `docs`; `data_fix` when the branch matches `[world]
fix_pattern`; else `pr`. Non-PR items: records without a PR are `issue`; ledger rows without a PR are `data_fix`
(branch or topic matches `fix_pattern`), `plan` (state matches `brainstorm|plan|design|decide|scope`), `docs`
(topic mentions docs) or `branch`.

### 3.5 Links and focus

A station links to a workpiece through, strongest first: `ledger` (the row's worktree basename equals the
station's cwd basename, its Session cell holds an 8-hex session prefix, or it contains `[ledgers]
session_marker` and the station runs that area, falling back to a station whose title maps to the area), `issue` (the record's session is the station's), `pr-link`
(the transcript records a PR link), `cmux` (the terminal row's description mentions `#<pr>`; the name is
historical and applies to any terminal), `worktree` (the station's cwd basename equals the item's branch). The
workpiece's `station_id` is its strongest link. `focus_workpiece_id` is the non-shipped item whose branch
matches the station's worktree directory, else the newest open PR found in its transcript.

### 3.6 Ledger rows

An area ledger is `<dir>/<area>/ledger.md` with an `## Open` markdown table whose header starts with `Branch`:
columns `Branch | PR | Topic | State | Ball | Next | Worktree | Session`. `PR` cells are scanned for `#<n>`;
`—` and `-` read as empty. A row joins its PR (by number, or because its branch is a known PR's head) and
becomes that PR's `ledger`. A row keyed by a branch that has merged or closed outside the current window is
dropped; a row whose branch has no PR, no remote branch and no worktree is dropped and listed in
`stale_ledger_rows`. A station's `ledger_area` is the value of the `[ledgers] area_env` variable (default
`LEDGER_AREA`) in its agent process's environment.

### 3.7 Session notes and the session join

A note is `{state, text, ts}` with `state` one of `working`, `me`, `waiting`, `staging`, `merged`, `done`. Notes
come from `<[notes] dir>/<session id>.json` files (`{session, state, text, ts, cwd, ws_ref}`), or from the
terminal row's description when it reads `● <state> · <text>`. A note file written for a row reference only
counts while its `cwd` equals that row's cwd. Notes are written by tools you configure (see the
`[[commands]]` examples); Shufler itself never writes them except through such a command.

A station is joined to a session by, in order: a unique session-id prefix in the title suffix (` · <8 hex>`);
the newest note for that row; a cwd that exactly one row has and exactly one recent session (written in the last
24 h) uses. A joined session with no live transcript falls back to the newest unclaimed transcript in the same
cwd written in the last 10 minutes. Running agent processes (`claude` in `ps`, excluding headless `-p` runs;
interactive `codex`, excluding `codex exec` and the other non-interactive subcommands; each tagged with its
harness) are matched to rows by the terminal id in the process environment (`CMUX_WORKSPACE_ID`, `ITERM_SESSION_ID`,
`TMUX_PANE`), else by tty when exactly one row owns it, else by session id, else by a cwd belonging to one row.
A process on a tty that none of the terminal's rows owns is ignored. A process with no session id in its
arguments takes the newest unclaimed transcript of its own harness in its cwd written in the last hour (a Claude
process never takes a Codex rollout, and the other way round). A process refines the join (`--name` matching the
row title, or the newest live process's session); a join to a transcript of a harness that no longer runs in the
row is dropped. With the process source on and no process in a
row, `activity.status` is `closed`.

`activity.status`: `stalled` when the note state is `working` and the session has been idle more than 900 s;
`active` when idle at most 120 s; else `idle`.

### 3.8 Ball and stuck

`ball` is `{who, name}`. `who` is `owner` (the person running Shufler), `claude` (the agent), `reviewer`, `ci`,
`person` (`name` set), `testers`, `closeout`, or `none`. First hit:

1. phase `deploy`: `none`
2. phase `merge`: `owner`
3. the owning station has a pending question and is not closed: `owner`
4. the PR appears in a `your_move` row other than `closeout`: `owner`
5. `closeout_owed`: `closeout`
6. the ledger row's Ball cell names the owner or a person: `owner` or `person`. A Ball cell is `owner` when its first
   word is in `[app] owner_aliases` (or it starts with an alias of three or more characters); `person` when it
   starts with a capital letter (`name` is that word). Ball cells starting with `reviewer`, `review bot`, `ci`,
   `claude`, `agent` or the session marker name the other parties but do not set the ball by themselves.
7. phase `qa`: `testers`
8. phase `review` and CI `pending`: `ci`
9. phase `review`, reviewer `pending` or `approved`, and not at head: `reviewer`
10. the owning station's note is `working` and it is active: `claude`
11. `none`

`stuck` is true when the ball is neither `owner` nor `none`, the phase is not `brainstorm`, `plan` or
`shipped`, and the item has sat in its phase more than 24 h (72 h in `build`); or when the owning station is
`stalled`.

## 4. Actions

An action is a named, parameterised operation that runs one or more commands. Preview and execution share one
planner, so the confirm panel shows exactly what will run.

**Preview**: `POST /api/actions/preview` with `{action, params}` (or `GET /api/actions/preview?action=...&<param>=...`)
returns `{command, warnings, facts, url, confirm, text}`. `command` is the exact command lines (argv joined with
shell quoting, one step per line); `warnings` are strings the UI must show; `facts` hold extra detail;
`confirm` is the level below. A refused plan answers 400 `{command: null, warnings: [], error}`.

**Execute**: `POST /api/actions` with `{action, params}` (parameters may also sit at the top level of the body).
The result is `{ok, output, error, command, duration_s, ...}`; the HTTP status is 200 when `ok`, 422 when not,
403 for a bad origin, 400 for a malformed body. Optional extras: `url` (an open-in-browser action), `landed` and
`echo` (a prompt reached the session), `draft` (refusal: unsent text in the session's input box). Output is
stdout and stderr joined and trimmed to 20,000 characters. Every execution is appended to the actions log
(`actions.jsonl`, `[app] actions_log`) with `ts`, `action`, `params` and `result`.

**Confirm levels**: `none` (run directly), `tap` (the UI shows the confirm panel with the exact command),
`typed` (the panel also requires typing `facts.requires_typed_confirmation`; execution checks it against
`params.typed_confirmation`). The daemon enforces typed confirmation itself; a client cannot skip it.

**Never-do guard.** Every step and every text sent to a session is checked against a deny list and refused
(`refused by the never-do guard: <label>`): `git reset --hard`, force pushes, `worktree remove` or `prune`,
`kill`/`pkill`/`killall`, chat or Slack posting commands, and outbound email sends. Commands run without the
daemon's own terminal identity variables (`CMUX_*`, `ITERM_SESSION_ID`, `TMUX_PANE`); the target is always
explicit.

**Timeouts**: 30 s per step, or the command's own `timeout`.

### Action list

| action | params | confirm | what it runs |
|---|---|---|---|
| `focus` | `station_id` | none | the terminal's focus command for that row |
| `dispatch` | `station_id`, `text` (1 to 4,000 chars) | tap | type `text` into the session's pane, press Return, read the screen back |
| `answer_question` | `station_id`, `text` | tap | as `dispatch`; warns when no question is recorded. For a question with `kind: approval` (Codex) the matching option's `key` is pressed instead (`y`, `a`, `p` typed without Return, or Esc); other text presses Esc and then sends the text with Return. The plan then has `facts.keystrokes` and skips the empty-input check |
| `postmerge` | `pr` (merged) | tap | `dispatch` of `[prompts] postmerge` (with `{pr}`) to the PR's station |
| `new_item` | `text` (1 to 2,000) | tap | `dispatch` of `[intake] prompt` (with `{text}`) to the station titled `[intake] workspace` |
| `run_skill` | `skill`, `station_id` (or the skill's `target`), `args?`, `context?` | the skill's `confirm` (default tap) | `dispatch` of `/<skill> <args>`; `args` default to the skill's `args_template`; tokens `{pr} {branch} {station} {link} {link_or_text} {text} {question}` are filled from `context`, params and the station |
| `library_send` | `station_id`, `item_ids`, `note?`, `text?`, `harness?` | tap | one send plus Return per message line (6) |
| `open_tab` | `station_id`, `command?` | tap | open a new pane or tab next to the row in the configured terminal, then type `command` there without Enter |
| `reviewer_retrigger` | `pr` | tap | `[reviewer] retrigger_command` with `{pr}`, else a PR comment from `retrigger_comment` |
| `ci_rerun` | `pr` | tap | `gh run rerun --failed <run id>` for each id in `failed_run_ids` |
| `pr_ready` | `pr` | tap | `gh pr ready <pr>` |
| `pr_draft` | `pr` | tap | `gh pr ready <pr> --undo` |
| `merge` | `pr`, `typed_confirmation` | typed (the PR number) | `gh pr merge <pr> --squash`; refused while CI is not `success`, the reviewer (when configured) has not approved the head commit, the PR is draft or conflicting; `facts.blocked` lists the reasons |
| `open_pr` | `pr` | none | returns the PR url; the client opens it |
| `open_preview` | `pr` | none | returns `[scm] preview_url` with `{pr}` filled |
| `run_command` | `command`, `station_id?`, `values` | the command's `confirm` | a `[[commands]]` entry (below) |
| `board_stage` | `card_id`, `stage` | tap | `[board]` stage command; `stage` must be in `[board] stages` |
| `board_note` | `card_id`, `text` (1 to 2,000) | tap | `[board]` note command |
| `issue_set` | `slug`, `key`, `value` | tap | `<[intake] set_command> set <slug> <key>=<value>` |
| `set_domain` | `domain`, `target` (`pr:<n>` or `station:<id>`) | tap | adds an alias to that domain's `manual` list in `config.toml` |
| `ack` | `kind` (`closeout` or `reply`), `id` | none | hides a `your_move` row until the daemon restarts |

`card_id` is `[A-Za-z0-9_-]{1,64}`; `slug` is `[a-z0-9][a-z0-9-]{0,100}`; `key` is `[a-z_][a-z0-9_.]{0,60}`;
`value` is one line under 500 characters. PR parameters accept `253` or `#253`; most PR actions need an open PR
on the floor (`open_pr`, `open_preview` and `postmerge` also accept merged ones).

**Terminal capabilities.** The configured terminal adapter declares `can_send`, `can_focus`, `can_read_screen`,
`can_open` and `has_groups`. `focus` needs `can_focus`; `open_tab` needs `can_open`; `dispatch`,
`answer_question`, `postmerge`, `new_item`, `run_skill` and `library_send` need `can_send` and
`can_read_screen`. A lever the terminal cannot do is refused with a plain message.

**Sending to a session** (`dispatch` and every action built on it). The daemon asks the terminal for the
session's pane, reads the screen, and refuses if the agent's input box holds unsent text (`draft`). Otherwise it
types the text, presses Return, waits one second and reads the screen again; `landed` is true when the prompt
shows up, with `echo` the matching line. Newlines in the text are collapsed to spaces (with a warning). Warnings
also say when the session is active (the text queues behind its turn) or its note says `done`.

**Custom commands** (`run_command`). The preview shows the filled argv; `confirm` comes from the command; with
`prod = true` the plan carries a `PROD` warning (and `facts.prod`), which clients show in a distinct style; with
`confirm = "typed"` the user types the command id. Inputs are validated against their definition: required
unless they have a default or `optional`, at most `max` characters (default 2,000), single line unless
`multiline`, and `choice` values must be in `choices`. `flag` inputs pass their `arg` when checked. For
`scope = "station"` commands `station_id` is required. The result is `{ok, output, error, command}`.

## 5. Configuration

Settings load from `$SHUFLER_CONFIG`, else `~/.config/shufler/config.toml`, else the in-repo
`daemon/config.example.toml`. `bin/shufler init` copies the example to the user path and `bin/shufler setup`
picks the terminal. Environment variables `SHUFLER_<NAME>` override some settings (`PORT`, `CONFIG`,
`TERMINAL`, `CMUX`, `GH`, `ACTIONS_LOG`, `CACHE_DIR`, `HISTORY_DB`, `LIBRARY`, `PROCESSES`, `DEV` and the
directory settings of optional sources). Optional sources are off until enabled, and the example file documents
every key. Sections:

| Section | Keys and effect |
|---|---|
| `[app]` | `port`, `owner_aliases` (lower-case names meaning the person running Shufler; default `["me"]`), `actions_log`, `cache_dir` |
| `[terminal]` | `kind` (`cmux`, `iterm2`, `tmux`, `auto`), `command_titles`, `utility`, `processes` |
| `[cmux]`, `[iterm2]`, `[tmux]` | adapter options (`docs/TERMINALS.md`) |
| `[agents]` | `enabled`: `"auto"` (default: Claude Code always, other harnesses when installed) or a list such as `["claude", "codex"]`; `SHUFLER_AGENTS` overrides it (`docs/AGENTS.md`) |
| `[agent]`, `[[agent.accounts]]` | Claude Code: `adapter` (only `claude-code`); per account `name`, `label`, `projects_dir`, `claude_json`, `settings`, `usage_cache` |
| `[codex]` | Codex CLI: `home` (default `$CODEX_HOME`, else `~/.codex`; `SHUFLER_CODEX_HOME` overrides), `bin` |
| `[scm]` | `adapter` (`github`), `gh`, `repo` (`owner/name`; empty turns the PR sources off), `deploy_workflow`, `deploy_branch`, `preview_url`, `worktree_roots` |
| `[reviewer]` | `enabled`, `login_regex`, `status_command`, `retrigger_command`, `retrigger_comment` |
| `[intake]` | `enabled`, `dir`, `set_command`, `workspace`, `prompt`, `reply_events` |
| `[ledgers]` | `enabled`, `dir`, `area_env`, `session_marker` |
| `[board]` | `enabled`, `command`, `stages`, `get_args`, `stage_args`, `note_args`, `stage_pattern`, `record_key` |
| `[pipeline]` | `stages`: the work phases (`id`, `label`, `color`, `description`) |
| `[notes]` | `enabled`, `dir` |
| `[[commands]]` | custom commands (below) |
| `[prompts]` | `postmerge`, `[[prompts.canned]]` (`group`, `label`, `text`) |
| `[history]` | `enabled`, `path`, `retention_days` (90), `backfill_days` (30) |
| `[terminals]`, `[terminals.presets.<name>]` | web terminals (section 6) |
| `[skills]`, `[skills.<name>]` | skill exposure and placement (below) |
| `[world]`, `[[domain]]` | `fallback_domain`, `command_domain`, `fix_pattern`; domain lanes |

### Capabilities

`capabilities` tells the client which levers exist (the web hides the rest). It appears in every snapshot and in
`GET /api/config`.

| Field | Meaning |
|---|---|
| `product` | the product name |
| `terminal` | active terminal kind (`cmux`, `iterm2`, `tmux`) |
| `agent` | agent adapter (`claude-code`) |
| `agents` | enabled agent harnesses, e.g. `["claude", "codex"]` |
| `scm` | `github`, or null when `[scm] repo` is empty |
| `reviewer` | a reviewer bot is configured |
| `reviewer_retrigger` | a retrigger command, or a retrigger comment with a repo, is configured |
| `tracker` | which of `intake`, `ledgers`, `board` are on |
| `board_stages` | the board's stage names; empty when the board is off |
| `issue_set` | `[intake] set_command` is configured |
| `session_notes` | `[notes] dir` is configured |
| `commands` | `CommandDef[]` for the `[[commands]]` entries (below) |
| `owner_aliases` | `[app] owner_aliases` |
| `command_titles` | upper-case `[terminal] command_titles`, sorted |
| `deploys` | repo and `deploy_workflow` are configured |
| `preview` | `[scm] preview_url` is set |
| `intake` | `[intake] workspace` is set (the "New work item" form works) |
| `terminals` | web terminals are enabled |
| `terminal_presets` | sorted preset ids: `shell_here` plus each preset that has a `command` |
| `skills` | always true |
| `skills_config_writable` | a user config file is in use, so `POST /api/config/skills` can persist |
| `history` | `[history] enabled` |

### Custom commands (`[[commands]]`)

A named command runs a program of your own through the confirm panel. Fields: `id` (`[a-z0-9][a-z0-9_-]{0,40}`),
`label`, `description`, `argv` (list; first element `~`-expanded; required), `env` (table of strings), `scope`
(`global`, default, or `station`), `confirm` (`none`, `tap` default, `typed`), `prod` (bool), `timeout`
(seconds; default 30), and `inputs`. Tokens in `argv` and `env` values are `{<input name>}` and, for station
scope, `{station_id}`, `{station}`, `{session_id}`, `{cwd}`. A whole argument that is one token whose input is
empty (an unset flag or an empty optional input) is dropped. Commands are the extension point for anything
site-specific: writing session notes, running a read-only query, logging a standup line.

Input fields: `name` (`[a-z_][a-z0-9_]{0,30}`), `label`, `type` (`text`, `choice`, `flag`), `choices`, `max`,
`multiline`, `placeholder`, `default`, `optional`, and `arg` (for flags: the argument passed when checked).

The snapshot and `/api/config` hold only the public part, so `argv` and `env` never leave the daemon:

```ts
interface CommandInput { name: string; label: string; type: 'text' | 'choice' | 'flag';
  choices?: string[]; max?: number; multiline?: boolean; placeholder?: string; default?: string; optional?: boolean }
interface CommandDef { id: string; label: string; description: string; scope: 'global' | 'station';
  confirm: 'none' | 'tap' | 'typed'; prod: boolean; inputs: CommandInput[] }
```

### Intake records

With `[intake] enabled`, `<dir>/<slug>.json` describes a work item and `<slug>.events.jsonl` its event log. Read
fields: `slug` (default: file name), `title`, `state`, `domain`, `pr: {number}`, `source: {reporter}`,
`session: {id}`, and the card under the `[board] record_key` key (default `card`: `{id, stage}`). Event lines
are `{type, ts}`; the newest three are read. A record with no PR and a state other than `closed` becomes an
`issue:<slug>` workpiece; the optional `set_command` takes `set <slug> key=value`.

### Board

With `[board]` on, each non-finished intake record's card id is looked up by running `command` with `get_args`
(`{id}` filled); the card's stage is the first match of `stage_pattern` in its output (lower-cased, spaces to
underscores). `stage_args` (`{id}`, `{stage}`) and `note_args` (`{id}`, `{text}`) back the `board_stage` and
`board_note` actions.

### Skills

Skills are discovered read-only from each agent account's config directory: `skills/*/SKILL.md`,
`commands/**/*.md`, and plugin skills under `plugins/cache/<marketplace>/<plugin>/<version>/skills/*/SKILL.md`
(newest version wins; the slash name is `/<plugin>:<skill>`); and per station repo from `.claude/skills`,
`.claude/commands` and `docs/claude/skills`. Frontmatter `name`, `description` and `argument-hint` (or the first
line of an `## Arguments` or `## Input` heading) fill the entry.

`[skills]` takes `expose` (names shown first in the palette) and `hide` (removed entirely). A `[skills.<name>]`
table takes `target` (default station title), `args_template`, `confirm` (`none`, `tap`, `typed`), `pin` (show
as a button) and `placement` (`station`, `pr`, `global`, `question`, `none`).

`GET /api/config/skills` returns `{expose, hide, skills: {<name>: settings}, config_file, writable}`.
`POST /api/config/skills` takes `{skill, expose?, hide?, pin?, confirm?, placement?, target?, args_template?}`
(null or an empty string clears `placement`, `target` or `args_template`), validates it, rewrites the `[skills]`
tables of the user config (comments inside them are not kept) and answers `{ok, expose, hide, skills}`; 409 when
only the in-repo example config exists.

### `GET /api/config`

`{product, canned_prompts: [{group, label, text}], postmerge_prompt, domains, presets: [{name, command, cwd,
needs_pr}], skills (exposed or pinned ones), pipeline_stages, board_stages, capabilities}`. `domains` are the
`[[domain]]` entries (`id`, `label`, `code`, `color`, `aliases`, `manual`; read again whenever the file changes,
no restart needed). `presets` is empty when web terminals are off.

## 6. Other endpoints

### Conversation and session history

| Endpoint | Response |
|---|---|
| `GET /api/stations/{station}/conversation?n=&before=&results=` | `{turns: [Turn], has_more, error?}`: the newest `n` turns (default 20, at most 200) older than epoch second `before`; `results=1` adds each tool call's result text (2,048 characters at most) |
| `GET /api/workpieces/{pr}/conversation` | the same for the session that owns the PR, plus `station_id` and `filtered_by_pr` (false: no turn mentioned the PR, so the plain tail is returned) |
| `GET /api/stations/{station}/history/search?q=` | `{results: [{ts, role, snippet}], truncated}`: case-insensitive substring over user and assistant text, 200 hits at most |
| `GET /api/stations/{station}/history/summary` | `{started_at, turns, pr_links: [{pr, ts}], skills_used: [{skill, count}], files_touched_count, compactions: [ts], prior_session_ids}` |

`{station}` is a station id or ref; unknown stations answer 404. Thinking blocks, sidechain and meta records,
and text injected by the harness (reminders, notifications, command output) are skipped; slash commands show as
`/name args`. Codex rollouts give the same turn shape: user prompts (not the environment context Codex injects),
assistant messages, and tool calls (`shell`, `apply_patch`, `exec`, ...) with the command, patched file or first
line of code as the summary; `skills_used` and `prior_session_ids` are empty for them.

### Web terminals

Shell terminals inside the web app, each a PTY running `$SHELL -l` with the terminal-identity variables
removed and `SHUFLER_TERMINAL=1` set.

- `GET /api/terminals` returns `{terminals: [Terminal]}`.
- `POST /api/terminals` with `{station_id?, cwd?, preset?, pr?}` opens one and returns `{ok, id, pid, cwd, preset,
  prefill, station_id, created_at, last_io, alive, ws_url, prod, command}`. Errors: 403 origin, 404 unknown
  station, 422 refusal (limit, unknown preset, missing PR, bad directory). The working directory must exist and
  lie under the home directory.
- `DELETE /api/terminals/{id}` closes it: `{ok}`, 404 when unknown.
- WebSocket `/term/{id}` (origin required; close code 4404 when unknown): binary frames hold terminal
  bytes both ways, with up to 256 KB of scrollback replayed on connect; text frames `{"type": "resize", cols,
  rows}` and `{"type": "input", data}` are control messages.

At most `[terminals] max` (default 6) terminals are live; one idle for `idle_close_s` (default 7,200 s) is
closed. Presets (`shell_here`, and `[terminals.presets.<name>]` entries with a `command`) only **type** their
text into the shell without a newline, 0.6 s after start; the user presses Enter. A preset has `command` (with
`{pr}` filled from the request), optional `cwd`, optional `prod = true`. The ids `prod_console` (marks the
terminal `prod`), `preview_console` (needs a PR), `local_console` (runs in the station's cwd) and `shell_here`
are the ones the web knows by name. The never-do guard checks the prefill. Opening and closing are logged;
keystrokes never are.

### Time travel (history)

With `[history] enabled`, events and compacted snapshots are written to SQLite (`[history] path`, default
`~/.local/share/shufler/history.sqlite`) by a write-behind thread, so the snapshot tick never waits on disk. A
compacted snapshot (gzip JSON without skills, message previews and question text) is saved every 5 minutes and
on bursts of 3 or more events; rows older than `retention_days` are pruned. On first start a best-effort
backfill imports `backfill_days` of PR open, merge, review and deploy times from GitHub, with `source:
"backfill"`.

- `GET /api/history/range?from=&to=` (`from` required, epoch seconds or ISO 8601; `to` defaults to now) returns
  `{from, to, base_ts, base, events, truncated}`: `base` is the newest stored snapshot at or before `from`,
  `events` are `{ts, kind, pr, workpiece_id, station_id, from, to, source, ...}` in time order (20,000 at most;
  `truncated` says so). Replaying `events` over `base` reconstructs any instant.
- `GET /api/history/days` returns `{days: [{day, events, merges, deploys, needs_you_peak, snapshots,
  backfill_only}]}`.
- Both answer 404 when history is off, and 400 for a bad range.

### Context library

A library is a set of named references to files and folders that can be granted to sessions and sent to them as
context. It lives in `library.json` next to the active `config.toml` (`SHUFLER_LIBRARY` overrides), written
atomically; an unreadable file is served as empty and moved aside to `library.json.corrupt-<ts>` on the next
write.

```jsonc
{"version": 1,
 "items": [{"id": "lib_0123abcd", "name": "Billing notes", "description": "", "paths": ["/home/dev/docs/billing"],
            "tags": ["billing"], "created": 1790000000.0, "updated": 1790000000.0}],
 "grants": [{"id": "gr_0123abcd", "item_id": "lib_0123abcd", "target": "domain:billing", "mode": "pinned",
             "created": 1790000000.0}],
 "deliveries": [{"item_id": "lib_0123abcd", "station_id": "<id>", "session_id": "<uuid>|null",
                 "compactions": 0, "ts": 1790000000.0}]}
```

Item paths are absolute (`~` expanded), normalised and deduplicated, 1 to 50 per item; names are one line of
at most 120 characters; tags match `[a-z0-9][a-z0-9_.:-]{0,39}`, at most 20; at most 500 items. A grant target is
`all`, `station:<id>` or `domain:<id>`; mode is `pinned` or `once`; one grant per item and target (granting
again changes the mode); deleting an item deletes its grants. The last 500 deliveries are kept.

| Endpoint | Behaviour |
|---|---|
| `GET /api/library` | `{items: [item + status[]], grants, deliveries (last 100), owed, file, error}`; `status[i]` is `{path, exists, kind: file\|dir\|other\|null, size, files, truncated}` |
| `POST /api/library/items` | create, or update when `id` is given: `{ok, result: item}`; 400 `{ok: false, error}` on validation |
| `DELETE /api/library/items/{id}` | `{ok}` or 404 |
| `POST /api/library/grants` | `{item_id, target, mode}` to `{ok, result: grant}` |
| `DELETE /api/library/grants/{id}` | `{ok}` or 404 |
| `GET /api/library/browse?path=&hidden=` | read-only listing for a path picker: `{path, parent, prefix, roots, entries: [{name, path, kind}], truncated}`. Allowed roots are the home directory and every station's working directory; paths are resolved with symlinks before the check and `..` is refused; dotfiles are hidden unless `hidden=1`. A path that is not a folder lists its parent filtered by the last segment (autocomplete). |
| `POST /api/library/resolve` | `{entries: [name \| {name, kind?, children?}]}` to `{results: [{name, kind, matches: [abs path], status: one\|many\|none}]}`; looks for dropped file or folder names under session working directories and their git roots (depth 7, 20,000 folders or 3 s, 20 matches each) |

`library_send` composes one message per harness: for `claude-code` it sends `/add-dir <folder>` for each folder
outside the session's cwd (outermost only), then `Context from the library: <name>: @path ...; ... Read these
before continuing.` (paths inside the cwd are relative, paths with spaces are quoted); for `codex` and other
harnesses it sends the same prompt with plain absolute paths (Codex has no `/add-dir`, and an `@` typed into its
composer opens a file picker; a path with spaces is double-quoted for `codex`). The format follows the station's
`harness` (`claude` → `claude-code`, `codex` → `codex`), else `codex` when the station title contains `codex`,
else the configured agent; the `harness` parameter overrides it. `text` is the confirm panel's edited
message (`/add-dir` lines go first, the rest joins into one prompt, at most 20 lines). Lines are sent one at a
time; between lines the daemon waits a second and stops unless the agent's input box is empty again, so text
never lands in a dialog. On success one delivery per item is recorded with the station's session id and
compaction count.

`snapshot.library.owed` maps a station id to the item ids it has not received. A station owes an item when a
grant matches it (`station:<id>`; `domain:<its domain>` and `all` only for work rows) and: for `pinned`, no
delivery to its current session with a compaction count at least the current one; for `once`, no delivery after
the grant was created. Stations with no running agent owe nothing. The value is recomputed on every rebuild and
right after any library write or send.

## 7. Safety model

- The daemon listens on loopback only, checks `Host`, and requires an allowed `Origin` for every state-changing
  request.
- Previews fire nothing. Every action that changes anything runs a command shown verbatim in the confirm panel;
  merging also requires typing the PR number, and the daemon verifies it.
- Actions run as the person who started the daemon, on their machine, and are logged with their parameters and
  results.
- Prompts typed into a session go through that session's terminal exactly as if typed by hand; Shufler keeps no
  session state of its own except the acknowledged-rows list, so the terminal and Shufler always show the same
  facts. A prompt is never sent over text already waiting in the input box.
- The never-do guard (section 4) applies to every command and every prompt, whatever the client asks for.
- Message text stays on disk: the snapshot carries tool names, counts, timestamps, a 120-character preview and
  the open question. Everything else is fetched on demand from the conversation endpoints.
