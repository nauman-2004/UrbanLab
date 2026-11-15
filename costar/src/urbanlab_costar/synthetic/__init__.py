"""SYNTHETIC fixtures for offline tests and demos.

Everything here is invented: building names, ids, coordinates, measurements
and even the kit "schema" (deliberately NOT the CoStar schema). Vexcel responses
reuse only the response fields the sponsor quickstart reads. Nothing here may be
presented as real data.
"""

from __future__ import annotations

import csv
import json
import math
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import geo
from ..http import HttpRequest, HttpResponse

SYNTHETIC_FIELD_MAP = """\
# Field map for the SYNTHETIC kit used in tests. Not the CoStar schema.
[kit]
as_of = "2026-06-30"

[regions]
field = "market_id"
houston = [1]
los_angeles = [2]

[datasets.commercial_property]
members = "synthetic-commercial/*.json"
format = "json"
id = "synthetic_id"

[datasets.commercial_property.fields]
name = "label"
address = "where.street"
city = "where.town"
state = "where.region"
lat = "where.point.y"
lon = "where.point.x"
market_id = "where.mkt"
property_type = "facts.use"
building_class = "facts.grade"
year_built = "facts.built"
building_area_sf = "facts.nra"
land_area_sf = ["facts.site_sqft", "facts.site_acres_typo"]
garage_stalls = ""
vacancy_pct = { path = "facts.vac", kind = "number" }

[datasets.commercial_property.units]
land_area_sf = "sf"

[datasets.matterport_links]
members = "synthetic-links.csv"
format = "csv"
id = "PropertyKey"

[datasets.matterport_links.fields]
property_id = "PropertyKey"
model_id = "ModelKey"

[datasets.synthetic_tenancy]
members = "synthetic-tenancy.jsonl"
format = "jsonl"
id = "tid"

[datasets.synthetic_tenancy.fields]
property_id = "pid"
tenant = "who"
"""


@dataclass(frozen=True)
class SynBuilding:
    sid: str
    name: str
    lat: float
    lon: float
    year: int | None
    rba: int
    lot_sf: int | None
    parking_share: float  # fraction of the parcel the synthetic detector "finds"
    grade: str
    use: str = "Office"
    vexcel_404: bool = False
    model_sids: tuple[str, ...] = ()


def _buildings() -> list[SynBuilding]:
    base_lat, base_lon = 29.7560, -95.3660
    out = []
    for i in range(12):
        old = i < 6
        ang = i * (2 * math.pi / 12)
        out.append(SynBuilding(
            sid=str(90001 + i),
            name=f"Synthetic Office {i + 1:02d}",
            lat=round(base_lat + 0.006 * math.sin(ang), 6),
            lon=round(base_lon + 0.007 * math.cos(ang), 6),
            year=(1962 + 3 * i) if old else (2001 + 2 * (i - 6)),
            rba=180_000 + 25_000 * i,
            lot_sf=60_000 + 8_000 * (i % 5),
            parking_share=(0.42 - 0.03 * i) if old else (0.08 + 0.01 * (i - 6)),
            grade="B" if old else "A",
            vexcel_404=(i == 9),
            model_sids=(f"SYNTHMODEL{i:02d}",) if i % 3 == 0 else (),
        ))
    # Edge cases: missing year, non-office, out of the Houston box.
    out[4] = SynBuilding(**{**out[4].__dict__, "year": None})
    out.append(SynBuilding("90101", "Synthetic Warehouse", 29.80, -95.30, 1990, 90_000, 200_000, 0.3, "C",
                           use="Industrial"))
    out.append(SynBuilding("90102", "Synthetic LA Office", 34.05, -118.25, 1985, 300_000, 70_000, 0.2, "A"))
    return out


BUILDINGS = _buildings()

# Recorded vacancy (synthetic): one valid, one recorded zero, one invalid (> 100).
SYNTHETIC_VACANCY: dict[str, Any] = {"90007": 6, "90008": 0, "90009": 120}


def build_kit(directory: Path) -> Path:
    """Write the synthetic kit zip (unencrypted) into ``directory``."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "synthetic-kit.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README-SYNTHETIC.md", "Synthetic test kit. Not CoStar data.\n")
        for b in BUILDINGS:
            facts: dict[str, Any] = {"use": b.use, "grade": b.grade, "nra": b.rba}
            if b.year is not None:
                facts["built"] = b.year
            if b.lot_sf is not None:
                facts["site_sqft"] = f"{b.lot_sf:,}"  # string with thousands separator on purpose
            if b.sid in SYNTHETIC_VACANCY:
                facts["vac"] = SYNTHETIC_VACANCY[b.sid]
            rec = {
                "synthetic_id": b.sid.zfill(7),  # leading zeros on purpose: ids must normalize
                "label": b.name,
                "where": {"street": f"{100 + int(b.sid) % 100} Synthetic St",
                          "town": "Los Angeles" if b.lat > 33 and b.lon < -110 else "Houston",
                          "region": "CA" if b.lon < -110 else "TX",
                          "mkt": 2 if b.lon < -110 else 1,
                          "point": {"y": b.lat, "x": b.lon}},
                "facts": facts,
            }
            zf.writestr(f"synthetic-commercial/{b.sid}.json", json.dumps(rec))
        lines = [json.dumps({"tid": f"T{k}", "pid": BUILDINGS[k % 3].sid, "who": f"Tenant {k}"}) for k in range(6)]
        zf.writestr("synthetic-tenancy.jsonl", "\n".join(lines) + "\n")
        # Extra links not in the models index (merge test): buildings 2 and 3, plus a duplicate of building 1.
        links = ["PropertyKey,ModelKey", "90001,SYNTHMODEL00", "90002,SYNTHLINK002", "90003,SYNTHLINK003", "90003,"]
        zf.writestr("synthetic-links.csv", "\n".join(links) + "\n")
    return path


def write_field_map(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "field_map.toml"
    path.write_text(SYNTHETIC_FIELD_MAP, encoding="utf-8")
    return path


def write_models_index(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "synthetic_models_index.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["sid", "segment", "lat", "lon", "costar_property_id", "homes_listing_id",
                    "floor_count", "room_count", "pano_count"])
        for b in BUILDINGS:
            for k, sid in enumerate(b.model_sids):
                w.writerow([sid, "commercial", b.lat, b.lon, b.sid, "", 1, 6 + k, 20])
    return path


def _parcel_ring(b: SynBuilding) -> geo.Ring:
    side = math.sqrt(b.lot_sf or 50_000) / math.sqrt(geo.SQM_TO_SQFT)  # metres
    half = side / 2
    dlat = half / geo.M_PER_DEG_LAT
    dlon = half / (geo.M_PER_DEG_LAT * math.cos(math.radians(b.lat)))
    w, e, s, n = b.lon - dlon, b.lon + dlon, b.lat - dlat, b.lat + dlat
    return [(w, s), (e, s), (e, n), (w, n), (w, s)]


class SyntheticVexcelTransport:
    """Answers property/extract and elements/detect for the synthetic buildings."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def _find(self, lat: float, lon: float) -> SynBuilding | None:
        best = min(BUILDINGS, key=lambda b: abs(b.lat - lat) + abs(b.lon - lon))
        return best if abs(best.lat - lat) + abs(best.lon - lon) < 1e-4 else None

    def send(self, request: HttpRequest) -> HttpResponse:
        path = request.path.rsplit("/v2/", 1)[-1]
        self.calls.append(f"{request.method} {path}")
        if path == "property/extract":
            wkt = str((request.params or {})["wkt"])
            lon, lat = (float(x) for x in wkt[wkt.index("(") + 1:wkt.index(")")].split())
            b = self._find(lat, lon)
            if b is None or b.vexcel_404:
                return HttpResponse(404, b'{"message":"No available property data for request"}')
            ring = _parcel_ring(b)
            body = {"type": "FeatureCollection", "features": [{
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring]]},
                "properties": {"metadata.collection": "synthetic-collection", "structure.count": 1,
                               "structures": [{"primary-structure": True,
                                               "footprint.area": round(b.rba / 12)}]},
            }]}
            return HttpResponse(200, json.dumps(body).encode())
        if path == "elements/detect":
            body_in = request.json_body or {}
            ring = geo.parse_wkt(body_in["wkt"])[0][0]
            cx = sum(x for x, _ in ring[:-1]) / (len(ring) - 1)
            cy = sum(y for _, y in ring[:-1]) / (len(ring) - 1)
            b = self._find(cy, cx)
            if b is None:
                return HttpResponse(404, b"{}")
            (w, s), (e, _), (_, n) = ring[0], ring[1], ring[2]
            # A strip on the south side covering `parking_share` of the parcel, split in two
            # overlapping boxes (overlap must not be double counted).
            top = s + (n - s) * b.parking_share
            mid = w + (e - w) * 0.6
            boxes = [
                [(w, s), (mid, s), (mid, top), (w, top), (w, s)],
                [(w + (e - w) * 0.4, s), (e, s), (e, top), (w + (e - w) * 0.4, top), (w + (e - w) * 0.4, s)],
            ]
            dets = [{"imageId": "ortho-0", "confidence": 0.81 - 0.02 * k,
                     "bbox": geo.polygon_wkt([bx])} for k, bx in enumerate(boxes)]
            body = {"images": [{"image-id": "ortho-0"}],
                    "features": [{"properties": {"label": lb["label"], "detections": dets}}
                                 for lb in body_in["model-input"]["elements"]]}
            return HttpResponse(200, json.dumps(body).encode())
        return HttpResponse(404, b"{}")


class SyntheticMatterportTransport:
    def __init__(self) -> None:
        self.calls = 0

    def send(self, request: HttpRequest) -> HttpResponse:
        self.calls += 1
        sid = (request.json_body or {}).get("variables", {}).get("id")
        if not str(sid).startswith("SYNTHMODEL"):
            return HttpResponse(200, json.dumps({"errors": [{"message": "nope",
                                                             "extensions": {"code": "not.found"}}]}).encode())
        rooms = [{"id": f"r{k}", "floor": {"id": "f0"},
                  "classifications": [{"label": lb, "confidence": 0.9 - 0.1 * k}],
                  "dimensions": {"areaFloor": 20.0 + k}}
                 for k, lb in enumerate(["Office", "Office", "Kitchen", "Lobby"])]
        return HttpResponse(200, json.dumps({"data": {"model": {"rooms": rooms}}}).encode())


DEMO_SPEC: dict[str, Any] = {
    "question": "Do older office buildings in Houston dedicate more land to surface parking?",
    "region": "houston",
    "property_types": ["office"],
    "variables": ["year_built", "building_area_sf", "land_area_sf", "surface_parking_sf",
                  "garage_stalls", "surface_parking_share", "matterport_model_count"],
    "sample_limit": 20,
    "hypothesis": "Pre-1980 offices have a higher surface-parking share of their lot than post-2000 offices.",
}
