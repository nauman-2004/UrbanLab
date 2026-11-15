"""Reproducible, provenance-aware study dataset with CSV/JSON export."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from typing import Any

from .provenance import Gap, Value


@dataclass
class StudyProperty:
    property_id: str  # stable within a study, e.g. "P-01"
    costar_id: str
    name: str | None
    address: str | None
    lat: float | None
    lon: float | None
    values: dict[str, Value] = field(default_factory=dict)
    gaps: dict[str, Gap] = field(default_factory=dict)
    media: dict[str, str] = field(default_factory=dict)  # runtime-only links (not exported)

    def set(self, item: Value | Gap) -> None:
        if isinstance(item, Value):
            self.values[item.variable] = item
            self.gaps.pop(item.variable, None)
        else:
            self.gaps[item.variable] = item
            self.values.pop(item.variable, None)


@dataclass
class Dataset:
    variables: list[str]
    properties: list[StudyProperty] = field(default_factory=list)

    def get(self, property_id: str) -> StudyProperty | None:
        return next((p for p in self.properties if p.property_id == property_id), None)

    def to_json(self) -> dict[str, Any]:
        return {
            "variables": self.variables,
            "properties": [{
                "property_id": p.property_id, "costar_id": p.costar_id, "name": p.name, "address": p.address,
                "lat": p.lat, "lon": p.lon,
                "values": {k: v.to_dict() for k, v in p.values.items()},
                "gaps": {k: g.to_dict() for k, g in p.gaps.items()},
            } for p in self.properties],
        }

    def to_csv(self) -> str:
        """One row per property; each variable has value/source/method/verification/confidence/evidence columns."""
        cols = ["property_id", "costar_id", "name", "lat", "lon"]
        for v in self.variables:
            cols += [v, f"{v}__source", f"{v}__method", f"{v}__verification", f"{v}__confidence",
                     f"{v}__evidence", f"{v}__gap"]
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols)
        w.writeheader()
        for p in self.properties:
            row: dict[str, Any] = {"property_id": p.property_id, "costar_id": p.costar_id, "name": p.name,
                                   "lat": p.lat, "lon": p.lon}
            for v in self.variables:
                val = p.values.get(v)
                if val is not None:
                    row[v] = json.dumps(val.value) if isinstance(val.value, (dict, list)) else val.value
                    row[f"{v}__source"] = val.source.value
                    row[f"{v}__method"] = val.method.value
                    row[f"{v}__verification"] = val.verification.value if val.verification else ""
                    row[f"{v}__confidence"] = "" if val.confidence is None else val.confidence
                    row[f"{v}__evidence"] = val.evidence.ref
                elif v in p.gaps:
                    row[f"{v}__gap"] = f"{p.gaps[v].kind.value}: {p.gaps[v].reason}"
            w.writerow(row)
        return buf.getvalue()
