"""Geography: regions/coverage, WKT helpers (lon-lat order!), areas and overlaps.

Region boxes are APPROXIMATE client-side pre-checks so we never spend a request
on a point that is obviously out of coverage. The provider's own 403 response
is authoritative. Sponsor-announced coverage:

- Vexcel geofence: Houston, Los Angeles, Northern California, Florida Panhandle, Princeton
- CoStar kit and Matterport models: Houston and Los Angeles only
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

M_PER_DEG_LAT = 111_320.0
SQM_TO_SQFT = 10.763910416709722
EARTH_RADIUS_KM = 6371.0088

Ring = list[tuple[float, float]]  # (lon, lat)
Polygon = list[Ring]  # exterior ring first, then holes


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east


@dataclass(frozen=True)
class Region:
    key: str
    label: str
    bbox: BBox
    city_names: tuple[str, ...]
    state: str


REGIONS: dict[str, Region] = {
    "houston": Region("houston", "Houston, TX", BBox(-96.2, 29.2, -94.6, 30.4), ("Houston",), "TX"),
    "los_angeles": Region(
        "los_angeles", "Los Angeles, CA", BBox(-119.0, 33.6, -117.4, 34.5), ("Los Angeles",), "CA"
    ),
    "northern_california": Region(
        "northern_california", "Northern California (approx. Bay Area)",
        BBox(-123.2, 36.9, -121.2, 38.9), (), "CA",
    ),
    "florida_panhandle": Region(
        "florida_panhandle", "Florida Panhandle", BBox(-87.7, 29.5, -84.8, 31.1), (), "FL"
    ),
    "princeton": Region("princeton", "Princeton, NJ", BBox(-74.80, 40.25, -74.55, 40.45), ("Princeton",), "NJ"),
}

COVERAGE: dict[str, frozenset[str]] = {
    "costar": frozenset({"houston", "los_angeles"}),
    "matterport": frozenset({"houston", "los_angeles"}),
    "vexcel": frozenset(REGIONS),
}


class GeofenceError(RuntimeError):
    """Location is outside a provider's coverage (pre-check or provider 403)."""


def validate_latlon(lat: float, lon: float) -> None:
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise ValueError(f"invalid coordinate lat={lat}, lon={lon}")


def region_for(lat: float, lon: float) -> Region | None:
    validate_latlon(lat, lon)
    for r in REGIONS.values():
        if r.bbox.contains(lat, lon):
            return r
    return None


def require_coverage(provider: str, lat: float, lon: float) -> Region:
    """Raise :class:`GeofenceError` unless (lat, lon) is inside ``provider`` coverage."""
    allowed = COVERAGE.get(provider, frozenset())
    try:
        region = region_for(lat, lon)
    except ValueError:
        if region_for_swapped(lat, lon):
            raise GeofenceError(f"{provider}: ({lat}, {lon}) is invalid; lat/lon look swapped") from None
        raise
    if region is None or region.key not in allowed:
        hint = ""
        if region is None and region_for_swapped(lat, lon):
            hint = " (lat/lon look swapped; WKT is lon-lat but this API takes lat, lon)"
        raise GeofenceError(f"{provider}: ({lat:.5f}, {lon:.5f}) is outside known coverage{hint}")
    return region


def region_for_swapped(lat: float, lon: float) -> Region | None:
    try:
        return region_for(lon, lat)
    except ValueError:
        return None


def point_wkt(lat: float, lon: float) -> str:
    validate_latlon(lat, lon)
    return f"POINT({lon} {lat})"


def square_wkt(lat: float, lon: float, half_m: float) -> str:
    dlat = half_m / M_PER_DEG_LAT
    dlon = half_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    w, e, s, n = lon - dlon, lon + dlon, lat - dlat, lat + dlat
    return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"


def polygon_wkt(poly: Polygon) -> str:
    rings = ",".join("(" + ",".join(f"{x} {y}" for x, y in ring) + ")" for ring in poly)
    return f"POLYGON({rings})"


_NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"


def parse_wkt(wkt: str) -> list[Polygon]:
    """Parse POLYGON / MULTIPOLYGON WKT into a list of polygons (lon, lat)."""
    s = wkt.strip()
    kind = s.split("(", 1)[0].strip().upper()
    if kind not in {"POLYGON", "MULTIPOLYGON"}:
        raise ValueError(f"unsupported WKT geometry: {kind or s[:20]!r}")
    body = s[s.index("("):]
    polygons: list[Polygon] = []
    depth = 0
    current_poly: Polygon = []
    ring_start = None
    target_ring_depth = 2 if kind == "POLYGON" else 3
    for i, ch in enumerate(body):
        if ch == "(":
            depth += 1
            if depth == target_ring_depth:
                ring_start = i + 1
        elif ch == ")":
            if depth == target_ring_depth and ring_start is not None:
                current_poly.append(_parse_ring(body[ring_start:i]))
                ring_start = None
            if depth == target_ring_depth - 1:
                polygons.append(current_poly)
                current_poly = []
            depth -= 1
    if not polygons or any(not p for p in polygons):
        raise ValueError("could not parse WKT polygon")
    return polygons


def _parse_ring(text: str) -> Ring:
    pts: Ring = []
    for pair in text.split(","):
        nums = re.findall(_NUM, pair)
        if len(nums) < 2:
            raise ValueError("bad WKT coordinate pair")
        pts.append((float(nums[0]), float(nums[1])))
    return pts


def geometry_polygons(geom: Any) -> list[Polygon]:
    """Accept GeoJSON (dict) or WKT (str) Polygon/MultiPolygon geometry."""
    if isinstance(geom, str):
        return parse_wkt(geom)
    if isinstance(geom, dict):
        t, coords = geom.get("type"), geom.get("coordinates")
        if t == "Polygon" and coords:
            return [[[(float(x), float(y)) for x, y, *_ in ring] for ring in coords]]
        if t == "MultiPolygon" and coords:
            return [[[(float(x), float(y)) for x, y, *_ in ring] for ring in poly] for poly in coords]
    raise ValueError("unsupported geometry")


def _ref_lat(polys: Sequence[Polygon]) -> float:
    lats = [y for p in polys for x, y in p[0]]
    return sum(lats) / len(lats)


def _to_xy(ring: Ring, ref_lat: float) -> list[tuple[float, float]]:
    k = M_PER_DEG_LAT * math.cos(math.radians(ref_lat))
    return [(x * k, y * M_PER_DEG_LAT) for x, y in ring]


def _shoelace(pts: Sequence[tuple[float, float]]) -> float:
    a = 0.0
    for (x1, y1), (x2, y2) in zip(pts, list(pts[1:]) + [pts[0]]):
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def area_m2(polys: Sequence[Polygon]) -> float:
    """Planar area (local equirectangular projection; accurate at parcel scale)."""
    if not polys:
        return 0.0
    ref = _ref_lat(polys)
    total = 0.0
    for poly in polys:
        outer, *holes = poly
        total += _shoelace(_to_xy(outer, ref)) - sum(_shoelace(_to_xy(h, ref)) for h in holes)
    return max(total, 0.0)


def _inside_ring(x: float, y: float, ring: Sequence[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-300) + x1:
            inside = not inside
    return inside


def _inside(x: float, y: float, polys_xy: Iterable[list[list[tuple[float, float]]]]) -> bool:
    for outer, *holes in polys_xy:
        if _inside_ring(x, y, outer) and not any(_inside_ring(x, y, h) for h in holes):
            return True
    return False


def covered_area_m2(base: Sequence[Polygon], covers: Sequence[Polygon], cell_m: float = 0.5) -> float:
    """Area of ``base`` ∩ union(``covers``), estimated on a ``cell_m`` grid.

    Grid estimation avoids double-counting overlapping detections without a
    geometry dependency. Resolution error is roughly ``perimeter × cell_m / 2``.
    """
    if not base or not covers:
        return 0.0
    ref = _ref_lat(base)
    base_xy = [[_to_xy(r, ref) for r in p] for p in base]
    cov_xy = [[_to_xy(r, ref) for r in p] for p in covers]
    xs = [x for p in base_xy for x, _ in p[0]]
    ys = [y for p in base_xy for _, y in p[0]]
    cx0, cx1 = min(x for p in cov_xy for x, _ in p[0]), max(x for p in cov_xy for x, _ in p[0])
    cy0, cy1 = min(y for p in cov_xy for _, y in p[0]), max(y for p in cov_xy for _, y in p[0])
    x0, x1 = max(min(xs), cx0), min(max(xs), cx1)
    y0, y1 = max(min(ys), cy0), min(max(ys), cy1)
    if x0 >= x1 or y0 >= y1:
        return 0.0
    nx = max(1, math.ceil((x1 - x0) / cell_m))
    ny = max(1, math.ceil((y1 - y0) / cell_m))
    if nx * ny > 4_000_000:
        raise ValueError("area too large for grid estimate; increase cell_m")
    hits = 0
    for j in range(ny):
        y = y0 + (j + 0.5) * cell_m
        for i in range(nx):
            x = x0 + (i + 0.5) * cell_m
            if _inside(x, y, base_xy) and _inside(x, y, cov_xy):
                hits += 1
    return hits * cell_m * cell_m


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))
