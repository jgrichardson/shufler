"""Build hook: put the built web app (../web/dist) into the wheel and sdist as shufler/web.

A wheel built from the sdist finds it already in place. Editable installs (uv sync) skip it: a source checkout
serves web/dist directly. Without a web build the package still builds, with a warning, and the daemon answers
503 with a hint; set SHUFLER_REQUIRE_WEB=1 (release.sh and CI do) to make that an error instead.
"""

from __future__ import annotations

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class WebBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        if version == "editable":
            return
        root = Path(self.root)
        repo_dist = root.parent / "web" / "dist"
        if (repo_dist / "index.html").is_file():
            build_data["force_include"][str(repo_dist)] = "shufler/web"
            return
        if (root / "shufler" / "web" / "index.html").is_file():
            return
        msg = f"no web build at {repo_dist}; the package will not include the web app (cd web && bun run build)"
        if os.environ.get("SHUFLER_REQUIRE_WEB") == "1":
            raise RuntimeError(msg)
        self.app.display_warning(msg)
