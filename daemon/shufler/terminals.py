"""PTY terminals for the web Terminal panel (CONTRACT.md "Terminal panel").

Each terminal runs the user's login shell. Presets (config.toml
[terminals.presets.*]) only type text into the input line without a newline;
the user presses Enter. Keystrokes are never logged.
"""

from __future__ import annotations

import asyncio
import fcntl
import os
import secrets
import shlex
import signal
import struct
import termios
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import config

MAX_TERMINALS = config.MAX_TERMINALS
IDLE_CLOSE_S = config.TERMINAL_IDLE_S
SCROLLBACK = 256 * 1024
PRESETS = config.TERMINAL_PRESETS
SCRUB_ENV = ("CMUX_WORKSPACE_ID", "CMUX_SURFACE_ID", "CMUX_PANEL_ID", "CMUX_TAB_ID", "ITERM_SESSION_ID",
             "TMUX", "TMUX_PANE", "CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")


class TerminalError(ValueError):
    pass


@dataclass
class Terminal:
    id: str
    pid: int
    fd: int
    cwd: str
    preset: str | None
    prefill: str
    station_id: str | None
    created_at: float = field(default_factory=time.time)
    last_io: float = field(default_factory=time.time)
    scrollback: bytearray = field(default_factory=bytearray)
    sockets: set = field(default_factory=set)
    alive: bool = True

    def info(self) -> dict:
        return {"id": self.id, "pid": self.pid, "cwd": self.cwd, "preset": self.preset, "prefill": self.prefill,
                "station_id": self.station_id, "created_at": self.created_at, "last_io": self.last_io,
                "alive": self.alive, "ws_url": f"/term/{self.id}",
                "prod": self.preset == "prod_console" or bool((PRESETS.get(self.preset or "") or {}).get("prod"))}


def resolve_preset(preset: str | None, station: dict | None, cwd: str | None, pr: int | None) -> tuple[str, str]:
    """Return (cwd, prefill) for a preset; raise TerminalError when it cannot be honoured."""
    home = Path.home().resolve()

    def checked(path: str | Path) -> str:
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise TerminalError(f"directory does not exist: {p}")
        if not p.is_relative_to(home):
            raise TerminalError("terminals open under your home directory only")
        return str(p)

    station_cwd = (station or {}).get("cwd")
    if preset in (None, "", "shell_here"):
        return checked(cwd or station_cwd or home), ""
    spec = PRESETS.get(preset) if isinstance(preset, str) else None
    if not spec or not spec.get("command"):
        raise TerminalError(f"unknown or unconfigured preset: {preset!r}")
    command = spec["command"]
    if "{pr}" in command:
        if not pr:
            raise TerminalError(f"{preset} needs a PR number")
        command = command.replace("{pr}", str(int(pr)))
    target = spec.get("cwd") or cwd or station_cwd
    if not target:
        raise TerminalError(f"{preset} needs a station or cwd")
    return checked(target), command


class TerminalManager:
    def __init__(self, log=None):
        self.terms: dict[str, Terminal] = {}
        self.log = log or (lambda *a: None)

    def list(self) -> list[dict]:
        return [t.info() for t in self.terms.values()]

    def spawn(self, cwd: str, prefill: str = "", preset: str | None = None, station_id: str | None = None) -> Terminal:
        live = [t for t in self.terms.values() if t.alive]
        if len(live) >= MAX_TERMINALS:
            raise TerminalError(f"at most {MAX_TERMINALS} terminals; close one first")
        shell = os.environ.get("SHELL") or "/bin/zsh"
        env = {k: v for k, v in os.environ.items() if k not in SCRUB_ENV}
        # <ENV_PREFIX>TERMINAL marks a web terminal (shell rcs can test for it)
        env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", f"{config.ENV_PREFIX}TERMINAL": "1"})
        pid, fd = os.forkpty()
        if pid == 0:  # child
            try:
                os.chdir(cwd)
                os.execvpe(shell, [shell, "-l"], env)
            finally:
                os._exit(127)
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        term = Terminal(id=secrets.token_hex(6), pid=pid, fd=fd, cwd=cwd, preset=preset, prefill=prefill,
                        station_id=station_id)
        self.terms[term.id] = term
        loop = asyncio.get_running_loop()
        loop.add_reader(fd, self._on_readable, term)
        if prefill:
            loop.call_later(0.6, self.write, term.id, prefill.encode())
        self.log("terminal_open", {"id": term.id, "preset": preset, "cwd": cwd, "station_id": station_id},
                 {"ok": True, "output": f"pid {pid}", "error": None})
        return term

    def _on_readable(self, term: Terminal) -> None:
        try:
            data = os.read(term.fd, 65536)
        except BlockingIOError:
            return
        except OSError:
            data = b""
        if not data:
            self.close(term.id, reason="shell exited")
            return
        term.last_io = time.time()
        term.scrollback += data
        if len(term.scrollback) > SCROLLBACK:
            del term.scrollback[: len(term.scrollback) - SCROLLBACK]
        for ws in list(term.sockets):
            asyncio.ensure_future(self._send(term, ws, data))

    async def _send(self, term: Terminal, ws, data: bytes) -> None:
        try:
            await ws.send_bytes(data)
        except Exception:  # noqa: BLE001
            term.sockets.discard(ws)

    def write(self, term_id: str, data: bytes) -> None:
        term = self.terms.get(term_id)
        if not term or not term.alive:
            return
        term.last_io = time.time()
        try:
            os.write(term.fd, data)
        except OSError:
            self.close(term_id, reason="write failed")

    def resize(self, term_id: str, cols: int, rows: int) -> None:
        term = self.terms.get(term_id)
        if not term or not term.alive:
            return
        cols, rows = max(10, min(int(cols), 500)), max(2, min(int(rows), 200))
        fcntl.ioctl(term.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def close(self, term_id: str, reason: str = "closed") -> bool:
        term = self.terms.pop(term_id, None)
        if not term:
            return False
        term.alive = False
        try:
            asyncio.get_running_loop().remove_reader(term.fd)
        except (RuntimeError, ValueError, OSError):
            pass
        for sig in (signal.SIGHUP, signal.SIGTERM):
            try:
                os.kill(term.pid, sig)
            except ProcessLookupError:
                break
        try:
            os.close(term.fd)
        except OSError:
            pass
        try:
            os.waitpid(term.pid, os.WNOHANG)
        except ChildProcessError:
            pass
        for ws in list(term.sockets):
            asyncio.ensure_future(_close_ws(ws))
        self.log("terminal_close", {"id": term_id, "reason": reason}, {"ok": True, "output": "", "error": None})
        return True

    def reap(self, now: float | None = None) -> None:
        now = now or time.time()
        for tid, term in list(self.terms.items()):
            if now - term.last_io > IDLE_CLOSE_S:
                self.close(tid, reason="idle 2h")
                continue
            try:
                done, _ = os.waitpid(term.pid, os.WNOHANG)
            except ChildProcessError:
                done = term.pid
            if done:
                self.close(tid, reason="shell exited")

    def close_all(self) -> None:
        for tid in list(self.terms):
            self.close(tid, reason="daemon stopping")


async def _close_ws(ws) -> None:
    try:
        await ws.close(code=1000)
    except Exception:  # noqa: BLE001
        pass


def describe(cwd: str, prefill: str) -> str:
    shell = os.environ.get("SHELL") or "/bin/zsh"
    line = f"cd {shlex.quote(cwd)} && {shell} -l"
    return line + (f"   (typed, not run: {prefill})" if prefill else "")
