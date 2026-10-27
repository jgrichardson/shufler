"""`shufler library ...`: the context library from the shell, over the daemon's HTTP API.

  shufler library list
  shufler library add <path...> --name "Billing context" [--tags a,b] [--to domain:billing] [--once]
  shufler library grant <item> <target> [--once]
  shufler library send <item...> --to <station id, ref or title> [--note "..."]

`send` shows the daemon's preview and asks before anything is typed, like the confirm panel.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

from . import config

BASE = f"http://{config.HOST}:{config.PORT}"
CMD = f"{config.SLUG} library"
HEADERS = {"Content-Type": "application/json", "Origin": BASE}


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(BASE + path, method=method, headers=HEADERS,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error")
        except ValueError:
            msg = None
        sys.exit(f"{CMD}: {msg or f'HTTP {e.code} on {path}'}")
    except urllib.error.URLError as e:
        sys.exit(f"{CMD}: daemon not answering on {BASE} ({e.reason})")


def find_item(lib: dict, ref: str) -> dict:
    hits = [i for i in lib["items"] if ref in (i["id"], i["name"])] or \
           [i for i in lib["items"] if i["name"].lower().startswith(ref.lower())]
    if len(hits) != 1:
        sys.exit(f"{CMD}: {'no' if not hits else 'more than one'} item matches {ref!r}")
    return hits[0]


def find_station(ref: str) -> str:
    snap = call("GET", "/api/snapshot")
    sts = [*snap.get("stations", []), *snap.get("utility_stations", [])]
    hits = [s for s in sts if ref in (s.get("id"), s.get("ref"))] or [s for s in sts if (s.get("title") or "").lower() == ref.lower()]
    if len(hits) != 1:
        sys.exit(f"{CMD}: {'no' if not hits else 'more than one'} session matches {ref!r}")
    return hits[0]["id"]


def cmd_list(_a) -> None:
    lib = call("GET", "/api/library")
    grants: dict[str, list[str]] = {}
    for g in lib["grants"]:
        grants.setdefault(g["item_id"], []).append(g["target"] + ("" if g["mode"] == "pinned" else " (once)"))
    for it in lib["items"]:
        print(f"{it['id']}  {it['name']}" + (f"  [{', '.join(it['tags'])}]" if it["tags"] else ""))
        for st in it["status"]:
            mark = "ok " if st["exists"] else "MISSING"
            extra = f" {st['files']}{'+' if st['truncated'] else ''} files" if st["kind"] == "dir" else ""
            print(f"    {mark} {st['path']}{extra}")
        if grants.get(it["id"]):
            print(f"    → {', '.join(grants[it['id']])}")
    owed = lib.get("owed") or {}
    if owed:
        print(f"\nowed: {', '.join(f'{k} ({len(v)})' for k, v in owed.items())}")
    if not lib["items"]:
        print(f"the library is empty; add with: {CMD} add <path...> --name NAME")


def cmd_add(a) -> None:
    paths = [os.path.abspath(os.path.expanduser(p)) for p in a.paths]
    for p in paths:
        if not os.path.exists(p):
            print(f"warning: {p} does not exist (added anyway)", file=sys.stderr)
    item = call("POST", "/api/library/items", {"name": a.name or os.path.basename(paths[0]), "paths": paths,
                                                "tags": a.tags or [], "description": a.description or ""})["result"]
    print(f"added {item['id']}  {item['name']}")
    for t in a.to or []:
        g = call("POST", "/api/library/grants", {"item_id": item["id"], "target": t, "mode": "once" if a.once else "pinned"})["result"]
        print(f"granted to {g['target']} ({g['mode']})")


def cmd_grant(a) -> None:
    item = find_item(call("GET", "/api/library"), a.item)
    g = call("POST", "/api/library/grants", {"item_id": item["id"], "target": a.target, "mode": "once" if a.once else "pinned"})["result"]
    print(f"{item['name']} → {g['target']} ({g['mode']})")


def cmd_send(a) -> None:
    lib = call("GET", "/api/library")
    ids = [find_item(lib, r)["id"] for r in a.items]
    params = {"station_id": find_station(a.to), "item_ids": ids, **({"note": a.note} if a.note else {})}
    pv = call("POST", "/api/actions/preview", {"action": "library_send", "params": params})
    if pv.get("error"):
        sys.exit(f"refused: {pv['error']}")
    print(pv["facts"]["message"] + "\n\nThe daemon will run:\n" + pv["command"])
    for w in pv.get("warnings") or []:
        print(f"! {w}")
    if not a.yes and input("\nSend? [y/N] ").strip().lower() != "y":
        print("not sent")
        return
    r = call("POST", "/api/actions", {"action": "library_send", "params": params})
    print("sent" if r.get("ok") else f"failed: {r.get('error')}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog=CMD, description="Context library (design/LIBRARY.md)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    p = sub.add_parser("add")
    p.add_argument("paths", nargs="+")
    p.add_argument("--name")
    p.add_argument("--description")
    p.add_argument("--tags", type=lambda s: [t for t in s.split(",") if t])
    p.add_argument("--to", action="append", help="all, domain:<id> or station:<id>; repeatable")
    p.add_argument("--once", action="store_true")
    p.set_defaults(fn=cmd_add)
    p = sub.add_parser("grant")
    p.add_argument("item")
    p.add_argument("target")
    p.add_argument("--once", action="store_true")
    p.set_defaults(fn=cmd_grant)
    p = sub.add_parser("send")
    p.add_argument("items", nargs="+")
    p.add_argument("--to", required=True)
    p.add_argument("--note")
    p.add_argument("--yes", action="store_true", help="skip the question (the preview still prints)")
    p.set_defaults(fn=cmd_send)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
