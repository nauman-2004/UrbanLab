"""Tenancy join: recorded occupancy per property from the kit's tenancy dataset.

Definitions (from the kit's own guidance):

- A tenancy is *current* on the snapshot date ``as_of`` when it started on or
  before ``as_of``, has no end date (or ends after ``as_of``), and its move-in
  date (if any) is not in the future. Leased-but-not-moved-in space is NOT occupied.
- Occupied area is the sum of the tenancy's spaces' occupied square feet.
- *Recorded occupancy* = occupied area of current tenancies / rentable building
  area. It is NOT a vacancy rate: the kit says occupancy must not be used as a
  vacancy numerator, and tenant lists are as of each building's last research.

A percentage is produced only when every current tenancy has a recorded area
and the result is within 0-100 %; otherwise the gap explains why.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from ..provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .mapping import MappingError
from .repository import PropertyRepository, normalize_id

DATASET = "location_occupancy"
REQUIRED_FIELDS = frozenset({"property_id", "from_date", "to_date", "move_in_date", "occupied_sf",
                             "spaces_count", "spaces_missing_sf"})
TENANCY_VARS = frozenset({"tenancy_count_current", "occupied_sf_current", "occupancy_pct"})
DEFINITION = ("recorded tenant occupancy = occupied SF of current tenancies / RBA; "
              "not a vacancy rate; tenant lists are as of each building's last research")


def parse_date(v: Any) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v
    s = str(v).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None


@dataclass
class TenancySummary:
    records: int = 0
    current: int = 0
    current_missing_sf: int = 0
    occupied_sf: float = 0.0
    future: int = 0  # starts or moves in after as_of (leased, not occupied)
    ended: int = 0
    undated: int = 0


def tenancy_available(repo: PropertyRepository) -> tuple[bool, str]:
    ds = repo.field_map.get(DATASET)
    if ds is None:
        return False, f"kit dataset '{DATASET}' is not configured in the field map"
    missing = REQUIRED_FIELDS - ds.mapped()
    if missing:
        return False, f"{DATASET} needs fields {sorted(missing)} mapped"
    if not repo.field_map.as_of or parse_date(repo.field_map.as_of) is None:
        return False, "field map needs [kit] as_of = \"YYYY-MM-DD\" (the kit snapshot date)"
    return True, "ok"


def summarize(repo: PropertyRepository, property_ids: set[str] | None = None) -> dict[str, TenancySummary]:
    ok, why = tenancy_available(repo)
    if not ok:
        raise MappingError(why)
    as_of = parse_date(repo.field_map.as_of)
    assert as_of is not None
    out: dict[str, TenancySummary] = defaultdict(TenancySummary)
    for r in repo.records(DATASET):
        pid = normalize_id(r.get("property_id"))
        if pid is None or (property_ids is not None and pid not in property_ids):
            continue
        s = out[pid]
        s.records += 1
        start, end, move_in = parse_date(r.get("from_date")), parse_date(r.get("to_date")), \
            parse_date(r.get("move_in_date"))
        if start is None:
            s.undated += 1
            continue
        if end is not None and end <= as_of:
            s.ended += 1
            continue
        if start > as_of or (move_in is not None and move_in > as_of):
            s.future += 1
            continue
        s.current += 1
        spaces = r.get("spaces_count") or 0
        missing = r.get("spaces_missing_sf") or 0
        sf = r.get("occupied_sf")
        if not spaces or missing or not isinstance(sf, (int, float)):
            s.current_missing_sf += 1
        else:
            s.occupied_sf += float(sf)
    return dict(out)


def tenancy_values(kit_id: str, summary: TenancySummary | None, rba: Value | None,
                   as_of: str) -> dict[str, Value | Gap]:
    ref = f"CoStar kit · tenancies · property {kit_id} · as of {as_of}"
    out: dict[str, Value | Gap] = {}
    if summary is None or summary.records == 0:
        for v in TENANCY_VARS:
            out[v] = Gap(v, GapKind.MISSING_IN_RECORD, "no tenancy records for this property "
                         "(vacant and unresearched cannot be told apart)", Source.COSTAR)
        return out
    counts = (f"{summary.current} current, {summary.ended} ended, {summary.future} future, "
              f"{summary.undated} undated of {summary.records} tenancy records")
    out["tenancy_count_current"] = Value(
        variable="tenancy_count_current", value=summary.current, unit="tenancies", source=Source.COSTAR,
        method=Method.COMPUTED, evidence=EvidenceRef(ref=ref, note=counts),
        uncertainty="tenant lists are as of each building's last research",
    )
    if summary.current == 0:
        reason = f"no current tenancies on {as_of} ({counts}); a 0 % figure would not be reliable"
        out["occupied_sf_current"] = Gap("occupied_sf_current", GapKind.MISSING_IN_RECORD, reason, Source.COSTAR)
        out["occupancy_pct"] = Gap("occupancy_pct", GapKind.MISSING_IN_RECORD, reason, Source.COSTAR)
        return out
    if summary.current_missing_sf:
        reason = (f"{summary.current_missing_sf} of {summary.current} current tenancies have no occupied area; "
                  "a total would understate occupancy")
        out["occupied_sf_current"] = Gap("occupied_sf_current", GapKind.MISSING_IN_RECORD, reason, Source.COSTAR)
        out["occupancy_pct"] = Gap("occupancy_pct", GapKind.MISSING_IN_RECORD, reason, Source.COSTAR)
        return out
    out["occupied_sf_current"] = Value(
        variable="occupied_sf_current", value=round(summary.occupied_sf), unit="sf", source=Source.COSTAR,
        method=Method.COMPUTED, evidence=EvidenceRef(ref=ref, note=f"sum of occupied SF; {counts}"),
    )
    if rba is None:
        out["occupancy_pct"] = Gap("occupancy_pct", GapKind.MISSING_IN_RECORD,
                                   "no rentable building area to divide by", Source.COSTAR)
        return out
    pct = summary.occupied_sf / float(rba.value) * 100 if float(rba.value) > 0 else None
    if pct is None or pct > 100.0:
        out["occupancy_pct"] = Gap(
            "occupancy_pct", GapKind.ERROR,
            "recorded occupied area exceeds RBA (likely overlapping or stale tenancies)"
            if pct is not None else "RBA is not positive", Source.COSTAR)
        return out
    out["occupancy_pct"] = Value(
        variable="occupancy_pct", value=round(pct, 1), unit="%", source=Source.COSTAR, method=Method.COMPUTED,
        evidence=EvidenceRef(ref=ref, note=f"{DEFINITION}; {counts}"),
        uncertainty="excludes leased-not-yet-occupied space; not CoStar's published vacancy",
        inputs=("occupied_sf_current", "building_area_sf"),
    )
    return out
