"""Structured research spec. The agent (LLM) turns a natural-language question
into this; we validate it strictly so unsupported requests fail loudly.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .. import geo
from .variables import VARIABLES

MAX_SAMPLE = 500


class SpecError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class ResearchSpec:
    question: str
    region: str
    variables: tuple[str, ...]
    property_types: tuple[str, ...] = ()
    filters: Mapping[str, tuple[float | None, float | None]] = field(default_factory=dict)
    sample_limit: int = 25
    hypothesis: str | None = None
    objective: str | None = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> ResearchSpec:
        errors: list[str] = []
        q = str(d.get("question") or "").strip()
        if not q:
            errors.append("question is required")
        region = str(d.get("region") or "").strip().lower()
        if region not in geo.REGIONS:
            errors.append(f"region must be one of {sorted(geo.REGIONS)}")
        variables = tuple(dict.fromkeys(str(v) for v in d.get("variables") or []))
        if not variables:
            errors.append("at least one variable is required")
        unknown = [v for v in variables if v not in VARIABLES]
        if unknown:
            errors.append(f"unsupported variables {unknown}; supported: {sorted(VARIABLES)}")
        filters: dict[str, tuple[float | None, float | None]] = {}
        for k, rng in (d.get("filters") or {}).items():
            if k not in VARIABLES:
                errors.append(f"filter on unsupported variable {k!r}")
                continue
            if not isinstance(rng, Mapping):
                errors.append(f"filter {k!r} must be {{min, max}}")
                continue
            lo, hi = rng.get("min"), rng.get("max")
            try:
                filters[k] = (None if lo is None else float(lo), None if hi is None else float(hi))
            except (TypeError, ValueError):
                errors.append(f"filter {k!r} bounds must be numbers")
        try:
            limit = int(d.get("sample_limit", 25))
        except (TypeError, ValueError):
            limit = 0
        if not 1 <= limit <= MAX_SAMPLE:
            errors.append(f"sample_limit must be within 1..{MAX_SAMPLE}")
        if errors:
            raise SpecError(errors)
        return cls(
            question=q, region=region, variables=variables,
            property_types=tuple(str(t) for t in d.get("property_types") or []),
            filters=filters, sample_limit=limit,
            hypothesis=(str(d["hypothesis"]) if d.get("hypothesis") else None),
            objective=(str(d["objective"]) if d.get("objective") else None),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question, "region": self.region, "variables": list(self.variables),
            "property_types": list(self.property_types),
            "filters": {k: {"min": lo, "max": hi} for k, (lo, hi) in self.filters.items()},
            "sample_limit": self.sample_limit, "hypothesis": self.hypothesis, "objective": self.objective,
        }


def spec_json_schema() -> dict[str, Any]:
    """JSON Schema for the agent's structured-output / tool-call arguments."""
    return {
        "type": "object",
        "required": ["question", "region", "variables"],
        "properties": {
            "question": {"type": "string"},
            "region": {"enum": sorted(geo.REGIONS)},
            "variables": {"type": "array", "items": {"enum": sorted(VARIABLES)}, "minItems": 1},
            "property_types": {"type": "array", "items": {"type": "string"},
                               "description": "matched case-insensitively against the kit's property type"},
            "filters": {"type": "object", "additionalProperties": {
                "type": "object", "properties": {"min": {"type": "number"}, "max": {"type": "number"}}}},
            "sample_limit": {"type": "integer", "minimum": 1, "maximum": MAX_SAMPLE},
            "hypothesis": {"type": "string"},
            "objective": {"type": "string"},
        },
        "additionalProperties": False,
    }
