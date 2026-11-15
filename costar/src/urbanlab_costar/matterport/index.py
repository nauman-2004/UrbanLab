"""The sponsor's ``models_index.csv`` (local file, never committed).

Only the columns needed for lookups are read; everything else is ignored.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .. import geo
from ..kit.repository import normalize_id


@dataclass(frozen=True)
class ModelSummary:
    sid: str
    segment: str | None
    lat: float | None
    lon: float | None
    costar_property_id: str | None
    homes_listing_id: str | None
    floor_count: int | None
    room_count: int | None
    pano_count: int | None


def _f(v: str | None) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def _i(v: str | None) -> int | None:
    x = _f(v)
    return int(x) if x is not None else None


class ModelsIndex:
    def __init__(self, models: list[ModelSummary]) -> None:
        self.models = models
        self._by_costar: dict[str, list[ModelSummary]] = defaultdict(list)
        self._by_homes: dict[str, list[ModelSummary]] = defaultdict(list)
        for m in models:
            if m.costar_property_id:
                self._by_costar[m.costar_property_id].append(m)
            if m.homes_listing_id:
                self._by_homes[m.homes_listing_id].append(m)

    @classmethod
    def load(cls, path: Path) -> ModelsIndex:
        if not path.is_file():
            raise FileNotFoundError("models index CSV not found (check MATTERPORT_INDEX_CSV)")
        rows: list[ModelSummary] = []
        with path.open(newline="", encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                sid = (r.get("sid") or "").strip()
                if not sid:
                    continue
                rows.append(ModelSummary(
                    sid=sid,
                    segment=(r.get("segment") or "").strip() or None,
                    lat=_f(r.get("lat")),
                    lon=_f(r.get("lon")),
                    costar_property_id=normalize_id(r.get("costar_property_id") or None),
                    homes_listing_id=normalize_id(r.get("homes_listing_id") or None),
                    floor_count=_i(r.get("floor_count")),
                    room_count=_i(r.get("room_count")),
                    pano_count=_i(r.get("pano_count")),
                ))
        return cls(rows)

    def for_costar_property(self, costar_id: str) -> list[ModelSummary]:
        nid = normalize_id(costar_id)
        return list(self._by_costar.get(nid, [])) if nid else []

    def for_homes_listing(self, listing_id: str) -> list[ModelSummary]:
        nid = normalize_id(listing_id)
        return list(self._by_homes.get(nid, [])) if nid else []

    def near(self, lat: float, lon: float, km: float = 0.25, limit: int = 20) -> list[tuple[float, ModelSummary]]:
        hits = [
            (geo.haversine_km(lat, lon, m.lat, m.lon), m)
            for m in self.models if m.lat is not None and m.lon is not None
        ]
        return sorted((h for h in hits if h[0] <= km), key=lambda h: h[0])[:limit]
