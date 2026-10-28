# Shufler

[![CI](https://github.com/jgrichardson/shufler/actions/workflows/ci.yml/badge.svg)](https://github.com/jgrichardson/shufler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/jgrichardson/shufler)](https://github.com/jgrichardson/shufler/releases)

*You used to write code. Now you shuffle prompts between people and robots. Might as well enjoy it.*

A 3D control room for developers who run many AI coding agent sessions at once, in Claude Code, the OpenAI Codex CLI or both.

**[Try the live demo](https://shufler.app)** (sample data in your browser, nothing to install) · [Quickstart](#quickstart) · [Install](#install) · [How is this different?](#how-is-this-different)

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/hero.png">
  <img src="docs/images/hero.gif" width="100%" alt="Shufler beside a terminal whose tabs match its rows: clicking AUTH, then the BILLING question, then INFRA switches the terminal to that tab each time">
</picture>

Shufler reads your terminal sessions, your agent transcripts and your GitHub pull requests, and turns them into an interactive 3D world. Each terminal session is a row. Its PRs and issues move left to right through phase columns, from Brainstorm to Deploy. Anything that needs you lights up red. You can answer a question, dispatch a prompt, re-run CI or merge from the scene, or just carry on in your terminal.

**Shufler does not replace Claude Code, Codex or your terminal.** You keep working exactly as you do today: your agents run in your terminal tabs and you type to them there. Shufler sits beside them, reads what they are doing and shows it all as one world. Each row is one of your terminal tabs. Click a row and your terminal switches to that tab.

## Quickstart

Beta (v0.3.0, pre-1.0), macOS, any terminal (cmux, iTerm2 and tmux get the most). You need the [GitHub CLI](https://cli.github.com) and Claude Code or the Codex CLI. Other ways to install are in [Install](#install).

```bash
brew install jgrichardson/shufler/shufler   # or: pipx install shufler, or: uv tool install shufler
shufler setup            # writes ~/.config/shufler/config.toml; then set scm.repo in it
shufler start            # open http://127.0.0.1:4700
```

## Why this exists

I've been a full-stack engineer for about twenty years, and I liked the work. The day ran across three windows: a terminal, a code editor and the app I was building. The editor was the centre. You read code, you wrote code, and the other two windows supported that.

AI changed the shape of that day. I barely open an editor now, I miss it, and I don't think it's coming back. The terminal is my main interface, and inside it I run five, eight, sometimes a dozen agent sessions at once. One is building a feature, one is fixing review comments, one is waiting for CI, one has stopped to ask me a question.

One day I looked at what I'd actually done and it was mostly this: copy a request out of Slack, paste it into an agent. Copy the agent's question back to the person who asked. Paste their answer into the agent. Check GitHub, nudge CI, paste the error into another agent, carry the result back to the ticket. Request in, request out, all day. I wasn't reasoning much. I was shuffling.

That's the job now for a lot of us. Not writing code, but shuffling requests between the people who want things and the models that build them, and holding the state of every thread in your head. Which session is blocked on me? Which PR passed review? Which one is still on an old commit? None of my tools was built to answer that, because none of them was built for this way of working. And it's the same kanban every org already runs for designs, tickets and pull requests.

So I stopped pretending the day still looks like an editor, and built a tool for the job I actually have. If the work is shuffling a fleet of agents across a pipeline, it should look like what it is: a live world where every session is a row, every pull request is a car riding from idea to production, and anything waiting on you lights up. Shuffling is less soul-crushing when you can see the whole floor, and it can even feel a little like a game, one where the score is shipped work.

That's Shufler. It doesn't pretend you're still hand-writing every line. It owns the shuffle, and makes you very good at it.

It started as a weekend project and it's rough in places. Claude Code wrote most of the code; I designed it and reviewed what shipped. I've used it at work every day since, and I enjoy it, which is why it's here.

Shufler runs on your machine only. It wraps your existing tools (a terminal multiplexer, an agent harness, the `gh` CLI) and does not replace any of them.

## A quick tour

The 10x engineer became the 10-tab engineer. Shufler gives you one tab back.

Click a row and your real terminal jumps to that session's pane. This recording is live: Shufler on the left, tmux in iTerm2 on the right.

<img src="docs/images/gifs/focus.gif" width="100%" alt="Clicking the BILLING, AUTH and SEARCH rows in Shufler switches the tmux window in iTerm2 to that session each time">

How the scene is laid out: rows, stages, moving work, the warehouse and the library.

<img src="docs/images/gifs/tour.gif" width="100%" alt="A captioned tour: each row is a session coloured by its domain, columns are the stages of work, a pull request rides into Review, shipped work lands in the warehouse, and the library makes context available to a domain">

Your terminal and the scene stay in sync both ways: when an agent opens a PR or asks a question, its pod moves or turns red, and when you answer from the scene, the agent picks it up.

<img src="docs/images/gifs/sync.gif" width="100%" alt="An agent opens a PR and its pod rides into Review; it asks a question and the pod turns red; clicking the pod opens the session, the answer goes through a confirm preview, and the red clears">

## Features

All screenshots use the built-in demo data (`?mock=1`).

### One row per session

Each terminal workspace is a row, in the same order as your terminal's sidebar. The header shows the domain colour, the item count and a red count of what needs you. A session with no live agent is drawn dark.

<img src="docs/images/features/rows.png" width="560" alt="Row headers on the left of the scene, each with a domain colour swatch, a title, an item count and a red needs-you count">

### Columns are stages of work

Work moves left to right through Brainstorm, Plan, Build, QA, Review, Merge and Deploy. Each stage has its own landmark and a live count. The stages, their names and colours are configurable.

<img src="docs/images/features/phases.png" width="100%" alt="The seven stage landmarks in a row, each labelled with its name and the number of items in it, with the library beside them">

### Pods

Each pull request or issue is a pod on its session's lane, in the column for its stage. The label carries the PR number, who holds the ball, the review round and a conflict flag. A red ring and beam mean it needs you.

<img src="docs/images/features/pods.png" width="100%" alt="Close-up of pods on their lanes: one with a red ring and beam labelled with its PR number, review round and a conflict badge">

### Pipeline board

`P` folds the scene into a kanban board with one column per stage, and `P` again unfolds it.

<img src="docs/images/gifs/pipeline.gif" width="820" alt="The 3D scene morphing into a flat kanban board and back">

### Horizon view

`H` tilts the camera low over the front rows, so the sky, the skyline and each skin's landmarks fill the top of the frame. Rows, selection and levers work as usual, and `H` again flies back to where you were. Turn it on with the **Horizon** button in the layer bar or `?camera=horizon` too.

<img src="docs/images/features/horizon.png" width="100%" alt="The horizon view in the Starship skin: the board low in the frame with its row headers, and a ringed gas giant filling the sky above the stage landmarks">

### Big islands

An optional layout that gives each session its own large island, with its building and a loop of track that has a stop for every stage. Its pods ride the loop to their stage. Switch with **Grid | Islands** in the top bar, `I`, or `?layout=islands`. Pipeline view always uses the grid. The horizon view works over the islands too.

<img src="docs/images/features/islands.png" width="100%" alt="The big-island layout: one hexagonal island per session, each with its building, a loop of track and pods at their stages, a name tag under each island and the stage legend across the top">

### Your move

One queue of everything waiting on you: a question an agent asked, a PR ready to merge, a step you have to run yourself. `N` flies to the next one. The Needs you view (`2`) dims everything else so only your items stay lit.

<img src="docs/images/features/your-move.png" width="420" alt="The Your move list with a decision, a merge and a session task, each with its age and a button">

<img src="docs/images/features/needs.png" width="100%" alt="The Needs you view: the board dimmed, with red beams and rings on the items waiting on you">

### Hover for details

Hover a session or a pod to see its note, its pending question and the agent's last message, without opening anything.

<img src="docs/images/features/tooltip.png" width="480" alt="A tooltip over a session showing its note, the question it asked and a preview of the agent's last message">

### Pull request gates

A PR's panel shows CI, the review bot's verdict and the mergeable state, and whether the verdict applies to the latest commit. Merge stays locked until every gate is green, and then you type the PR number to unlock it.

<p>
  <img src="docs/images/features/pr-gates.png" width="49%" alt="A PR panel with CI pending, the review bot requesting changes in round 3, and the merge box locked with the reasons listed">
  <img src="docs/images/features/merge-ready.png" width="49%" alt="A PR panel with CI success, review approved and a clean merge state, and the merge box ready for the typed PR number">
</p>

### Levers with a preview

Dispatch a prompt, answer a question, re-run CI, mark a PR ready or merge. Every lever shows the exact command before it runs, and the result comes back as a toast.

<img src="docs/images/features/confirm.png" width="560" alt="A confirm dialog showing the exact terminal command that will send a prompt to a session, with Cancel and Run">

<img src="docs/images/features/toasts.png" width="420" alt="Two toasts: a prompt sent to a session, and a merge refused because the review bot has not approved the current commit">

### Answer an agent's question

When an agent stops to ask you something, the question and its options show on the session's panel. Pick an option or type your own answer.

<img src="docs/images/features/question.png" width="420" alt="A session panel with a decision card: the question, a recommended option, two other options and a free-text answer box">

### Conversation

Read a session's recent transcript, search it and reply from the panel. The text is read only when you open this tab.

<img src="docs/images/features/conversation.png" width="420" alt="The Conversation tab with the pending question at the top, messages from you and the agent, tool calls and a reply box">

### Domains

A domain groups rows and work by area and gives them a colour. Click one to see what needs you there, its work by stage and its sessions.

<img src="docs/images/features/domain.png" width="420" alt="A domain panel showing live, needs-you, parked and shipped counts, the items that need you and the work by stage">

### Warehouse

Shipped PRs become crates on their domain's rack. One still owing a close-out message waits on the dock. `5` flies there.

<img src="docs/images/features/warehouse.png" width="100%" alt="The warehouse beside the board, with racks of shipped crates and the shipping dock">

### Context library

Keep files and folders as named items and make them available to one session, a whole domain or every session. Nothing is copied; an item points at paths. `L` opens it.

<img src="docs/images/features/library.png" width="420" alt="The library panel with a drop zone and three items, each with its paths, sizes, tags and a Make available to button">

### Fleet

A sortable table of every session's model, context use and cost, with totals per account.

<img src="docs/images/features/fleet.png" width="420" alt="The Fleet table listing sessions with group, a context-use bar and cost, under per-account totals">

### Skills palette

`Cmd+K` searches the skills and slash commands your agent already has, plus canned prompts, and runs one in the right session.

<img src="docs/images/gifs/palette.gif" width="760" alt="The palette opening and filtering to review-related skills and prompts as you type">

### Event ticker and history

Every stage change is logged with its time. Events and snapshots are kept in SQLite, so a catch-up replay can show what changed while you were away.

<img src="docs/images/features/ticker.png" width="100%" alt="The event ticker listing recent stage changes with times and PR numbers">

### Layers

Toggle islands, sessions, PRs, conflicts, red alerts, tethers and beams, and choose how many labels to show. `0` keeps only what matters.

<img src="docs/images/features/layers.png" width="100%" alt="The top bar with view presets and the layer bar with toggles and label modes">

### Skins

Six skins ship with the app. Switch live from the top bar or Settings, or write your own (see [`docs/SKINS.md`](docs/SKINS.md)).

- **Starship**, the default: a sleek station in orbit, with lacquered hull modules, graphite decks and ice-blue light over a planet.
- **Factory**: the original factory in the sky, with grass islands, pastel workshops and a warehouse under a quiet horizon.
- **Sky Islands**: floating rock islands at dusk, with stone towers, plank bridges and rail cars over a sea of clouds.
- **Theme Park**: a park at golden hour or under string lights, with coaster track for rows, ride stations for stages and a gift shop for shipped work.
- **Casino**: a card room, with felt tables for rows, playing cards for work items, slot machines for sessions and a cashier for shipped work.
- **Command Post**: a field base on a living map, with compounds for rows, command tents for sessions, supply convoys for work items and a depot with a helipad for shipped work. Logistics and ops only.

<img src="docs/images/features/skins-grid.png" width="100%" alt="All six skins side by side, dark on the top row and light on the bottom: Starship, Factory, Sky Islands, Theme Park, Casino and Command Post">

<img src="docs/images/gifs/skins.gif" width="820" alt="Switching skins live from Starship to Factory, Sky Islands, Theme Park, Casino and back">

### Light and dark

Every skin has a dark and a light scene, and the panels follow. Pick one or match the system in Settings.

<img src="docs/images/features/dark-light.png" width="100%" alt="The Starship skin in dark and light themes side by side">

### Keyboard first

Press `?` for every shortcut. See [Keyboard shortcuts](#keyboard-shortcuts) below.

<img src="docs/images/features/shortcuts.png" width="560" alt="The keyboard shortcuts overlay">

### Built-in terminals

A drawer of local shells, for a console you want next to the scene. At most six, closed after two hours idle.

### Agent access (MCP)

`shufler mcp` (`bin/shufler mcp` in a clone) is an MCP server for Claude Code and Codex, so your agents can ask Shufler what is running: `status`, `needs_you`, `get_pr`, `read_session` and `list_work_items`, all read-only. An opt-in second tier lets an agent preview a prompt or an answer for another session and send it only through a separate confirm call. `shufler mcp --print-config` prints the setup lines. See [`docs/MCP.md`](docs/MCP.md).

## How is this different?

Several good tools already help you run many agents. Pick the one that fits how you work.

- **Claude Code's agent view.** Built into Claude Code: one screen for all your Claude Code sessions that shows which ones need input and lets you answer them there. If you only run Claude Code and want to stay in the terminal, it covers the core "which session is waiting on me?" question, with nothing extra to install.
- **claude-squad and other tmux-based managers** (TUIs that start, list and switch between agent sessions in tmux, often one git worktree each). They manage the sessions for you inside the terminal.
- **A tmux grid or split panes.** No new tool at all, and you see every agent's output live. It gets crowded past a handful of sessions, and it does not know about pull requests.

Shufler sits next to whichever of these you use and adds a different view:

- Claude Code and Codex sessions in the same scene, from cmux, iTerm2 or tmux, or from any terminal in no-terminal mode. It does not start or own your sessions.
- Pull requests and their CI, review and merge state, shown moving through stages beside the session that owns them.
- One "your move" list across sessions and PRs, and a click that focuses the real terminal tab.

The trade-offs: it is a browser app plus a local daemon, macOS only for now, GitHub only, and early beta.

## Status

Shufler is early beta software, version 0.3.0 (pre-1.0). It was built for one developer's setup and is being opened up.

- It is macOS first. Terminals: cmux, iTerm2 and tmux, plus a no-terminal mode that works with any other terminal (see [`docs/TERMINALS.md`](docs/TERMINALS.md)). Autostart uses launchd. Linux is planned.
- Agent harnesses: Claude Code and the OpenAI Codex CLI, mixed freely (see [`docs/AGENTS.md`](docs/AGENTS.md)).
- The only supported source control host is GitHub, through the `gh` CLI.
- v0.3.0 adds packaged installs (Homebrew from the project's own tap, `pipx` or `uv tool` from a release wheel, a one-line installer; see [Install](#install)), no-terminal mode with greyed-out levers, and an MCP server for your agents. It is on PyPI as `shufler` and in the project's own Homebrew tap. v0.2.0 added the Codex CLI harness, the horizon view and the big-island layout. See [`CHANGELOG.md`](CHANGELOG.md).
- The optional integrations (a reviewer bot, work item sources, custom commands) talk to your tools through commands you configure. They are all off by default.

See [Support matrix](#support-matrix) for what is planned.

## Requirements

| Needs | Version | Notes |
|---|---|---|
| macOS | recent | `shufler` uses `launchctl`, `lsof` and `ps` |
| A terminal | any recent | [cmux](https://github.com/manaflow-ai/cmux), iTerm2 or tmux. Its workspaces, tabs or windows become rows. `shufler setup` picks one. Any other terminal works in no-terminal mode (`none`): rows come from the running sessions, and sending, answering and Focus are off |
| [uv](https://docs.astral.sh/uv/) or [pipx](https://pipx.pypa.io) | any recent | Installs the `shufler` command. Homebrew needs neither |
| Python | 3.11 or newer | uv fetches it for you; Homebrew brings its own |
| [Bun](https://bun.sh) | any recent | From source only: builds the web app. The lockfile is `bun.lock`. Packaged installs carry a built copy |
| Node | 18 or newer | From source only: needed by the web toolchain (Vite 5, Vitest 2) |
| [GitHub CLI](https://cli.github.com) | any recent | Run `gh auth login` first. Needed for PR data |
| Claude Code | any recent | Sessions run in your terminal. Transcripts are read from `~/.claude/projects`. You need Claude Code, the Codex CLI or both |
| [Codex CLI](https://github.com/openai/codex) | any recent | Codex sessions get rows too. Transcripts are read from `~/.codex/sessions`. Picked up automatically when installed; `[agents] enabled = ["codex"]` runs Codex alone |
| A modern browser | WebGL 2 | Chrome is what the author uses |

## Install

Each install gives you a `shufler` command. The packaged ones (Homebrew, `pipx`, `uv tool`, the one-liner) carry a built copy of the web app, so they need no Bun, Node or clone. From v0.3.0 the package is on PyPI as `shufler`, the formula is in the project's own tap, and the wheel is also attached to each GitHub release. It is not in Homebrew core.

**One line** (macOS). It checks for Python, uv or pipx, installs the latest release wheel, then runs `shufler setup`:

```bash
curl -fsSL https://raw.githubusercontent.com/jgrichardson/shufler/main/install.sh | sh
```

Running it again upgrades in place. It never uses sudo and never starts the daemon; read [`install.sh`](install.sh) first if you like. `SHUFLER_PACKAGE=v0.3.0` pins a release, `SHUFLER_INSTALLER=pipx` picks pipx over uv, and `SHUFLER_NO_SETUP=1` skips setup.

**Homebrew**, from the project's tap:

```bash
brew tap jgrichardson/shufler
brew install shufler
```

**pipx or uv**, from PyPI:

```bash
pipx install shufler
uv tool install shufler
```

Then, for any of those:

```bash
shufler setup           # writes ~/.config/shufler/config.toml and picks your terminal
$EDITOR ~/.config/shufler/config.toml   # set scm.repo, at least
shufler start
```

**From source**, for development or the newest code. Here the command is `bin/shufler`, which adds `dev` and `test`:

```bash
git clone https://github.com/jgrichardson/shufler.git
cd shufler

bin/shufler setup           # writes ~/.config/shufler/config.toml and picks your terminal
$EDITOR ~/.config/shufler/config.toml   # set scm.repo, at least

(cd web && bun install && bun run build)   # builds web/dist, which the daemon serves
bin/shufler start
```

Open http://127.0.0.1:4700. The status bar at the bottom left should say **Live**.

`shufler status` shows the process, the health check and the age of every data source. If a source is failing, it says why.

With cmux, run `shufler start` from a shell inside a cmux workspace. cmux only accepts connections from processes it started, so a daemon started anywhere else shows no rows and `status` reports the `cmux` source as OFF.

For the same reason, the login item does not work with cmux yet:

```bash
shufler install          # launchd agent: RunAtLoad and KeepAlive (cannot reach cmux today)
shufler uninstall        # remove it
```

With Homebrew, `brew services start shufler` does the same job.

### Try it without any setup

Mock mode runs the web app on built-in sample data. No daemon, terminal or GitHub access is needed. Every lever is simulated.

The quickest way is the [hosted demo](https://shufler.app), the same mock mode built as a static site. To run it locally:

```bash
cd web && bun install && bun run dev
```

Open http://localhost:5173/?mock=1. Without `?mock=1` the app never shows demo data on its own: if it cannot reach a daemon after three tries, it says so and points you to `?mock=1`.

### Name your workspaces so sessions join exactly

Shufler matches a terminal workspace to an agent session. The match is exact when the workspace title ends in the first eight characters of the session id:

```
BILLING · db52364d
```

Without that suffix it falls back to session notes, then to a unique working directory match. A workspace with no running agent is marked closed.

## Configuration

Everything machine-specific lives in one TOML file. The daemon looks for it in this order:

1. `$SHUFLER_CONFIG`
2. `~/.config/shufler/config.toml`
3. `daemon/config.example.toml` in the repo (sample values, optional adapters off)

[`daemon/config.example.toml`](daemon/config.example.toml) documents every key. Restart the daemon after editing the file. Domains reload without a restart.

| Section and key | Default | What it does |
|---|---|---|
| `[app] port` | `4700` | Port the daemon listens on. It always binds to `127.0.0.1` |
| `[app] owner_aliases` | `["me"]` | Names in ledger "Ball" cells that mean you |
| `[terminal] kind` | `auto` | `cmux`, `iterm2`, `tmux`, `none` or `auto`. Each terminal has its own section (`[cmux] bin`, ...). `none` works with any terminal: one row per running session, with the levers that need a terminal greyed out. `auto` picks the first terminal running, else `none` (an installed terminal that is not running does not count); it is decided once at daemon start, so set `kind` explicitly if the daemon starts at login before your terminal |
| `[terminal] command_titles` | empty | Workspace titles that get the "command" domain (your control workspaces) |
| `[terminal] utility` | empty | Workspace titles that get no row |
| `[agents] enabled` | `"auto"` | Agent harnesses to watch: `["claude", "codex"]`, or `"auto"` for Claude Code plus every installed harness. See [`docs/AGENTS.md`](docs/AGENTS.md) |
| `[agent] adapter` | `claude-code` | Claude Code adapter settings. Only `claude-code` exists |
| `[[agent.accounts]]` | one personal account | One entry per Claude Code config directory: `projects_dir`, `claude_json`, `settings`, `usage_cache` |
| `[codex]` | `~/.codex` | Codex CLI: `home` (where `sessions/` lives, or `$CODEX_HOME`) and `bin` |
| `[mcp] allow_dispatch` | `false` | Offer the MCP dispatch tools (`send_prompt`, `answer_question`, `confirm_dispatch`). See [`docs/MCP.md`](docs/MCP.md) |
| `[scm] repo` | empty | `owner/name` of your GitHub repo, such as `your-org/your-repo`. Empty turns PR sources off |
| `[scm] deploy_workflow` | empty | Workflow file that deploys to production. Empty turns deploy tracking off |
| `[scm] deploy_branch` | `main` | Branch whose merges count as deployable |
| `[scm] preview_url` | empty | Preview URL template. `{pr}` becomes the PR number |
| `[scm] worktree_roots` | `["~/worktrees"]` | Where `<root>/*/<branch>` worktrees live |
| `[reviewer]` | off | Optional review bot gate. See [Reviewer bot](#reviewer-bot) |
| `[intake]` | off | Optional intake records and a "New work item" box. See [Work items](#work-items-intake-ledgers-and-a-board) |
| `[ledgers]` | off | Optional per-area markdown ledgers |
| `[board]` | off | Optional external board (a CLI you name) |
| `[[commands]]` | none | Your own commands as levers. See [Custom commands](#custom-commands) |
| `[pipeline] stages` | seven phases | The phase columns: id, label, colour, description |
| `[notes] dir` | off | Read per-session note files (state and one line of text) |
| `[prompts] canned` | 14 prompts | Dispatch buttons, grouped. Tokens `{pr}` `{person}` `{topic}` `{url}` |
| `[history]` | on | SQLite history path, `retention_days` (90) and a one-time `backfill_days` (30) |
| `[terminals]` | on | Built-in terminal drawer: `max` (6), `idle_close_s` (7200) and console presets (`prod_console`, `preview_console`, `local_console`) whose commands you fill in |
| `[skills]` | empty | Which skills to expose, hide or pin, and where a pinned skill's button goes (`placement`). Settings rewrites this section |
| `[world] fix_pattern` | `data\|backfill\|migrat\|repair` | Regex on PR titles and branches that marks a fix needing a post-merge step |
| `[[domain]]` | sample set | Row colours and the aliases that place a session or PR in a domain |

### Domain settings

A domain groups rows and work by area, and gives them a colour. A `[[domain]]` table has an `id`, `label`, `code`, `color` and a list of `aliases`. Aliases match lower-case words in workspace titles, PR title scopes, branch names and ledger areas. The ones in the example are samples. Replace them with your own areas. Anything that matches nothing lands in `fallback_domain`.

You can also move an item from its panel with **Move to domain**. That saves an alias in the config file.

### Reviewer bot

If a bot reviews your PRs (any GitHub account that leaves reviews), Shufler can show its verdict and gate merges on it.

```toml
[reviewer]
enabled = true
login_regex = "my-review-bot"                     # GitHub logins whose reviews count
status_command = ["~/bin/review-watch", "status", "--json"]   # optional: rounds and state per PR
retrigger_command = ["~/bin/review-watch", "retrigger", "{pr}"]  # optional; default posts a PR comment
retrigger_comment = "@my-review-bot please review"
```

With the reviewer on, a PR is ready to merge only when the bot approved the latest commit, CI is green and the PR is not a draft. With it off (the default), the reviewer gate is skipped and CI decides.

### Work items: intake, ledgers and a board

Three optional sources add work that is not a PR yet.

- **`[intake]`** reads one JSON record per work item from `dir` (with an `.events.jsonl` beside it) and shows each as a pod. Set `workspace` to a control workspace title and the World panel gets a **New work item** box: it types `prompt` (default `{text}`, for example `"/intake {text}"`) into that workspace. `set_command` lets the item panel change a record's state through your CLI.
- **`[ledgers]`** reads markdown ledgers from `dir`, one folder per area, each with a table of PRs and who holds the ball. A session whose agent process has `area_env` (default `LEDGER_AREA`) set is tied to that area's ledger.
- **`[board]`** talks to an external board through a CLI you name in `command`, with argument templates for reading a card, moving it between `stages` and adding a note. Items link to a card through the intake record's `record_key` field.

`daemon/config.example.toml` documents every key.

### Custom commands

`[[commands]]` turns any command you trust into a lever with a form, a preview and a confirm step. Shufler never runs it through a shell: `argv` is an argument list, and `{name}` tokens are filled from the form.

```toml
[[commands]]
id = "standup"
label = "Standup note"
argv = ["~/bin/standup", "note", "{text}"]
inputs = [{ name = "text", label = "Note", max = 300 }]

[[commands]]
id = "query"
label = "Read-only query"
scope = "global"            # or "station": runs for one session, with {station_id}, {session_id} and {cwd}
prod = true                 # red confirm panel and a PROD warning
confirm = "typed"           # none, tap (default) or typed
timeout = 15
argv = ["~/bin/query", "{raw}", "{text}"]
inputs = [
  { name = "text", label = "SQL", multiline = true, max = 10000 },
  { name = "raw", type = "flag", arg = "--raw" },
]
```

Global commands appear in the World panel, the palette and the command drawer (`/`). Station commands appear on the session panel. Output that parses as a JSON table is shown as a table.

### Environment variables

| Variable | Effect |
|---|---|
| `SHUFLER_CONFIG` | Path to the config file |
| `SHUFLER_PORT` | Port, for the CLI and the daemon |
| `SHUFLER_LIBRARY` | Path to `library.json` |
| `SHUFLER_LAUNCHD_LABEL` | launchd label, default `dev.shufler.daemon` |
| `SHUFLER_DEV` | Set to `1` to let the daemon accept the Vite dev origin on `:5173`. `bin/shufler dev` sets it |
| `SHUFLER_HISTORY` | Set to `0` to turn history off |
| `SHUFLER_AGENTS` | Comma-separated harnesses (`claude,codex`) or `auto`. Overrides `[agents] enabled` |
| `SHUFLER_CODEX_HOME` | Codex home directory. Overrides `[codex] home` and `$CODEX_HOME` |

### Files and ports

| Path | Holds |
|---|---|
| `~/.config/shufler/config.toml` | Your configuration |
| `~/.config/shufler/library.json` | The context library |
| `~/.cache/shufler/` | Cache, phase timers, pid file |
| `~/.local/share/shufler/history.sqlite` | History |
| `~/Library/Logs/shufler.log` | Daemon log |
| `actions.jsonl` in the repo root (from source) or `~/.local/share/shufler/` (packaged) | A log of every action sent (never keystrokes) |

The daemon uses port 4700. The Vite dev server uses 5173.

## Using Shufler

### The scene

- **Rows.** One per terminal workspace. The pinned header on the left shows the domain colour, the title, the item count and the needs-you count. Click it to open that workspace.
- **Sessions.** The building on each row's island. Its lamp shows who holds the ball.
- **Pods.** A PR or issue. The hull colour is its domain. A pod sits in the column for its phase. A cell with more than three pods shows a "+N" crate.
- **Red.** A red beam and ring mean the item needs you. Red is never hidden at any zoom level.
- **Warehouse and dock.** Shipped PRs become crates on their domain's rack. One still owing a close-out message waits on the dock conveyor.
- **Pipeline mode.** `P` morphs the scene into a kanban board with one column per phase. `P` again goes back.
- **Horizon view.** `H`, the Horizon button at the end of the layer bar, or `?camera=horizon` in the URL tilts the camera low over the front rows, so the sky, the skyline and the skin's landmarks fill the top of the frame. Rows, selection and levers work as usual. `H` again flies back to where you were.
- **Big islands.** **Grid | Islands** in the top bar, or `I`, swaps the rows for one large island per session. Each island has a loop of track with a lit post at every stage, and pods ride it to their stage. Hover, click, red beams, gates and levers work as on the grid. The choice is saved in the browser; `?layout=islands` or `?layout=grid` picks one for a single visit. Pipeline view always draws the grid. The horizon view works over either layout: switching layout while it is on keeps it on and re-frames it.

Move with right-drag to pan, left-drag to orbit and the wheel to zoom. Trackpads use two-finger scroll and pinch.

### Panels

- **World panel.** Your move, pipeline counts, the merge queue, close-outs owed, shipped this week, pinned skills, and the Fleet table.
- **Session panel.** Overview with any pending question and telemetry, Conversation, Actions (dispatch, skills, terminals) and Data.
- **Item panel.** CI, reviewer and mergeable gates, the merge box, skills and the close-out levers.

### Levers and confirmation

Every lever opens one confirm dialog with the exact command or URL. Focus, Open PR and Open preview run at once. Most others need one click. Merge is stricter: CI must be green, the reviewer approved after the latest commit, the PR not a draft or conflicting, and you type the PR number. Drafted messages only land in a copy box. Nothing is sent anywhere for you.

If a session already has text typed in its input box, a dispatch is refused and shows you the draft.

### Layer bar

The bar under the top bar toggles Islands, Sessions, PRs, Conflicts, Needs me, Tethers and Beams, and sets Labels to Auto, All or None; the Horizon button at its end turns the horizon view on and off. `0` keeps only islands, pods and needs-me. Your choices are saved in the browser.

### Using the context library

Open it from the top bar or with `L`. An item is a reference to files or folders by path. Nothing is copied.

You can drop files, paste a path or use the CLI:

```bash
bin/shufler library add docs/context/billing --name "Billing context" --to domain:billing
bin/shufler library list
bin/shufler library grant <item> <target> [--once]
bin/shufler library send <item...> --to <session>
```

A grant can be pinned or once, and targets one session, a whole domain or everything. Sending goes through the confirm dialog with an editable message. For Claude Code, folders outside the session's directory are added with `/add-dir` first. For Codex, items are listed by absolute path. Auto-send of pinned context to new sessions is opt-in in Settings.

### Skins and themes

Starship is the default. Factory, Sky Islands, Theme Park, Casino and Command Post are the others. Switch in the top bar, in **Settings → Appearance**, or with `?skin=<id>` in the URL. Dark, light and system themes are in Settings. You can import a JSON recolour or write a code skin. See [`docs/SKINS.md`](docs/SKINS.md).

| | Dark | Light |
|---|---|---|
| **Starship** | <img src="docs/images/hero.png" alt="Starship skin, dark theme"> | <img src="docs/images/starship-light.png" alt="Starship skin, light theme"> |
| **Factory** | <img src="docs/images/factory-dark.png" alt="Factory skin, dark theme"> | <img src="docs/images/factory-light.png" alt="Factory skin, light theme"> |
| **Sky Islands** | <img src="docs/images/skyislands-dark.png" alt="Sky Islands skin, dark theme"> | <img src="docs/images/skyislands-light.png" alt="Sky Islands skin, light theme"> |
| **Theme Park** | <img src="docs/images/themepark-dark.png" alt="Theme Park skin, dark theme"> | <img src="docs/images/themepark-light.png" alt="Theme Park skin, light theme"> |
| **Casino** | <img src="docs/images/casino-dark.png" alt="Casino skin, dark theme"> | <img src="docs/images/casino-light.png" alt="Casino skin, light theme"> |
| **Command Post** | <img src="docs/images/commandpost-dark.png" alt="Command Post skin, dark theme"> | <img src="docs/images/commandpost-light.png" alt="Command Post skin, light theme"> |

![Settings drawer with the skin picker and theme switch](docs/images/settings-skins.png)

### Follow terminal

When on, which is the default, the scene selects and flies to whichever workspace you focus in your terminal. It pauses for 20 seconds after you pick something yourself. Settings → General has options for this and for reduced motion.

### Without a supported terminal

Use Shufler with any terminal (Terminal.app, Ghostty, WezTerm, an editor's terminal, ssh) by picking `none` in `bin/shufler setup`, or let `auto` fall back to it when no supported terminal is found. Each running `claude` or `codex` session becomes a row, with its state, model, tokens, questions and PRs as usual; the row goes when the session exits. What needs a terminal is greyed out, with the reason in the tooltip: sending a prompt, answering a question, running a skill, sending library context, Focus, new tabs and terminal sync. Answer in the session's own window; the scene picks the answer up. Every adapter declares what it can do (`capabilities.terminal_caps` in the snapshot), so a terminal that cannot focus, say, only greys out Focus.

### Keyboard shortcuts

Press `?` in the app for the full list.

| Key | Does |
|---|---|
| `1` to `5` | Camera presets: Overview, Needs me, Pipeline, Domain, Shipped |
| `0` | Clean layers on and off |
| `P` | Pipeline board on and off |
| `I` | Big islands on and off |
| `N`, `Shift+N` | Next, previous item in Your move |
| `j`, `k` | Next, previous pipeline item |
| `D`, `Shift+D` | Next, previous domain |
| `G` | Gate of the selected item |
| `#` then digits, `Enter` | Fly to a PR by number |
| `Enter`, `F`, `O` | Fly to the selection, focus its session, open its PR |
| `L` | Context library |
| `H` | Horizon view on and off |
| `/` | Command drawer |
| `Cmd+K` | Skills palette |
| `R`, `?`, `Esc` | Reset view, help, back out one level |
| Arrows, `+`, `-` | Pan, zoom |

## Support matrix

| Area | Supported | Planned |
|---|---|---|
| OS | macOS | Linux (systemd user unit for autostart) |
| Terminal | cmux, iTerm2, tmux; any other terminal in no-terminal mode (watch only) | WezTerm |
| Agent harness | Claude Code, Codex CLI | Gemini CLI, Aider, OpenCode, other harnesses and accounts |
| Source control | GitHub through `gh` | |
| External review | A reviewer bot, by GitHub login and an optional watcher command | |
| Work items | Intake records, area ledgers, a board CLI (all optional) | |
| Custom commands | Any argv you configure, with a form and a confirm step | |
| Skins | Starship, Factory, Sky Islands, Theme Park, Casino, Command Post, JSON recolours, code skins | |

Also planned: `restart`, `logs` and `doctor` commands, and starting a new session from the UI with harness, account, model and effort.

## Safety and privacy

- **Local only.** The daemon binds to `127.0.0.1`. Requests must carry a loopback `Host` header. `POST` requests and WebSockets are accepted only from the daemon's own origin.
- **Transcripts.** The daemon tails your Claude Code and Codex transcript files by byte offset. For Codex rows it also reads the last 40 lines of the screen while a turn is quiet, to spot an approval prompt; that text is not stored. The live data it keeps is tool names, counts, timestamps, PR links, working directory, token totals and a pending question. A 120-character preview of the last assistant message is included in the live snapshot.
- **Message text.** The full text of a session's recent messages is read only when you open its Conversation panel, through a single endpoint. It is not broadcast, and it is not written to history.
- **History** stores events and compacted snapshots without conversation text.
- **Actions.** Every action is validated against current state and previewed. Commands run as argument lists with a 30-second timeout, never through a shell. Each action is logged.
- **Never-do guard.** The daemon refuses `reset --hard`, force pushes, worktree removal, process kills, chat posts and outbound sends, in commands and in prompts it would send to a session. Custom commands go through the same guard. Re-triggering the reviewer bot posts a PR comment (or runs your command), and its preview says so.
- **Custom commands** run exactly the argv you configured. Shufler cannot tell a read from a write, so only configure commands you trust, and mark production ones `prod = true`.
- **Processes.** Every 10 seconds (3 in no-terminal mode) the daemon lists running `claude` and `codex` processes with `ps`, and reads each new one's working directory (`lsof`) and terminal id from its environment (`ps -E`) to match it to a row. Only those fields are kept. Turn it off with `[terminal] processes = false`, except in no-terminal mode, where the processes are the rows.
- **Levers the terminal cannot pull** (no-terminal mode, or a terminal adapter without that capability) are greyed out with the reason in their tooltip, and the daemon refuses them if called anyway. Nothing is typed, focused or opened.
- **Agent access (MCP).** `shufler mcp` gives your agents the floor's facts and, through `read_session`, other sessions' recent messages. Text from one session can carry instructions aimed at another (prompt injection), so treat it as data. The dispatch tools that type into other sessions are off unless you set `[mcp] allow_dispatch = true`; they preview first, send only on a second `confirm_dispatch` call, refuse never-do text, control characters and a session prompting itself, and are rate-limited. Keep `confirm_dispatch` off your harness's auto-allow list so you approve each send. The threat model is in [`docs/MCP.md`](docs/MCP.md).
- **Built-in terminals** are real shells on your machine: at most 6, closed after 2 hours idle. Keystrokes are never logged. Presets type a command but never press Enter.

Do not expose port 4700 beyond your machine.

## Architecture

```
 terminal (cmux,      agent transcripts      GitHub (gh)     optional: reviewer,
 iTerm2, tmux)        ~/.claude/projects     PRs, runs       work items, commands
                      ~/.codex/sessions
      \                     |                    /                /
       +------- adapters (one small Protocol per kind) -----------+
                            |
        daemon: FastAPI + uvicorn on 127.0.0.1:4700
        collectors -> snapshot -> world layout -> history (SQLite)
                            |
                 GET /api/snapshot   /ws   POST /api/actions
                            |
        web: Vite + React + react-three-fiber + zustand
        skins (Starship, Factory, Sky Islands, Theme Park, Casino, Command Post) draw the scene
```

- **Daemon** (`daemon/shufler/`). Python 3.11 or newer. Collectors poll each source on its own interval in worker threads. One failing source shows as an error on that source and never stops the rest. The snapshot is built by pure functions, so tests use fixtures. The WebSocket sends the full snapshot on connect, then on every change.
- **Web** (`web/`). React 18, TypeScript in strict mode, `three` with react-three-fiber, drei and postprocessing, zustand and xterm.js. Everything is bundled and the geometry is procedural, so there are no runtime CDN requests.
- **Adapters** (`daemon/shufler/adapters/`). One Protocol per kind: terminal, agent, scm, review, tracker. Command builders are pure and return argv. When an optional adapter is off, the snapshot's `capabilities` says so and the web hides its levers.
- **Contract.** [`CONTRACT.md`](CONTRACT.md) is the snapshot and action schema shared by the daemon and the web.

## CLI reference

A packaged install runs these as `shufler <command>`; from a clone they are `bin/shufler <command>`. `dev` and `test` exist only in a clone, and `serve` only in the packaged command.

| Command | Does |
|---|---|
| `bin/shufler init [--force]` | Copy the example config to `~/.config/shufler/config.toml`. Will not overwrite without `--force` |
| `bin/shufler setup` | Pick your terminal and its options, and the agent harnesses, and write them to the config (`--yes`, `--terminal <kind>`, `--agents auto\|claude,codex`) |
| `bin/shufler start` | Run the daemon in the background (or through launchd if installed) and wait until healthy. It serves `web/dist`, or the copy inside the package |
| `bin/shufler stop` | Stop the daemon |
| `bin/shufler status` | Show the process, health, the agent harnesses watched, and each source's age and error |
| `bin/shufler dev` | Daemon with `--reload` plus `bun run dev`. Allows the `:5173` origin |
| `bin/shufler install` | Install and load a launchd agent that starts at login |
| `bin/shufler uninstall` | Unload and remove it |
| `shufler serve [--port N]` | Run the daemon in the foreground, for launchd and `brew services` |
| `bin/shufler test [args]` | Run the daemon tests with pytest |
| `bin/shufler library ...` | Manage the context library: `add`, `list`, `grant`, `send` |
| `bin/shufler mcp` | Run the MCP server on stdio for your agents. `--print-config` prints the Claude Code and Codex setup. See [`docs/MCP.md`](docs/MCP.md) |
| `bin/shufler version` | Print the version |

## Development

```bash
bin/shufler dev                           # daemon with reload + Vite at http://localhost:5173

cd daemon && uv run pytest -q                # daemon tests (or: bin/shufler test)
cd web && npx tsc --noEmit && npx vitest run # typecheck and web tests
cd web && bun run build                      # typecheck, then build web/dist
packaging/release.sh                         # build the release sdist, wheel and Homebrew formula into dist/
```

The web app does not rebuild by itself under `start`. After changing `web/`, run `bun run build` again.

## Extending

Shufler is built to be extended. Every outside tool it talks to sits behind a small adapter, so supporting a new terminal, agent harness or code host means adding one adapter, not changing the core. Some extension points have a documented framework today, and others are planned. Contributions are welcome in all of them.

| Extension point | Works today | Planned or wanted | How to add one |
|---|---|---|---|
| **Terminals** | cmux, iTerm2, tmux; no-terminal mode for any other | Ghostty, WezTerm, Kitty, Warp, Terminal.app, Linux and Windows terminals | One adapter file plus a registry entry, or a plug-in package. See [`docs/TERMINALS.md`](docs/TERMINALS.md) |
| **Agent harnesses** | Claude Code, Codex CLI | Gemini CLI, Aider, OpenCode and other coding agents | An agent adapter under `daemon/shufler/adapters/agent/` that finds sessions and reads transcripts, or a plug-in package. See [`docs/AGENTS.md`](docs/AGENTS.md) |
| **Skins** | Starship, Factory, Sky Islands, Theme Park, Casino, Command Post | Community skins | A JSON recolour, or a code skin folder. See [`docs/SKINS.md`](docs/SKINS.md) |
| **Code hosts and CI** | GitHub (`gh`) | GitLab, Bitbucket, other CI systems | An SCM adapter under `daemon/shufler/adapters/scm/`. Guide to come |
| **Review bots** | Any bot that comments on PRs, set up in `[reviewer]` | Ready-made presets for common review bots | Config only today |
| **Trackers and boards** | Intake files, a board CLI, area ledgers | Linear, Jira, GitHub Issues | Tracker adapters under `daemon/shufler/adapters/tracker/`. Guide to come |
| **Custom commands** | Any command you define in `[[commands]]` | Shared command packs | Config only |
| **Agent access (MCP)** | Read-only tools, plus opt-in dispatch with a confirm step | A foreman agent that watches the floor | A tool in `daemon/shufler/mcp_server.py`, built on the daemon's HTTP API. See [`docs/MCP.md`](docs/MCP.md) |

To add an adapter today: put a module beside the existing ones, implement its Protocol, register it, add its keys to `daemon/config.example.toml`, and write tests against fixture output. See [`CONTRIBUTING.md`](CONTRIBUTING.md). If you want to build one of the planned items, open an issue first so we can agree on the shape.

## Roadmap

Ideas that are not built yet. Some are close, some are a wish list. If one matters to you, open an issue or pick it up.

**Agents**
- **A foreman agent.** One agent that watches the whole floor through the MCP tools and nudges sessions that are stuck or waiting on something, with every nudge still going through the confirm step. Not built yet.
- **More agent harnesses:** Gemini CLI, Aider, OpenCode.

**Terminals**
- **More terminals:** Ghostty, WezTerm, Kitty, Warp, Terminal.app, plus Linux and Windows.
- **Autostart for cmux users.** cmux only accepts connections from programs started inside it, so start-at-login does not reach it yet.

**The world**
- **Casino card ranks** tied to the actual PR or issue.
- **Community skins** and a skin gallery.

**Integrations**
- GitLab and Bitbucket, and CI systems beyond GitHub checks.
- Linear, Jira and GitHub Issues as work sources.
- Presets for common PR review bots.

## Contributing

Issues and pull requests are welcome; questions and ideas can go to [Discussions](https://github.com/jgrichardson/shufler/discussions). Issues labelled [`good first issue`](https://github.com/jgrichardson/shufler/labels/good%20first%20issue) are small and self-contained. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. In short: the daemon binds to loopback only, no action may be destructive, and `CONTRACT.md` changes first when a field changes. Security reports go through [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
