"""The installed `shufler` command (shufler.cli): dispatch, init, and the launchd plist it writes."""

from __future__ import annotations

from pathlib import Path

from shufler import cli


def test_version_and_help(capsys):
    assert cli.main(["version"]) == 0
    assert capsys.readouterr().out.startswith("shufler ")
    assert cli.main(["--help"]) == 0
    out = capsys.readouterr().out
    for cmd in ("init", "setup", "start", "stop", "status", "serve", "install", "library", "mcp", "version"):
        assert cmd in out


def test_unknown_command_prints_usage_and_fails(capsys):
    assert cli.main(["bogus"]) == 2
    assert "usage: shufler" in capsys.readouterr().err


def test_init_copies_the_example_once(tmp_path, monkeypatch, capsys):
    target = tmp_path / "cfg" / "config.toml"
    monkeypatch.setenv("SHUFLER_CONFIG", str(target))
    assert cli.main(["init"]) == 0
    assert "[terminal]" in target.read_text()
    target.write_text("# mine\n")
    cli.main(["init"])
    assert target.read_text() == "# mine\n"
    assert "already exists" in capsys.readouterr().out
    cli.main(["init", "--force"])
    assert "[terminal]" in target.read_text()


def test_daemon_argv_carries_the_app_marker():
    argv = cli.daemon_argv(4781)
    assert cli.APP in argv and argv[-2:] == ["--port", "4781"]


def test_plist_runs_serve_on_the_port(monkeypatch):
    monkeypatch.setattr(cli, "launcher", lambda: ["/opt/homebrew/bin/shufler"])
    xml = cli.plist_xml()
    assert "<string>/opt/homebrew/bin/shufler</string>\n    <string>serve</string>" in xml
    assert f"<string>{cli.PORT}</string>" in xml
    assert f"<key>Label</key><string>{cli.LABEL}</string>" in xml


def test_launcher_prefers_the_command_it_ran_as(tmp_path, monkeypatch):
    exe = tmp_path / "shufler"
    exe.write_text("#!/bin/sh\n")
    monkeypatch.setattr(cli.sys, "argv", [str(exe), "install"])
    assert cli.launcher() == [str(exe)]
    monkeypatch.setattr(cli.sys, "argv", [str(tmp_path / "__main__.py")])
    assert cli.launcher()[1:] == ["-m", "shufler"]


def test_launchd_job_only_counts_with_a_plist_in_this_home(tmp_path, monkeypatch):
    # Another HOME (a test run, a second install) must never unload the user's real login item.
    monkeypatch.setattr(cli, "PLIST", tmp_path / "missing.plist")
    called = []
    monkeypatch.setattr(cli, "quiet", lambda argv: called.append(argv))
    assert cli.launchd_loaded() is False
    assert called == []


def test_serve_execs_uvicorn(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli.os, "execv", lambda path, argv: seen.update(path=path, argv=argv))
    cli.main(["serve", "--port", "4782"])
    assert Path(seen["path"]).name.startswith("python") and seen["argv"][-1] == "4782"


def test_mcp_print_config(capsys):
    assert cli.main(["mcp", "--print-config"]) == 0
    out = capsys.readouterr().out
    assert "claude mcp add" in out and "[mcp_servers." in out and 'args = ["mcp"]' in out


def test_setup_lists_the_none_terminal(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SHUFLER_CONFIG", str(tmp_path / "config.toml"))
    assert cli.main(["setup", "--terminal", "none"]) == 0
    assert 'kind = "none"' in (tmp_path / "config.toml").read_text()
    assert "none" in cli.usage()
