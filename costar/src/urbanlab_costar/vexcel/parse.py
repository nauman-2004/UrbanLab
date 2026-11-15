"""Parse Vexcel responses using only fields the sponsor quickstart reads.

- property/extract: ``features[0].geometry`` (parcel), ``properties["metadata.collection"]``,
  ``properties["structure.count"]``, ``properties["structures"][*]["footprint.area"]``
  and ``["primary-structure"]``. Missing fields are reported as ``None``, never defaulted.
- elements/detect: ``features[*].properties.label`` and ``.detections[*]`` with
  ``confidence`` and ``bbox`` (WKT, map coordinates).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .. import geo


@dataclass(frozen=True)
class ParcelResult:
    parcel: list[geo.Polygon]
    parcel_area_m2: float
    collection: str | None
    structure_count: int | None
    footprint_sf: float | None  # sum of structures' footprint.area (imperial request => sq ft)
    footprints_reported: int


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float | None
    bbox: list[geo.Polygon]


@dataclass(frozen=True)
class DetectionSummary:
    label: str
    detections: list[Detection] = field(default_factory=list)
    covered_m2: float = 0.0
    mean_confidence: float | None = None


def parse_property(body: dict[str, Any]) -> ParcelResult:
    feats = body.get("features") or []
    if not feats:
        raise ValueError("property/extract returned no features")
    parcel = feats[0]
    polys = geo.geometry_polygons(parcel.get("geometry"))
    attrs = parcel.get("properties") or {}
    structures = attrs.get("structures") or []
    areas = [s.get("footprint.area") for s in structures if isinstance(s, dict)]
    numeric = [float(a) for a in areas if isinstance(a, (int, float))]
    count = attrs.get("structure.count")
    return ParcelResult(
        parcel=polys,
        parcel_area_m2=geo.area_m2(polys),
        collection=attrs.get("metadata.collection"),
        structure_count=int(count) if isinstance(count, (int, float)) else None,
        footprint_sf=sum(numeric) if numeric else None,
        footprints_reported=len(numeric),
    )


def parse_detections(body: dict[str, Any]) -> list[Detection]:
    out: list[Detection] = []
    for feat in body.get("features") or []:
        props = feat.get("properties") or {}
        label = str(props.get("label", ""))
        for d in props.get("detections") or []:
            bbox = d.get("bbox")
            if not bbox:
                continue
            try:
                polys = geo.geometry_polygons(bbox)
            except ValueError:
                continue
            conf = d.get("confidence")
            out.append(Detection(label, float(conf) if isinstance(conf, (int, float)) else None, polys))
    return out


def summarize_label(detections: list[Detection], label: str, parcel: list[geo.Polygon],
                    cell_m: float = 0.5) -> DetectionSummary:
    """Union of a label's detection boxes inside the parcel, area-estimated on a grid."""
    ds = [d for d in detections if d.label == label]
    covers = [p for d in ds for p in d.bbox]
    covered = geo.covered_area_m2(parcel, covers, cell_m=cell_m) if covers else 0.0
    confs = [d.confidence for d in ds if d.confidence is not None]
    return DetectionSummary(label, ds, covered, round(sum(confs) / len(confs), 3) if confs else None)
