"""Matterport values for a property: linked models (index, 0 requests) and,
optionally in live mode, room classifications (1 GraphQL request per model).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from ..budget import BudgetExceeded
from ..http import LiveModeDisabled, TransportError
from ..provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .client import MatterportClient, MatterportError, showcase_url
from .index import ModelsIndex

SCOPE_NOTE = "a scan may cover one suite, unit or amenity rather than the whole building"
INDEX_VARS = {"matterport_model_count", "scanned_room_count"}
LIVE_VARS = {"room_labels"}
SUPPORTED = INDEX_VARS | LIVE_VARS


@dataclass
class MatterportResult:
    values: dict[str, Value] = field(default_factory=dict)
    gaps: dict[str, Gap] = field(default_factory=dict)
    showcase_url: str | None = None
    sids: list[str] = field(default_factory=list)
    stop_provider: bool = False


class MatterportAdapter:
    def __init__(self, index: ModelsIndex, client: MatterportClient | None = None) -> None:
        self.index = index
        self.client = client

    def collect(self, costar_id: str, wants: set[str]) -> MatterportResult:
        res = MatterportResult()
        wants = wants & SUPPORTED
        models = self.index.for_costar_property(costar_id)
        res.sids = [m.sid for m in models]
        if models:
            try:
                res.showcase_url = showcase_url(models[0].sid)
            except ValueError:
                res.showcase_url = None
        if "matterport_model_count" in wants:
            res.values["matterport_model_count"] = Value(
                variable="matterport_model_count", value=len(models), source=Source.MATTERPORT,
                method=Method.OBSERVED, evidence=EvidenceRef(ref="models_index.csv by costar_property_id",
                                                            note=SCOPE_NOTE),
            )
        if not models:
            for v in wants - {"matterport_model_count"}:
                res.gaps[v] = Gap(v, GapKind.NOT_FOUND, "no Matterport model linked to this property", Source.MATTERPORT)
            return res
        if "scanned_room_count" in wants:
            counts = [m.room_count for m in models if m.room_count is not None]
            if counts:
                res.values["scanned_room_count"] = Value(
                    variable="scanned_room_count", value=max(counts), source=Source.MATTERPORT,
                    method=Method.OBSERVED,
                    evidence=EvidenceRef(ref=f"models_index.csv · {len(models)} model(s)",
                                         note=f"largest room count among linked models; {SCOPE_NOTE}"),
                )
            else:
                res.gaps["scanned_room_count"] = Gap("scanned_room_count", GapKind.MISSING_IN_RECORD,
                                                     "room_count empty in index", Source.MATTERPORT)
        if "room_labels" in wants:
            if self.client is None:
                res.gaps["room_labels"] = Gap("room_labels", GapKind.BLOCKED, "Matterport live client not configured",
                                              Source.MATTERPORT)
                return res
            try:
                rooms = self.client.model_rooms(models[0].sid)
            except (BudgetExceeded, LiveModeDisabled) as e:
                res.stop_provider = True
                kind = GapKind.BUDGET if isinstance(e, BudgetExceeded) else GapKind.BLOCKED
                res.gaps["room_labels"] = Gap("room_labels", kind, str(e), Source.MATTERPORT)
                return res
            except (MatterportError, TransportError) as e:
                res.gaps["room_labels"] = Gap("room_labels", GapKind.ERROR, str(e), Source.MATTERPORT)
                return res
            labels: Counter[str] = Counter()
            confs: list[float] = []
            for r in rooms:
                cls = (r.get("classifications") or [{}])[0]
                if cls.get("label") and cls["label"] != "Void":
                    labels[str(cls["label"])] += 1
                    if isinstance(cls.get("confidence"), (int, float)):
                        confs.append(float(cls["confidence"]))
            res.values["room_labels"] = Value(
                variable="room_labels", value=dict(labels), source=Source.MATTERPORT,
                method=Method.MODEL_ESTIMATE, confidence=round(min(confs), 3) if confs else None,
                evidence=EvidenceRef(ref=f"Matterport rooms · model 1 of {len(models)}",
                                     note=f"Matterport room classification; {SCOPE_NOTE}"),
            )
        return res
