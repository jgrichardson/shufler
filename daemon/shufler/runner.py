"""Subprocess helper: argv lists only (never a shell), hard timeout, trimmed output."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

from . import config


@dataclass
class RunResult:
    rc: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.rc == 0

    def combined(self, limit: int = config.OUTPUT_LIMIT) -> str:
        text = (self.stdout + ("\n" + self.stderr if self.stderr.strip() else "")).strip()
        return text if len(text) <= limit else text[: limit - 20] + "\n…[truncated]"


def run(argv: list[str], timeout: float = 30, env: dict[str, str] | None = None) -> RunResult:
    full_env = {**os.environ, "CMUX_QUIET": "1", "NO_COLOR": "1", "GH_PROMPT_DISABLED": "1"}
    if env:
        full_env.update(env)
    try:
        p = subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, env=full_env, stdin=subprocess.DEVNULL
        )
        return RunResult(p.returncode, p.stdout, p.stderr)
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        return RunResult(124, out, f"timed out after {timeout}s")
    except FileNotFoundError as e:
        return RunResult(127, "", f"command not found: {e.filename}")
