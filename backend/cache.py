"""DEMO_MODE cache for the slow, deterministic steps (CoStar fetch, vision measurement).

First run: results are computed live and written to data/cache/<kind>__<key>.json.
Later runs: results are read back with a pacing delay so the whole cached
section replays in about DEMO_REPLAY_SECONDS. Errors are never cached.
The survey call is never cached.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Callable

import config

# Share of DEMO_REPLAY_SECONDS spent on each kind of cached step.
_PACE_SHARE = {"costar": 0.25, "vision": 0.75}


def _path(kind: str, key: str):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", key)[:80]
    digest = hashlib.sha1(key.encode()).hexdigest()[:8]
    return config.CACHE_DIR / f"{kind}__{safe}__{digest}.json"


def cached(kind: str, key: str, compute: Callable[[], Any], *, pace_items: int = 1) -> tuple[Any, bool]:
    """Return (value, from_cache). pace_items spreads the replay delay over N calls of this kind."""
    if not config.DEMO_MODE:
        return compute(), False
    path = _path(kind, key)
    if path.exists():
        time.sleep(config.DEMO_REPLAY_SECONDS * _PACE_SHARE.get(kind, 0.1) / max(1, pace_items))
        return json.loads(path.read_text(encoding="utf-8")), True
    value = compute()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, default=str), encoding="utf-8")
    return value, False
