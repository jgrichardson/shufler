import asyncio
import time

import pytest

from shufler import terminals
from shufler.terminals import TerminalError, TerminalManager, resolve_preset


def test_resolve_presets(tmp_path, monkeypatch):
    monkeypatch.setattr(terminals.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setitem(terminals.PRESETS, "prod_console", {"cwd": str(tmp_path), "command": "./bin/console production"})
    monkeypatch.setitem(terminals.PRESETS, "preview_console",
                        {"cwd": str(tmp_path), "command": "./bin/console preview  # pick the preview for #{pr}"})
    monkeypatch.setitem(terminals.PRESETS, "empty", {"command": ""})
    station = {"cwd": str(tmp_path)}
    assert resolve_preset("shell_here", station, None, None) == (str(tmp_path.resolve()), "")
    assert resolve_preset("prod_console", None, None, None) == (str(tmp_path.resolve()), "./bin/console production")
    assert resolve_preset("preview_console", None, None, 253)[1].endswith("#253")
    assert resolve_preset("local_console", station, None, None) == (str(tmp_path.resolve()), "./bin/console")
    with pytest.raises(TerminalError, match="needs a station"):
        resolve_preset("local_console", None, None, None)
    with pytest.raises(TerminalError, match="unconfigured"):
        resolve_preset("empty", station, None, None)
    with pytest.raises(TerminalError, match="needs a PR"):
        resolve_preset("preview_console", None, None, None)
    with pytest.raises(TerminalError, match="unknown or unconfigured preset"):
        resolve_preset("rm", None, None, None)
    with pytest.raises(TerminalError, match="home directory"):
        resolve_preset(None, None, "/etc", None)
    with pytest.raises(TerminalError, match="does not exist"):
        resolve_preset(None, None, str(tmp_path / "nope"), None)


class FakeWS:
    def __init__(self):
        self.data = b""

    async def send_bytes(self, b):
        self.data += b

    async def close(self, code=1000):
        pass


def test_pty_roundtrip_prefill_and_close(tmp_path, monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")
    logged = []

    async def scenario():
        mgr = TerminalManager(log=lambda a, p, r: logged.append((a, p)))
        term = mgr.spawn(str(tmp_path), prefill="echo PREFILLED", preset="shell_here")
        ws = FakeWS()
        term.sockets.add(ws)
        await asyncio.sleep(1.0)  # prefill lands after 0.6s
        assert b"echo PREFILLED" in bytes(term.scrollback)
        mgr.write(term.id, b"\x15echo ROUND$((1+1))TRIP\n")  # ^U clears the prefilled line first
        for _ in range(40):
            await asyncio.sleep(0.05)
            if b"ROUND2TRIP" in bytes(term.scrollback):
                break
        assert b"ROUND2TRIP" in bytes(term.scrollback) and b"ROUND2TRIP" in ws.data
        assert b"PREFILLED\r\nPREFILLED" not in bytes(term.scrollback)  # prefill was never executed
        mgr.resize(term.id, 120, 40)
        assert mgr.list()[0]["preset"] == "shell_here"
        assert mgr.close(term.id) is True and mgr.list() == []
        assert mgr.close(term.id) is False

    asyncio.run(scenario())
    assert [a for a, _ in logged] == ["terminal_open", "terminal_close"]
    assert all("ROUND" not in str(p) for _, p in logged)  # keystrokes never logged


def test_max_terminals_and_idle_reap(tmp_path, monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")
    monkeypatch.setattr(terminals, "MAX_TERMINALS", 2)

    async def scenario():
        mgr = TerminalManager()
        a = mgr.spawn(str(tmp_path))
        mgr.spawn(str(tmp_path))
        with pytest.raises(TerminalError, match="at most 2"):
            mgr.spawn(str(tmp_path))
        a.last_io = time.time() - terminals.IDLE_CLOSE_S - 1
        mgr.reap()
        assert a.id not in mgr.terms and len(mgr.terms) == 1
        mgr.close_all()
        assert mgr.terms == {}

    asyncio.run(scenario())
