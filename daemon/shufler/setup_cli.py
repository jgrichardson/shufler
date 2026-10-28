"""`shufler setup`: pick the terminal (and agent harnesses) and write them to the config file. `shufler status`
asks them too.

    python -m shufler.setup_cli setup [--terminal KIND] [--agents auto|claude,codex] [--yes] [--set KEY=VALUE ...]
                                      [--config PATH]
    python -m shufler.setup_cli status [--config PATH]

Setup lists every registered terminal adapter with what was detected, defaults to the current choice (else the
detected one), asks for that adapter's options and writes `[terminal] kind` plus the options into the config
(creating it from config.example.toml first when missing). Re-running shows the current choice and changes it.
`--terminal` and `--yes` make it non-interactive. It also lists the agent harnesses (Claude Code, Codex) with what
was detected; `--agents` writes `[agents] enabled` (unset means auto). Nothing here touches the running daemon.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tomllib
from pathlib import Path

# Inside the package when installed from a wheel, else daemon/config.example.toml (config.py does the same).
PACKAGE_DIR = Path(__file__).resolve().parent
EXAMPLE = PACKAGE_DIR / "config.example.toml"
if not EXAMPLE.is_file():
    EXAMPLE = PACKAGE_DIR.parent / "config.example.toml"

# Per adapter: (key, question, choices or None). The default is the current value, else the adapter's default.
OPTIONS = {
    "cmux": [("bin", "cmux binary", None)],
    "iterm2": [("group_by", "Group rows by", ["window", "tab_prefix"]),
               ("prefix_separator", "Tab-title prefix separator (for tab_prefix)", None)],
    "tmux": [("rows", "One row per", ["pane", "window"]),
             ("socket_name", "tmux -L socket name (blank = the default server)", None)],
}


def default_config_path() -> Path:
    v = os.environ.get("SHUFLER_CONFIG")
    if v:
        return Path(v).expanduser()
    return Path.home() / ".config" / "shufler" / "config.toml"


def _ask(question: str, default: str, choices: list[str] | None, inp=input, out=print) -> str:
    hint = f" ({'/'.join(choices)})" if choices else ""
    while True:
        try:
            raw = inp(f"{question}{hint} [{default}]: ").strip()
        except EOFError:
            raw = ""
        value = raw or default
        if not choices or value in choices:
            return value
        out(f"  pick one of: {', '.join(choices)}")


def current_kind(cfg: dict) -> str | None:
    t = cfg.get("terminal") or {}
    k = t.get("kind")
    return str(k).lower() if k else None


def adapter_option(cfg: dict, kind: str, key: str, default: str) -> str:
    if kind == "cmux" and key == "bin":
        return str((cfg.get("cmux") or {}).get("bin") or default)
    v = (cfg.get(kind) or {}).get(key)
    return default if v is None else str(v)


def write_choice(path: Path, kind: str, options: dict[str, str], agents: list[str] | str | None = None) -> None:
    import tomlkit

    doc = tomlkit.parse(path.read_text())
    if agents is not None:
        if "agents" not in doc:
            doc["agents"] = tomlkit.table()
        doc["agents"]["enabled"] = agents
    if "terminal" not in doc:
        doc["terminal"] = tomlkit.table()
    term = doc["terminal"]
    term["kind"] = kind
    for key, value in options.items():
        if kind not in doc:
            doc[kind] = tomlkit.table()
        doc[kind][key] = value
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(tomlkit.dumps(doc))
    tmp.replace(path)


def agent_lines(cfg: dict, out=print) -> list[str]:
    """Print the registered agent harnesses with detection and which run; returns their ids."""
    from .adapters.agent import detect_all, registered, setting

    reg = registered()
    found = detect_all(cfg)
    want = setting(cfg)
    on = [h for h in reg if (h == "claude" or found[h].installed)] if want == "auto" else [h for h in reg if h in want]
    out("Agent harnesses:" + (" (auto: Claude Code always, others when installed)" if want == "auto" else ""))
    for h, cls in reg.items():
        out(f"  {h:<8} {getattr(cls, 'label', h):<12} {found[h].detail}{'  [on]' if h in on else ''}")
    return list(reg)


def setup(argv: list[str], inp=input, out=print) -> int:
    ap = argparse.ArgumentParser(prog="shufler setup")
    ap.add_argument("--terminal", help="cmux, iterm2, tmux, none, ... (non-interactive)")
    ap.add_argument("--yes", action="store_true", help="accept the current or detected terminal and its options")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="an option for that terminal")
    ap.add_argument("--agents", help="agent harnesses: auto, or a comma list such as claude,codex")
    ap.add_argument("--config", help="config file to write (default: the one the daemon reads)")
    args = ap.parse_args(argv)

    path = Path(args.config).expanduser() if args.config else default_config_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(EXAMPLE, path)
        out(f"wrote {path} from config.example.toml")
    os.environ["SHUFLER_CONFIG"] = str(path)  # before importing anything that loads config.py
    from .adapters.terminal import auto_kind, detect_all, registered

    cfg = tomllib.loads(path.read_text())
    reg = registered()
    found = detect_all(cfg)
    detected = auto_kind(cfg)
    current = current_kind(cfg)
    interactive = not args.terminal and not args.yes

    out("Terminals:")
    names = list(reg)
    for i, kind in enumerate(names, 1):
        d = found[kind]
        tags = [t for t, on in (("current", kind == current), ("detected", kind == detected)) if on]
        label = getattr(reg[kind], "label", kind)
        out(f"  {i}. {kind:<8} {label:<8} {d.detail}{'  [' + ', '.join(tags) + ']' if tags else ''}")
    if current == "auto":
        out(f"  current setting: auto (resolves to {detected})")
    agents = agent_lines(cfg, out)

    default = current if current in reg else detected
    if args.terminal:
        kind = args.terminal.strip().lower()
    elif args.yes:
        kind = default
    else:
        while True:
            raw = _ask("Terminal", default, None, inp, out)
            kind = names[int(raw) - 1] if raw.isdigit() and 1 <= int(raw) <= len(names) else raw.lower()
            if kind in reg or kind == "auto":
                break
            out(f"  pick one of: {', '.join(names)} (or auto)")
    if kind not in reg and kind != "auto":
        out(f"unknown terminal {kind!r}; registered: {', '.join(names)}")
        return 2

    sets = {}
    for item in args.set:
        if "=" not in item:
            out(f"--set wants KEY=VALUE, got {item!r}")
            return 2
        k, v = item.split("=", 1)
        sets[k.strip()] = v
    options: dict[str, str] = {}
    if kind != "auto":
        cls = reg[kind]
        defaults = dict(getattr(cls, "CONFIG_DEFAULTS", {}) or {})
        if kind == "cmux":
            from .adapters.terminal.base import find_bin
            from .adapters.terminal.cmux import APP_BIN
            defaults["bin"] = find_bin(adapter_option(cfg, kind, "bin", ""), "cmux", APP_BIN) or "cmux"
        for key, question, choices in OPTIONS.get(kind, []):
            have = adapter_option(cfg, kind, key, str(defaults.get(key, "")))
            if key in sets:
                value = sets.pop(key)
            elif interactive:
                value = _ask(f"  {question}", have, choices, inp, out)
            else:
                value = have
            if choices and value not in choices:
                out(f"{key} must be one of {', '.join(choices)}, got {value!r}")
                return 2
            options[key] = value
        options.update(sets)  # extra keys for adapters this file does not know about
    chosen = None
    if args.agents:
        raw = args.agents.strip().lower()
        chosen = "auto" if raw == "auto" else [x.strip() for x in raw.split(",") if x.strip()]
        unknown = [x for x in chosen if x not in agents] if chosen != "auto" else []
        if unknown:
            out(f"unknown agent harness {', '.join(unknown)}; registered: {', '.join(agents)}")
            return 2
    write_choice(path, kind, options, chosen)
    shown = ", ".join(f"{k}={v!r}" for k, v in options.items())
    out(f"terminal = {kind}{' (' + shown + ')' if shown else ''} written to {path}")
    if chosen is not None:
        out(f"agents = {chosen if chosen == 'auto' else ', '.join(chosen)} written to {path}")
    if kind == "none":
        out("no terminal: one row per running claude or codex session, with state, model, tokens and PRs. Sending "
            "prompts, answering questions, running skills, Focus and new tabs are off (greyed out in the web app).")
    if kind == "iterm2":
        out("macOS asks once to let the app running Shufler control iTerm2; allow it (System Settings > "
            "Privacy & Security > Automation). `shufler status` checks it.")
    out("restart the daemon to use it: shufler stop && shufler start")
    return 0


def status(argv: list[str], out=print) -> int:
    ap = argparse.ArgumentParser(prog="shufler status")
    ap.add_argument("--config")
    args = ap.parse_args(argv)
    if args.config:
        os.environ["SHUFLER_CONFIG"] = str(Path(args.config).expanduser())
    from . import config
    from .adapters.terminal import build, caps_of

    try:
        term = build(config.TERMINAL_KIND, config.CFG)
    except Exception as e:  # noqa: BLE001
        out(f"terminal: {config.TERMINAL_KIND}: {e}")
        return 1
    how = "auto-detected" if config.TERMINAL_KIND == "auto" else "configured"
    check = getattr(term, "check", None)
    ok, detail = check() if check else (True, "no check available")
    off = [f for f, on in caps_of(term).items() if not on]
    out(f"terminal: {term.name} ({how}), {'reachable' if ok else 'NOT reachable'}: {detail}"
        + (f"; off: {', '.join(off)}" if off else ""))
    from .adapters.agent import detect_all, enabled, registered, setting
    found = detect_all(config.CFG)
    how = "auto-detected" if setting(config.CFG) == "auto" else "configured"
    on = enabled(config.CFG)
    out(f"agents: {', '.join(on) or 'none'} ({how})")
    for h in on:
        out(f"  {h}: {getattr(registered()[h], 'label', h)}, {found[h].detail}")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd, rest = (argv[0], argv[1:]) if argv else ("setup", [])
    if cmd == "setup":
        return setup(rest)
    if cmd == "status":
        return status(rest)
    print("usage: python -m shufler.setup_cli setup|status [options]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
