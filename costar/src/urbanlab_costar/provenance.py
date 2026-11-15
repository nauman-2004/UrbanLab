"""Evidence provenance for every research value.

``method`` says HOW a value was obtained, independently of ``source``:

- ``observed``       : read directly from a record or measured by a provider
- ``computed``       : calculated by UrbanLab from observed inputs (e.g. parcel area from a polygon)
- ``model_estimate`` : produced by a model (segmentation, classification); carries confidence

``verification`` follows the frontend contract; every value here is ``observed``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Source(StrEnum):
    COSTAR = "costar"
    VEXCEL = "vexcel"
    MATTERPORT = "matterport"
    DERIVED = "derived"


class Method(StrEnum):
    OBSERVED = "observed"
    COMPUTED = "computed"
    MODEL_ESTIMATE = "model_estimate"


class Verification(StrEnum):
    OBSERVED = "observed"


# Weakest-link ordering used when combining inputs.
_STRENGTH = {Method.OBSERVED: 0, Method.COMPUTED: 1, Method.MODEL_ESTIMATE: 2}


@dataclass(frozen=True)
class EvidenceRef:
    ref: str
    note: str | None = None
    quote: str | None = None
    url: str | None = None


@dataclass(frozen=True)
class Value:
    variable: str
    value: Any
    source: Source
    method: Method
    evidence: EvidenceRef
    unit: str | None = None
    confidence: float | None = None
    uncertainty: str | None = None
    verification: Verification | None = None
    inputs: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.value is None:
            raise ValueError(f"{self.variable}: a Value cannot be None; record a Gap instead")
        if self.confidence is not None and not (0.0 <= self.confidence <= 1.0):
            raise ValueError(f"{self.variable}: confidence must be within [0, 1]")
        if self.verification is None:
            object.__setattr__(self, "verification", Verification.OBSERVED)

    def to_dict(self) -> dict[str, Any]:
        return {
            "variable": self.variable,
            "value": self.value,
            "unit": self.unit,
            "source": self.source.value,
            "method": self.method.value,
            "verification": (self.verification or Verification.OBSERVED).value,
            "confidence": self.confidence,
            "uncertainty": self.uncertainty,
            "evidence": {k: v for k, v in vars(self.evidence).items() if v is not None},
            "inputs": list(self.inputs),
        }


class GapKind(StrEnum):
    NOT_MAPPED = "not_mapped"  # the kit field map has no path for this variable
    MISSING_IN_RECORD = "missing_in_record"
    NO_SOURCE = "no_source"  # no digital source can observe it
    OUT_OF_COVERAGE = "out_of_coverage"
    NOT_FOUND = "not_found"  # provider had no record (e.g. Vexcel 404)
    BUDGET = "budget"
    BLOCKED = "blocked"  # live mode not enabled/approved
    ERROR = "error"


@dataclass(frozen=True)
class Gap:
    variable: str
    kind: GapKind
    reason: str
    source: Source | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "variable": self.variable,
            "kind": self.kind.value,
            "reason": self.reason,
            "source": self.source.value if self.source else None,
        }


def combine_method(*methods: Method) -> Method:
    worst = max(methods, key=lambda m: _STRENGTH[m])
    return Method.COMPUTED if worst in (Method.OBSERVED, Method.COMPUTED) else worst


def derive_ratio(variable: str, numerator: Value | Gap | None, denominator: Value | Gap | None,
                 *, unit: str = "ratio", note: str | None = None, scale: float = 1.0) -> Value | Gap:
    """numerator / denominator with inherited provenance (estimates stay estimates)."""
    missing = [v for v in (numerator, denominator) if not isinstance(v, Value)]
    if missing:
        names = [getattr(v, "variable", "?") for v in missing]
        return Gap(variable, GapKind.MISSING_IN_RECORD, f"needs {', '.join(names)}", Source.DERIVED)
    assert isinstance(numerator, Value) and isinstance(denominator, Value)
    try:
        num, den = float(numerator.value), float(denominator.value)
    except (TypeError, ValueError):
        return Gap(variable, GapKind.ERROR, "inputs are not numeric", Source.DERIVED)
    if den <= 0:
        return Gap(variable, GapKind.ERROR, f"{denominator.variable} is not positive", Source.DERIVED)
    method = combine_method(numerator.method, denominator.method)
    confs = [c for c in (numerator.confidence, denominator.confidence) if c is not None]
    return Value(
        variable=variable,
        value=round(num / den * scale, 4),
        unit=unit,
        source=Source.DERIVED,
        method=method,
        confidence=min(confs) if confs else None,
        uncertainty="inherits uncertainty of a model estimate" if method is Method.MODEL_ESTIMATE else None,
        verification=Verification.OBSERVED,
        evidence=EvidenceRef(
            ref=f"{numerator.variable} / {denominator.variable}",
            note=note or f"computed from {numerator.source.value} ({numerator.method.value}) and "
            f"{denominator.source.value} ({denominator.method.value})",
        ),
        inputs=(numerator.variable, denominator.variable),
    )
