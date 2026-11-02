# Extending Shufler

Shufler loads plugins from ordinary Python packages through
[entry points](https://packaging.python.org/en/latest/specifications/entry-points/). Install a package into the
same Python environment as Shufler, restart the daemon, and the terminal, agent harness or issue tracker it
provides is there. Nothing in Shufler itself changes, and you never fork it.

| Entry point group | A package can add | Guide |
|---|---|---|
| `shufler.terminals` | A terminal whose panes host agent sessions: a `[terminal] kind` | [`TERMINALS.md`](TERMINALS.md#writing-a-terminal-adapter) |
| `shufler.agents` | A coding agent harness: an id for `[agents] enabled` | [`AGENTS.md`](AGENTS.md#writing-a-harness-adapter) |
| `shufler.issue_sources` | An issue tracker: a `kind` for `[[issues.sources]]` | This page, below |

Two more are planned and not built yet: `shufler.skin_packs`, for skins built outside this repository and loaded
by the web app at run time, and `shufler.extensions`, for extra snapshot sections, actions and read-only routes.
This page will cover them when they land.

## How plugins load

In each group, the entry point's name is the kind (or harness id) and its value is `"package.module:Class"`.
The daemon reads the groups when it starts, so install or remove a plugin and then restart it.

- **Built-ins first.** When a plugin registers a name Shufler already has (`github`, `cmux`, `claude`), the
  built-in keeps it. Between two plugins, the first one loaded wins. For issue sources the daemon logs a
  warning naming the one it skipped.
- **A broken plugin does not stop the daemon.** If a plugin fails to import, its kind is missing and the rest
  keeps running. For issue sources, an entry that uses that kind reports the import error in source health.
- **Config mistakes show in source health.** An `[[issues.sources]]` entry with an unknown `kind`, a duplicate
  `name` or a missing key appears as a failing source `issues.<name>` with the reason, on the floor's source
  list and in `GET /api/health`.

Where to install:

| Install | Add a plugin with |
|---|---|
| `pipx` | `pipx inject shufler my-shufler-plugin` |
| `uv tool` | `uv tool install shufler --with my-shufler-plugin` |
| Homebrew | `$(brew --prefix shufler)/libexec/venv/bin/python -m pip install my-shufler-plugin`; an upgrade rebuilds that environment, so install it again afterwards |
| A clone | `cd daemon && uv pip install -e ../../my-shufler-plugin` |

## Safety

A plugin is code you install and run as yourself, like any Python package, so install only plugins you trust.
Inside the daemon it works under the same rules as the built-in code:

- **Actions go through the same path.** A plugin plans commands; the daemon previews them, applies the
  never-do guard, asks for your confirm and logs them to `actions.jsonl`. Write-back planners on an issue source
  return an argv list or a request description and never run anything themselves.
- **No shell.** Commands are argv lists run through `shufler.runner` with a timeout.
- **Nothing leaves your machine that you did not configure.** The Shufler core never phones home: no telemetry,
  no update check, no license check. The only outside calls are the ones your configuration asks for, such as
  `gh` to GitHub or a tracker's API for an issue source you added. A plugin should hold to the same rule and say
  in its README which hosts it calls and when.
- **Secrets stay in the daemon.** A tracker token comes from an environment variable or the macOS Keychain and
  must never reach the snapshot, `/api/config`, logs or the MCP server.

## Issue sources

An issue source brings one tracker's issues onto the board. GitHub Issues is built in (`kind = "github"`); a
plugin adds others. Each `[[issues.sources]]` entry in `config.toml` builds one source:

```toml
[issues]
interval = 60                 # seconds between reads of each source; at least 30

[[issues.sources]]
kind = "github"               # built in: your gh login, no token
repo = "acme/widgets"         # default: [scm] repo
filter = "assignee:@me"       # GitHub search syntax

[[issues.sources]]
kind = "acme"                 # provided by a plugin
name = "acme"                 # health key issues.acme; default: the class's default_name, else the kind
team = "ENG"                  # the plugin's own keys
token_env = "ACME_TRACKER_TOKEN"
```

In v0.4 the daemon reads each source on its interval and reports its health as `issues.<name>`; the inbox
that shows the issues on the board comes in a later release.

### The contract

The protocol is `IssueSource` in `daemon/shufler/adapters/tracker/issues.py`.

| Member | What it does |
|---|---|
| `kind`, `name` | The kind it registers as, and this entry's name (the loader resolves it and passes it in) |
| `from_config(entry, cfg)` | Classmethod. `entry` is the `[[issues.sources]]` table with `name` filled in; `cfg` is the whole config. Raise `ValueError` for a missing or bad key: the message shows in source health |
| `collect()` | Returns a list of `Issue`. Runs on the interval in a collector thread. Raise to mark the source failing; it keeps its last good data |
| `body(key)` | Returns one issue's body text. Called only when someone opens or starts the issue, never for the snapshot |
| `comment(key, text)` | Optional. Plans a comment: returns an argv list, or a request dict `{method, url, body}` for an HTTP API. Runs nothing |
| `transition(key, state)` | Optional. Plans a state change the same way |

`Issue` is a frozen dataclass with `source` (the source's `name`), `key` (the tracker's id, such as `42` or
`ENG-123`), `title`, `url`, `state` (lower case), `assignee`, `priority` (the tracker's own label, or `None`),
`labels` (a tuple) and `updated_at` (ISO 8601). It leaves the body out on purpose: issue text can be long, and
anyone who can file an issue wrote it, so it is untrusted and stays out of the snapshot.

### A minimal plugin

```
my-shufler-plugin/
  pyproject.toml
  acme_tracker/__init__.py
```

```toml
# pyproject.toml
[project]
name = "my-shufler-plugin"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["shufler>=0.4,<0.5"]

[project.entry-points."shufler.issue_sources"]
acme = "acme_tracker:AcmeTracker"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

```python
# acme_tracker/__init__.py
import json
import os
import urllib.request

from shufler.adapters.tracker import Issue

API = "https://tracker.example.com/api"


class AcmeTracker:
    kind = "acme"
    default_name = "acme"

    def __init__(self, name: str, team: str, token: str):
        self.name, self.team, self._token = name, team, token

    @classmethod
    def from_config(cls, entry: dict, cfg: dict) -> "AcmeTracker":
        token = os.environ.get(entry.get("token_env") or "", "")
        if not entry.get("team") or not token:
            raise ValueError("needs team and a token in the variable named by token_env")
        return cls(entry["name"], entry["team"], token)

    def _get(self, path: str) -> dict:
        req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {self._token}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    def collect(self) -> list[Issue]:
        return [Issue(source=self.name, key=i["id"], title=i["title"], url=i["url"], state=i["state"].lower(),
                      assignee=i.get("assignee"), priority=i.get("priority"), labels=tuple(i.get("labels", [])),
                      updated_at=i.get("updated"))
                for i in self._get(f"/teams/{self.team}/issues?assignee=me")["issues"]]

    def body(self, key: str) -> str:
        return self._get(f"/issues/{key}")["body"]
```

Then `pipx inject shufler ./my-shufler-plugin` (or the line for your install above), add an
`[[issues.sources]]` entry with `kind = "acme"`, and restart the daemon. `issues.acme` appears in source health.

### Testing

Test without the network. Build the source from a dict with `from_config`, monkeypatch `shufler.runner.run`
(for a CLI) or your HTTP call, and check what `collect()` returns. To check registration, monkeypatch
`importlib.metadata.entry_points` and call `shufler.adapters.tracker.load_sources(cfg)`.
`daemon/tests/test_issue_sources.py` has worked examples, including the GitHub source with `gh` mocked.
