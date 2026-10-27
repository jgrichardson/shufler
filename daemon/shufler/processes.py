"""Running Claude Code processes (CONTRACT.md "Morning review round 9").

`ps` lists them every 10 s. For each new process one `lsof` call reads its cwd and one `ps -E` call reads the
terminal's workspace id from its environment (CMUX_WORKSPACE_ID, ITERM_SESSION_ID or TMUX_PANE); both are cached
per (pid, start time), so a steady fleet costs one `ps` per tick. The tty from `ps` is matched to the terminal's
workspace ttys in snapshot.py. Excluded: the Chrome native-messaging host and headless `claude -p` / `--print` runs
(Shufler's own)."""

from __future__ import annotations

import os
import re
import time

from . import runner

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
WS_ENV_RE = re.compile(r"(?:^|\s)CMUX_WORKSPACE_ID=([0-9A-Fa-f-]{36})(?=\s|$)")
# iTerm2 exports ITERM_SESSION_ID=w0t1p0:<session UUID>; the UUID is the iTerm2 adapter's workspace id.
ITERM_ENV_RE = re.compile(r"(?:^|\s)ITERM_SESSION_ID=[^\s:]*:([0-9A-Fa-f-]{36})(?=\s|$)")
# tmux exports TMUX_PANE=%<n>, the tmux adapter's workspace id in its default rows-per-pane mode.
TMUX_ENV_RE = re.compile(r"(?:^|\s)TMUX_PANE=(%\d+)(?=\s|$)")
EXCLUDE_FLAGS = ("--chrome-native-host", "-p", "--print")


def parse_etime(text: str) -> int | None:
    """`[[dd-]hh:]mm:ss` → seconds."""
    m = re.fullmatch(r"(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)", (text or "").strip())
    if not m:
        return None
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def _session_arg(tokens: list[str]) -> str | None:
    for flag in ("--resume", "-r", "--session-id"):
        if flag in tokens:
            i = tokens.index(flag)
            if i + 1 < len(tokens) and UUID_RE.match(tokens[i + 1]):
                return tokens[i + 1].lower()
    for t in tokens:
        for flag in ("--resume=", "--session-id="):
            if t.startswith(flag) and UUID_RE.match(t[len(flag):]):
                return t[len(flag):].lower()
    return None


def parse_ps(text: str) -> list[dict]:
    """`ps -axww -o pid=,tty=,etime=,command=` → interactive Claude Code processes."""
    out = []
    for line in text.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4 or not parts[0].isdigit():
            continue
        pid, tty, etime, command = parts
        tokens = command.split()
        if not tokens or os.path.basename(tokens[0]) != "claude":
            continue
        if any(flag in tokens for flag in EXCLUDE_FLAGS):
            continue
        name = tokens[tokens.index("--name") + 1] if "--name" in tokens[:-1] else None
        out.append({"pid": int(pid), "tty": None if tty in ("??", "-") else tty, "etime_s": parse_etime(etime),
                    "session_id": _session_arg(tokens), "name": name})
    return out


def parse_lsof_cwd(text: str) -> dict[int, str]:
    """`lsof -a -d cwd -Fn -p <pids>` → {pid: cwd}."""
    out, pid = {}, None
    for line in text.splitlines():
        if line.startswith("p") and line[1:].isdigit():
            pid = int(line[1:])
        elif line.startswith("n") and pid is not None:
            out[pid] = line[1:]
    return out


def area_env_re(name: str | None = None) -> re.Pattern:
    """`<AREA_ENV>=<area>` in a process environment ([ledgers] area_env, default LEDGER_AREA)."""
    from . import config
    name = re.escape(name or config.LEDGER_AREA_ENV)
    return re.compile(r"(?:^|\s)" + name + r"=([A-Za-z0-9_-]{1,40})(?=\s|$)")


def parse_env(text: str, area_env: str | None = None) -> dict[int, dict]:
    """`ps -E -ww -o pid=,command= -p <pids>` → {pid: {workspace_id, ledger_area}}.

    workspace_id: CMUX_WORKSPACE_ID, else the UUID in ITERM_SESSION_ID, else TMUX_PANE. ledger_area: the
    configured area env var (a session working one area ledger)."""
    out = {}
    area_re = area_env_re(area_env)
    for line in text.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            st = area_re.search(parts[1])
            ws = WS_ENV_RE.search(parts[1]) or ITERM_ENV_RE.search(parts[1]) or TMUX_ENV_RE.search(parts[1])
            out[int(parts[0])] = {"workspace_id": ws.group(1).upper() if ws else None,
                                  "ledger_area": st.group(1).lower() if st else None}
    return out


def parse_env_workspace(text: str) -> dict[int, str]:
    return {pid: e["workspace_id"] for pid, e in parse_env(text).items() if e["workspace_id"]}


class ProcessScanner:
    def __init__(self):
        self.meta: dict[tuple[int, int], dict] = {}  # (pid, start bucket) → {cwd, workspace_id}

    def __call__(self) -> list[dict]:
        now = time.time()
        r = runner.run(["ps", "-axww", "-o", "pid=,tty=,etime=,command="], timeout=10)
        if not r.ok:
            raise RuntimeError(f"ps rc={r.rc} {r.stderr.strip()[:200]}")
        procs = parse_ps(r.stdout)
        for p in procs:
            p["since"] = round(now - p["etime_s"]) if p["etime_s"] is not None else None
            p["key"] = (p["pid"], (p["since"] or 0) // 60)
        new = [p["pid"] for p in procs if p["key"] not in self.meta]
        if new:
            pids = ",".join(str(x) for x in new)
            lr = runner.run(["lsof", "-a", "-d", "cwd", "-Fn", "-p", pids], timeout=10)
            er = runner.run(["ps", "-E", "-ww", "-o", "pid=,command=", "-p", pids], timeout=10)
            cwds = parse_lsof_cwd(lr.stdout) if lr.stdout else {}
            envs = parse_env(er.stdout) if er.ok else {}
            for p in procs:
                if p["pid"] in new:
                    e = envs.get(p["pid"]) or {}
                    self.meta[p["key"]] = {"cwd": cwds.get(p["pid"]), "workspace_id": e.get("workspace_id"),
                                           "ledger_area": e.get("ledger_area")}
        live = {p["key"] for p in procs}
        self.meta = {k: v for k, v in self.meta.items() if k in live}
        return [{**{k: v for k, v in p.items() if k != "key"}, **self.meta.get(p["key"], {})} for p in procs]
