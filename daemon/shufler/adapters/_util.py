from __future__ import annotations

import json
from typing import Any

from .. import runner


def json_cmd(argv: list[str], timeout: float = 30) -> Any:
    r = runner.run(argv, timeout=timeout)
    if not r.ok:
        raise RuntimeError(f"rc={r.rc} {r.stderr.strip()[:200]}")
    return json.loads(r.stdout)
