"""Integration interface for interview-derived values (Cartesia flow is owned by
another teammate; nothing here places calls or touches their code).

- :func:`interview_requests` lists the gaps that only an interview can fill,
  for the agent's approval step (``approval.requested``).
- :class:`InterviewAnswer` is what the interview pipeline hands back; it becomes
  a self-reported, UNVERIFIED value with a quote and timestamp.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .dataset import Dataset
from .provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .research.variables import VARIABLES


@dataclass(frozen=True)
class InterviewAnswer:
    interview_id: str
    property_id: str
    variable: str
    value: float
    quote: str
    quote_t: float  # seconds into the call
    confidence: float  # LLM extraction confidence 0..1
    contact_role: str | None = None

    def to_value(self) -> Value:
        if self.variable not in VARIABLES:
            raise ValueError(f"unknown variable {self.variable!r}")
        if not self.quote.strip():
            raise ValueError("interview values require the supporting quote")
        mm, ss = divmod(int(self.quote_t), 60)
        return Value(
            variable=self.variable, value=self.value, unit=VARIABLES[self.variable].unit,
            source=Source.INTERVIEW, method=Method.SELF_REPORTED, confidence=self.confidence,
            evidence=EvidenceRef(ref=f"{self.interview_id} @ {mm:02d}:{ss:02d}", quote=self.quote,
                                 note=f"self-reported by {self.contact_role or 'contact'}; not independently verified"),
        )


def interview_requests(dataset: Dataset) -> list[dict[str, Any]]:
    """Gaps that require a human answer, grouped for one approval request."""
    out = []
    for p in dataset.properties:
        for g in p.gaps.values():
            if g.kind is GapKind.REQUIRES_INTERVIEW:
                out.append({"propertyId": p.property_id, "variable": g.variable, "reason": g.reason})
    return out


def apply_answer(dataset: Dataset, answer: InterviewAnswer) -> Value:
    prop = dataset.get(answer.property_id)
    if prop is None:
        raise KeyError(f"unknown property {answer.property_id}")
    gap = prop.gaps.get(answer.variable)
    if gap is None or gap.kind is not GapKind.REQUIRES_INTERVIEW:
        raise ValueError(f"{answer.property_id}.{answer.variable} is not an interview gap")
    value = answer.to_value()
    prop.set(value)
    return value


def interview_gap(variable: str, tried: list[str] | None = None) -> Gap:
    """Gap for a value only a person can supply, explaining what was ruled out."""
    parts = list(tried or [])
    parts += list(VARIABLES[variable].excluded_sources.values())
    why = "; ".join(parts) if parts else "no digital source provides this value"
    return Gap(variable, GapKind.REQUIRES_INTERVIEW, f"Needs an interview: {why}", Source.INTERVIEW)
