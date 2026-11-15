"""Data-source clients: CoStar and Vexcel.

These are the ONLY places that touch external data. Swap the stub bodies for
the real APIs; keep the return shapes and the tools in tools.py won't change.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import config


# ---------------------------------------------------------------- CoStar ----
def costar_fetch_properties(city: str, property_type: str, limit: int) -> list[dict[str, Any]]:
    """Return CoStar property records as dicts.

    STUB: reads config.COSTAR_CSV. Real integration: call the CoStar API and map
    its fields to the same keys (costar_id, name, address, city, property_type,
    lat, lng, year_built, rba_sf, lot_sf, building_class, occupancy_pct,
    parking_spaces, parking_ratio). Leave a key empty/None when CoStar has no
    value; never fill defaults.
    """
    rows: list[dict[str, Any]] = []
    with open(config.COSTAR_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["city"].strip().lower() != city.strip().lower():
                continue
            if row["property_type"].strip().lower() != property_type.strip().lower():
                continue
            rows.append({k: (v.strip() if isinstance(v, str) and v.strip() != "" else None) for k, v in row.items()})
            if len(rows) >= limit:
                break
    return rows


# ---------------------------------------------------------------- Vexcel ----
def tile_name(lat: float, lng: float) -> str:
    return f"{lat:.5f}_{lng:.5f}.png"


def vexcel_fetch_tile(lat: float, lng: float) -> Path:
    """Return a local path to an orthophoto tile centred on (lat, lng).

    STUB: looks up config.TILES_DIR/<lat>_<lng>.png. Real integration: request
    the ortho tile from Vexcel, save it to that same path, return the path.
    Raises FileNotFoundError when no imagery is available.
    """
    path = config.TILES_DIR / tile_name(lat, lng)
    if not path.exists():
        raise FileNotFoundError(f"No Vexcel tile available for ({lat:.5f}, {lng:.5f})")
    return path
