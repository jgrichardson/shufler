"""Skills in the snapshot: discovered skills merged with config.toml [skills]."""

from __future__ import annotations

from pathlib import Path

from . import config
from .adapters.agent.skills import repo_root


def scan(index, cwds: set[str]) -> dict:
    roots = {}
    for cwd in cwds:
        r = repo_root(cwd)
        if r:
            roots[cwd] = str(r)
    return {
        "global": index.user_and_plugin(),
        "roots": roots,
        "projects": {r: index.project(Path(r)) for r in sorted(set(roots.values()))},
    }


def _decorate(sk: dict) -> dict:
    names = (sk["name"], *sk.get("aliases", ()))
    s = next((config.SKILL_SETTINGS[n] for n in names if n in config.SKILL_SETTINGS), {})
    return {**sk, "exposed": any(n in config.SKILLS_EXPOSE for n in names), "pinned": bool(s.get("pin")),
            "target": s.get("target"), "args_template": s.get("args_template"),
            "confirm": s.get("confirm") if s.get("confirm") in config.SKILL_CONFIRM_LEVELS else "tap",
            "placement": s.get("placement") if s.get("placement") in config.SKILL_PLACEMENTS else "station"}


def attach(snap: dict, data: dict) -> dict:
    raw = data.get("skills") or {}
    hidden = set(config.SKILLS_HIDE)
    merged: dict[str, dict] = {}
    for sk in raw.get("global") or []:
        merged.setdefault(sk["name"], sk)
    for skills in (raw.get("projects") or {}).values():
        for sk in skills:
            merged.setdefault(sk["name"], sk)
    # A plugin skill also answers to its bare name when that name is unique and not taken.
    shorts: dict[str, list[str]] = {}
    for name, sk in merged.items():
        if ":" in name and sk.get("scope") == "plugin":
            shorts.setdefault(name.rsplit(":", 1)[1], []).append(name)
    for short, fulls in shorts.items():
        if len(fulls) == 1 and short not in merged:
            merged[fulls[0]] = {**merged[fulls[0]], "aliases": [short]}
    known = set(merged) | {a for sk in merged.values() for a in sk.get("aliases", ())}
    # Configured names that are not files on disk (built-in commands such as /code-review) still get an entry.
    for name in [*config.SKILLS_EXPOSE, *(n for n, v in config.SKILL_SETTINGS.items() if v.get("pin"))]:
        if name not in known:
            merged[name] = {"name": name, "slash": f"/{name}", "description": "", "scope": "configured",
                            "args_hint": None, "source_path": None}
            known.add(name)
    snap["skills"] = [_decorate(sk) for name, sk in sorted(merged.items()) if name not in hidden]
    global_names = {n for sk in snap["skills"] if sk["scope"] in ("user", "plugin", "configured")
                    for n in (sk["name"], *sk.get("aliases", ()))} - hidden
    roots, projects = raw.get("roots") or {}, raw.get("projects") or {}
    for st in snap.get("stations", []):
        root = roots.get(st.get("cwd") or "")
        names = global_names | ({sk["name"] for sk in projects.get(root, [])} - hidden if root else set())
        st["skill_names"] = sorted(names)
    return snap
