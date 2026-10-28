"""`shufler`: the command an installed Shufler (pipx, uv tool, Homebrew) puts on PATH.

The same commands as bin/shufler, for installs without a checkout: nothing to sync or build, and the daemon runs
on this package's own interpreter. bin/shufler stays the command in a clone (it adds `dev` and `test`).

    shufler init [--force] | setup [...] | start | stop | status | serve [--port N]
            | install | uninstall | library ... | mcp [--print-config] | version
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from importlib import metadata
from pathlib import Path

# Kept in step with config.py and bin/shufler; config.py is not imported here because loading it reads the
# config file, and `setup` must be able to create that file first.
NAME = "shufler"
ENV_PREFIX = "SHUFLER_"
HOST = "127.0.0.1"
APP = f"{NAME}.app:app"


def setting(key: str, default: str) -> str:
    return os.environ.get(ENV_PREFIX + key) or default


HOME = Path.home()
PORT = int(setting("PORT", "4700"))
LABEL = setting("LAUNCHD_LABEL", f"dev.{NAME}.daemon")
PLIST = HOME / "Library" / "LaunchAgents" / f"{LABEL}.plist"
STATE = HOME / ".cache" / NAME
LOG = HOME / "Library" / "Logs" / f"{NAME}.log" if sys.platform == "darwin" else STATE / f"{NAME}.log"
PIDFILE = STATE / "daemon.pid"
DOMAIN = f"gui/{os.getuid()}"


def version() -> str:
    try:
        return metadata.version(NAME)
    except metadata.PackageNotFoundError:
        return "unknown"


def config_target() -> Path:
    return Path(setting("CONFIG", str(HOME / ".config" / NAME / "config.toml"))).expanduser()


def daemon_argv(port: int = PORT) -> list[str]:
    """uvicorn on this interpreter; the command line carries APP, which is how stop and status know it is ours."""
    return [sys.executable, "-m", "uvicorn", APP, "--host", HOST, "--port", str(port)]


def quiet(argv: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(argv, 127, "", str(e))


def healthy(port: int = PORT) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/health", timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def wait_healthy() -> bool:
    for _ in range(40):
        if healthy():
            return True
        time.sleep(0.25)
    return False


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def read_pid() -> int | None:
    try:
        return int(PIDFILE.read_text().strip())
    except (OSError, ValueError):
        return None


def is_daemon(pid: int) -> bool:
    return APP in quiet(["ps", "-ww", "-o", "command=", "-p", str(pid)]).stdout


def port_daemon_pid() -> int | None:
    """The pid listening on our port, but only when it is this daemon."""
    out = quiet(["lsof", "-nP", "-t", f"-iTCP:{PORT}", "-sTCP:LISTEN"]).stdout.split()
    pid = int(out[0]) if out and out[0].isdigit() else None
    return pid if pid and is_daemon(pid) else None


def launchd_loaded() -> bool:
    # Only a job whose plist lives in this $HOME counts, so a second copy (another HOME, a test run) never
    # unloads the one the user installed.
    return sys.platform == "darwin" and PLIST.is_file() and quiet(["launchctl", "print", f"{DOMAIN}/{LABEL}"]).returncode == 0


def launcher() -> list[str]:
    """How launchd should start `shufler serve`: the `shufler` this ran as, unresolved (Homebrew's
    /opt/homebrew/bin/shufler stays put across upgrades), else this interpreter."""
    exe = Path(sys.argv[0]).absolute()
    return [str(exe)] if exe.name == NAME and exe.is_file() else [sys.executable, "-m", NAME]


def cmd_init(args: list[str]) -> int:
    from .setup_cli import EXAMPLE

    target = config_target()
    if target.exists() and "--force" not in args:
        print(f"config already exists: {target} ({NAME} init --force overwrites it)")
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXAMPLE, target)
    print(f"wrote {target}")
    print(f"edit it (uncomment the adapters you use), pick your terminal with '{NAME} setup', then: {NAME} start")
    return 0


def cmd_setup(args: list[str]) -> int:
    """Pick the terminal (cmux, iTerm2, tmux, ...) and write it to the config; --terminal KIND / --yes for scripts."""
    from . import setup_cli

    return setup_cli.main(["setup", "--config", str(config_target()), *args])


def cmd_serve(args: list[str]) -> int:
    """Run the daemon in the foreground (for launchd and `brew services`); replaces this process."""
    port = int(args[args.index("--port") + 1]) if "--port" in args else PORT
    argv = daemon_argv(port)
    os.execv(argv[0], argv)
    return 0  # not reached


def cmd_start(args: list[str]) -> int:
    if healthy():
        print(f"{NAME}: already running on http://{HOST}:{PORT}")
        return 0
    STATE.mkdir(parents=True, exist_ok=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if not config_target().exists():
        print(f"{NAME}: no config yet; choosing a terminal first")
        rc = cmd_setup([] if sys.stdin.isatty() else ["--yes"])
        if rc:
            return rc
    if sys.platform == "darwin" and PLIST.is_file():
        if not launchd_loaded():
            quiet(["launchctl", "bootstrap", DOMAIN, str(PLIST)])
        quiet(["launchctl", "kickstart", f"{DOMAIN}/{LABEL}"])
    else:
        with open(LOG, "ab") as log:
            p = subprocess.Popen(daemon_argv(), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 cwd=STATE, start_new_session=True)
        PIDFILE.write_text(str(p.pid))
    if wait_healthy():
        print(f"{NAME}: running on http://{HOST}:{PORT} (log {LOG})")
        return 0
    print(f"{NAME}: did not become healthy; see {LOG}", file=sys.stderr)
    return 1


def stop_pid(pid: int) -> None:
    try:
        os.kill(pid, 15)
    except OSError:
        return
    for _ in range(40):
        if not pid_alive(pid):
            break
        time.sleep(0.25)
    if pid_alive(pid):
        print(f"{NAME}: pid {pid} still shutting down", file=sys.stderr)
    else:
        print(f"{NAME}: stopped pid {pid}")


def cmd_stop(args: list[str]) -> int:
    if launchd_loaded():
        if quiet(["launchctl", "bootout", f"{DOMAIN}/{LABEL}"]).returncode == 0:
            print(f"{NAME}: unloaded launchd job ({LABEL}); '{NAME} start' reloads it")
        for _ in range(40):
            if not healthy():
                break
            time.sleep(0.25)
    pid = read_pid()
    if pid is not None:
        if pid_alive(pid) and is_daemon(pid):
            stop_pid(pid)
        PIDFILE.unlink(missing_ok=True)
    # Still answering (a daemon started by hand, or a pidfile lost): stop whatever of ours holds the port.
    pid = port_daemon_pid()
    if pid:
        stop_pid(pid)
    return 0


def cmd_status(args: list[str]) -> int:
    how = "not running"
    if launchd_loaded():
        how = f"launchd ({LABEL})"
    pid = read_pid()
    if pid and pid_alive(pid):
        how = f"background pid {pid}"
    if how == "not running" and (pid := port_daemon_pid()):
        how = f"pid {pid} (not under {NAME}'s pidfile; '{NAME} stop' stops it)"
    print(f"process: {how}")
    from . import setup_cli

    try:
        setup_cli.main(["status", "--config", str(config_target())] if config_target().exists() else ["status"])
    except Exception as e:  # noqa: BLE001 - status must still report health
        print(f"terminal: {e}")
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/health", timeout=2) as r:
            d = json.load(r)
    except (OSError, ValueError):
        print(f"health:  not answering on http://{HOST}:{PORT}")
        return 1
    print(f"health:  ok  http://{HOST}:{PORT}")
    for name, s in sorted((d.get("sources") or {}).items()):
        flag = "ok " if s.get("ok") else "OFF"
        age = "" if s.get("age") is None else "%6.0fs" % s["age"]
        print("  %-12s %s %7s %s" % (name, flag, age, s.get("error") or ""))
    print(f"  ws clients: {d.get('clients')}")
    return 0


def plist_xml() -> str:
    args = "\n".join(f"    <string>{a}</string>" for a in [*launcher(), "serve", "--port", str(PORT)])
    path = f"/opt/homebrew/bin:{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{args}
  </array>
  <key>WorkingDirectory</key><string>{STATE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>{path}</string>
    <key>HOME</key><string>{HOME}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>{LOG}</string>
  <key>StandardErrorPath</key><string>{LOG}</string>
</dict>
</plist>
"""


def cmd_install(args: list[str]) -> int:
    if sys.platform != "darwin":
        print(f"{NAME}: the login item uses launchd (macOS); elsewhere run '{NAME} serve' under your service manager",
              file=sys.stderr)
        return 1
    STATE.mkdir(parents=True, exist_ok=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    pid = read_pid()
    if (pid and pid_alive(pid)) or port_daemon_pid():
        print(f"{NAME}: stopping the background daemon so launchd can own the port")
        cmd_stop([])
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_text(plist_xml())
    quiet(["launchctl", "bootout", f"{DOMAIN}/{LABEL}"])
    r = quiet(["launchctl", "bootstrap", DOMAIN, str(PLIST)])
    if r.returncode:
        print(f"{NAME}: launchctl bootstrap failed: {r.stderr.strip()}", file=sys.stderr)
        return 1
    print(f"{NAME}: installed {PLIST} and loaded it")
    return 0


def cmd_uninstall(args: list[str]) -> int:
    if launchd_loaded():
        quiet(["launchctl", "bootout", f"{DOMAIN}/{LABEL}"])
    PLIST.unlink(missing_ok=True)
    print(f"{NAME}: uninstalled {LABEL}")
    return 0


def cmd_library(args: list[str]) -> int:
    from . import library_cli

    library_cli.main(args)
    return 0


def cmd_mcp(args: list[str]) -> int:
    """stdio MCP server for agents (docs/MCP.md). stdout is the protocol channel, so nothing else prints there."""
    from . import mcp_server

    mcp_server.main(args)
    return 0


def usage() -> str:
    return f"""Shufler {version()}: A 3D control room for developers who run many AI coding agent sessions
(Claude Code and the OpenAI Codex CLI) at once.

usage: {NAME} <command>
  init [--force]        copy the example config to ~/.config/{NAME}/config.toml
  setup                 pick your terminal (cmux, iTerm2, tmux, none) and agent harnesses (--agents auto|claude,codex)
  start | stop          run or stop the daemon on http://{HOST}:{PORT}
  status                process, health, and the age of each source (terminal, agent harnesses, GitHub)
  serve [--port N]      run the daemon in the foreground (launchd, brew services)
  install | uninstall   launchd login item
  library ...           context library: add, list, grant, send
  mcp [--print-config]  MCP server on stdio so agents can ask what is running (docs/MCP.md)
  version               print the version
"""


COMMANDS = {"init": cmd_init, "setup": cmd_setup, "start": cmd_start, "stop": cmd_stop, "status": cmd_status,
            "serve": cmd_serve, "install": cmd_install, "uninstall": cmd_uninstall, "library": cmd_library,
            "mcp": cmd_mcp}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd, rest = (argv[0], argv[1:]) if argv else ("", [])
    if cmd in ("version", "-V", "--version"):
        print(f"{NAME} {version()}")
        return 0
    if cmd in ("-h", "--help", "help"):
        print(usage(), end="")
        return 0
    if cmd not in COMMANDS:
        print(usage(), end="", file=sys.stderr)
        return 2
    return COMMANDS[cmd](rest) or 0


if __name__ == "__main__":
    sys.exit(main())
