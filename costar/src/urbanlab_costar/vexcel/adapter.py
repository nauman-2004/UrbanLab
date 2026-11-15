"""Turn Vexcel calls into provenance-tagged research values (or explicit gaps)."""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import geo
from ..budget import BudgetExceeded
from ..http import LiveModeDisabled, TransportError
from ..provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .client import VexcelClient, VexcelError, VexcelNotFound
from .parse import parse_detections, parse_property, summarize_label

PARCEL_VARS = {"land_area_sf", "footprint_sf"}
PARKING_VAR = "surface_parking_sf"
SUPPORTED = PARCEL_VARS | {PARKING_VAR}


@dataclass
class VexcelResult:
    values: dict[str, Value] = field(default_factory=dict)
    gaps: dict[str, Gap] = field(default_factory=dict)
    parcel_wkt: str | None = None
    stop_provider: bool = False  # budget exhausted / live blocked: skip remaining properties


class VexcelAdapter:
    def __init__(self, client: VexcelClient, parking_label: str = "parking lot",
                 detection_threshold: float = 0.5) -> None:
        self.client = client
        self.parking_label = parking_label
        self.threshold = detection_threshold

    def collect(self, lat: float, lon: float, wants: set[str]) -> VexcelResult:
        res = VexcelResult()
        wants = wants & SUPPORTED
        if not wants:
            return res

        def fail(kind: GapKind, reason: str, variables: set[str]) -> VexcelResult:
            for v in variables:
                res.gaps[v] = Gap(v, kind, reason, Source.VEXCEL)
            return res

        try:
            body = self.client.property_extract(lat, lon)
            parcel = parse_property(body)
        except geo.GeofenceError as e:
            return fail(GapKind.OUT_OF_COVERAGE, str(e), wants)
        except VexcelNotFound:
            return fail(GapKind.NOT_FOUND, "Vexcel has no property record (parcel) at this point", wants)
        except (BudgetExceeded, LiveModeDisabled) as e:
            res.stop_provider = True
            return fail(GapKind.BUDGET if isinstance(e, BudgetExceeded) else GapKind.BLOCKED, str(e), wants)
        except (VexcelError, TransportError, ValueError) as e:
            return fail(GapKind.ERROR, f"property/extract failed: {e}", wants)

        ref = f"Vexcel property/extract · {parcel.collection or 'collection n/a'}"
        res.parcel_wkt = geo.polygon_wkt(parcel.parcel[0])
        if "land_area_sf" in wants:
            res.values["land_area_sf"] = Value(
                variable="land_area_sf", value=round(parcel.parcel_area_m2 * geo.SQM_TO_SQFT),
                unit="sf", source=Source.VEXCEL, method=Method.COMPUTED,
                evidence=EvidenceRef(ref=ref, note="parcel polygon area computed by UrbanLab (local planar projection)"),
            )
        if "footprint_sf" in wants:
            if parcel.footprint_sf is None:
                res.gaps["footprint_sf"] = Gap("footprint_sf", GapKind.MISSING_IN_RECORD,
                                               "no structure footprint area in Vexcel response", Source.VEXCEL)
            else:
                res.values["footprint_sf"] = Value(
                    variable="footprint_sf", value=round(parcel.footprint_sf), unit="sf",
                    source=Source.VEXCEL, method=Method.MODEL_ESTIMATE,
                    evidence=EvidenceRef(ref=ref, note=f"Vexcel Elements pre-computed footprint, "
                                                       f"{parcel.footprints_reported} structure(s)"),
                    uncertainty="imagery-derived building footprint",
                )

        if PARKING_VAR in wants:
            try:
                det = self.client.detect_elements(lat, lon, res.parcel_wkt, [self.parking_label], self.threshold)
                summary = summarize_label(parse_detections(det), self.parking_label, parcel.parcel)
            except (BudgetExceeded, LiveModeDisabled) as e:
                res.stop_provider = True
                kind = GapKind.BUDGET if isinstance(e, BudgetExceeded) else GapKind.BLOCKED
                res.gaps[PARKING_VAR] = Gap(PARKING_VAR, kind, str(e), Source.VEXCEL)
                return res
            except (VexcelError, geo.GeofenceError, TransportError, ValueError) as e:
                res.gaps[PARKING_VAR] = Gap(PARKING_VAR, GapKind.ERROR, f"elements/detect failed: {e}", Source.VEXCEL)
                return res
            n = len(summary.detections)
            res.values[PARKING_VAR] = Value(
                variable=PARKING_VAR, value=round(summary.covered_m2 * geo.SQM_TO_SQFT), unit="sf",
                source=Source.VEXCEL, method=Method.MODEL_ESTIMATE, confidence=summary.mean_confidence,
                evidence=EvidenceRef(
                    ref=f"Vexcel elements/detect (sam3) '{self.parking_label}' · {n} detection(s)",
                    note=("union of detection boxes inside the parcel, 0.5 m grid; "
                          "model estimate, not a survey measurement")
                    if n else f"no '{self.parking_label}' detections above threshold {self.threshold}",
                ),
                uncertainty=("bounding boxes overstate irregular lots and may include drive aisles; "
                             "spot-check a sample manually") if n else
                "zero detections is not proof of zero parking",
            )
        return res
