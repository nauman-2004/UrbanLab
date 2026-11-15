"""Matterport values for a property: linked models (index, 0 requests) and,
optionally in live mode, room classifications (1 GraphQL request per model).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from ..budget import BudgetExceeded
from ..http import LiveModeDisabled, TransportError
from ..provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .client import MatterportClient, MatterportError, showcase_url
from .index import ModelsIndex
from ..kit.repository import normalize_id

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
    def __init__(self, index: ModelsIndex | None, client: MatterportClient | None = None,
                 links: Mapping[str, Sequence[str]] | None = None) -> None:
        """``links``: CoStar property id -> Matterport model ids (e.g. the kit's starter CSV)."""
        self.index = index
        self.client = client
        self.links = {normalize_id(k) or k: list(v) for k, v in (links or {}).items()}

    def collect(self, costar_id: str, wants: set[str]) -> MatterportResult:
        res = MatterportResult()
        wants = wants & SUPPORTED
        models = self.index.for_costar_property(costar_id) if self.index else []
        sids = [m.sid for m in models]
        sids += [s for s in self.links.get(normalize_id(costar_id) or costar_id, []) if s not in sids]
        res.sids = sids
        for sid in sids:
            try:
                res.showcase_url = showcase_url(sid)
                break
            except ValueError:
                continue
        sources = ["models_index.csv"] if self.index else []
        if self.links:
            sources.append("kit starter list")
        if "matterport_model_count" in wants:
            res.values["matterport_model_count"] = Value(
                variable="matterport_model_count", value=len(sids), source=Source.MATTERPORT,
                method=Method.OBSERVED, evidence=EvidenceRef(ref=" + ".join(sources) + " by property id",
                                                            note=SCOPE_NOTE),
            )
        if not sids:
            for v in wants - {"matterport_model_count"}:
                res.gaps[v] = Gap(v, GapKind.NOT_FOUND, "no Matterport model linked to this property", Source.MATTERPORT)
            return res
        if "scanned_room_count" in wants:
            if not models:
                res.gaps["scanned_room_count"] = Gap("scanned_room_count", GapKind.MISSING_IN_RECORD,
                                                     "linked models are not in models_index.csv", Source.MATTERPORT)
            counts = [m.room_count for m in models if m.room_count is not None]
            if counts and models:
                res.values["scanned_room_count"] = Value(
                    variable="scanned_room_count", value=max(counts), source=Source.MATTERPORT,
                    method=Method.OBSERVED,
                    evidence=EvidenceRef(ref=f"models_index.csv · {len(models)} model(s)",
                                         note=f"largest room count among linked models; {SCOPE_NOTE}"),
                )
            elif models:
                res.gaps["scanned_room_count"] = Gap("scanned_room_count", GapKind.MISSING_IN_RECORD,
                                                     "room_count empty in index", Source.MATTERPORT)
        if "room_labels" in wants:
            if self.client is None:
                res.gaps["room_labels"] = Gap("room_labels", GapKind.BLOCKED, "Matterport live client not configured",
                                              Source.MATTERPORT)
                return res
            try:
                rooms = self.client.model_rooms(sids[0])
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
                evidence=EvidenceRef(ref=f"Matterport rooms · model 1 of {len(sids)}",
                                     note=f"Matterport room classification; {SCOPE_NOTE}"),
            )
        return res
