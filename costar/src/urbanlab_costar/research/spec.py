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
# Research is limited to where the CoStar kit (the property sample) has data.
SUPPORTED_REGIONS = tuple(sorted(geo.COVERAGE["costar"]))


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
    property_ids: tuple[str, ...] = ()  # optional: restrict to these kit property ids

    @classmethod
    def from_dict(cls, d: Mapping[str, Any], extra_variables: frozenset[str] = frozenset()) -> ResearchSpec:
        errors: list[str] = []
        q = str(d.get("question") or "").strip()
        if not q:
            errors.append("question is required")
        region = str(d.get("region") or "").strip().lower()
        if region not in SUPPORTED_REGIONS:
            errors.append(f"region must be one of {list(SUPPORTED_REGIONS)} (CoStar kit coverage)")
        variables = tuple(dict.fromkeys(str(v) for v in d.get("variables") or []))
        if not variables:
            errors.append("at least one variable is required")
        known = set(VARIABLES) | set(extra_variables)
        unknown = [v for v in variables if v not in known]
        if unknown:
            errors.append(f"unsupported variables {unknown}; supported: {sorted(known)}")
        filters: dict[str, tuple[float | None, float | None]] = {}
        for k, rng in (d.get("filters") or {}).items():
            if k not in known:
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
        ids = d.get("property_ids") or []
        if not isinstance(ids, list) or len(ids) > MAX_SAMPLE:
            errors.append(f"property_ids must be a list of at most {MAX_SAMPLE} ids")
            ids = []
        if len(q) > 2000:
            errors.append("question is too long (max 2000 characters)")
        if len(variables) > 40:
            errors.append("too many variables (max 40)")
        if errors:
            raise SpecError(errors)
        return cls(
            question=q, region=region, variables=variables,
            property_types=tuple(str(t) for t in d.get("property_types") or []),
            filters=filters, sample_limit=limit,
            hypothesis=(str(d["hypothesis"]) if d.get("hypothesis") else None),
            objective=(str(d["objective"]) if d.get("objective") else None),
            property_ids=tuple(str(i).strip() for i in ids if str(i).strip()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question, "region": self.region, "variables": list(self.variables),
            "property_types": list(self.property_types),
            "filters": {k: {"min": lo, "max": hi} for k, (lo, hi) in self.filters.items()},
            "sample_limit": self.sample_limit, "hypothesis": self.hypothesis, "objective": self.objective,
            "property_ids": list(self.property_ids),
        }


def spec_json_schema(extra_variables: frozenset[str] = frozenset()) -> dict[str, Any]:
    """JSON Schema for the agent's structured-output / tool-call arguments."""
    names = sorted(set(VARIABLES) | set(extra_variables))
    return {
        "type": "object",
        "required": ["question", "region", "variables"],
        "properties": {
            "question": {"type": "string", "maxLength": 2000},
            "region": {"enum": list(SUPPORTED_REGIONS),
                       "description": "UrbanLab studies are limited to Houston and Los Angeles"},
            "variables": {"type": "array", "items": {"enum": names}, "minItems": 1, "maxItems": 40},
            "property_types": {"type": "array", "items": {"type": "string"},
                               "description": "matched case-insensitively against the kit's property type"},
            "filters": {"type": "object", "additionalProperties": {
                "type": "object", "properties": {"min": {"type": "number"}, "max": {"type": "number"}}}},
            "sample_limit": {"type": "integer", "minimum": 1, "maximum": MAX_SAMPLE},
            "hypothesis": {"type": "string"},
            "property_ids": {"type": "array", "items": {"type": ["string", "integer"]}, "maxItems": MAX_SAMPLE,
                             "description": "optional: only these CoStar property ids"},
            "objective": {"type": "string"},
        },
        "additionalProperties": False,
    }
