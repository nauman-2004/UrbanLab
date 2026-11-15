"""Source selection and cost estimation for a research spec.

The planner never calls a provider. It decides, per variable, which configured
source can honestly supply it, which variables are unavailable (and why), and
how many authenticated requests a run would need against the approved budget.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .. import geo
from ..config import Settings
from ..provenance import Source
from .spec import ResearchSpec
from .variables import SourceOption, parse_derived, variable

ProviderState = Literal["live", "offline", "blocked"]


@dataclass(frozen=True)
class Capabilities:
    kit_ready: bool
    kit_fields: frozenset[str]
    vexcel: ProviderState
    vexcel_reason: str
    matterport_index: bool
    matterport_api: ProviderState
    matterport_reason: str
    budgets: dict[str, int] = field(default_factory=dict)
    max_retries: int = 2
    kit_joins: frozenset[str] = frozenset()
    kit_join_reasons: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_settings(cls, settings: Settings, kit_fields: frozenset[str], kit_ready: bool,
                      index_ready: bool, kit_joins: frozenset[str] = frozenset(),
                      kit_join_reasons: dict[str, str] | None = None) -> Capabilities:
        v_ok, v_why = settings.live_allowed("vexcel")
        m_ok, m_why = settings.live_allowed("matterport")
        return cls(
            kit_ready=kit_ready, kit_fields=kit_fields,
            vexcel="live" if v_ok else "blocked", vexcel_reason=v_why,
            matterport_index=index_ready,
            matterport_api="live" if m_ok else "blocked", matterport_reason=m_why,
            budgets={"vexcel": settings.vexcel.max_requests, "matterport": settings.matterport.max_requests},
            max_retries=settings.max_retries, kit_joins=kit_joins, kit_join_reasons=kit_join_reasons or {},
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kit_ready": self.kit_ready, "kit_fields": sorted(self.kit_fields),
            "vexcel": self.vexcel, "vexcel_reason": self.vexcel_reason,
            "matterport_index": self.matterport_index, "matterport_api": self.matterport_api,
            "matterport_reason": self.matterport_reason, "budgets": self.budgets,
            "kit_joins": sorted(self.kit_joins), "kit_join_reasons": self.kit_join_reasons,
        }


@dataclass
class VariablePlan:
    variable: str
    status: Literal["available", "requires_interview", "unavailable"]
    option: SourceOption | None
    rejected: list[tuple[str, str]] = field(default_factory=list)  # (requires, reason)
    requested: bool = True
    label: str = ""
    excluded: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "variable": self.variable, "status": self.status, "requested": self.requested,
            "source": self.option.source.value if self.option else None,
            "method": self.option.method.value if self.option else None,
            "requires": self.option.requires if self.option else None,
            "note": self.option.note if self.option else None,
            "rejected": [{"requires": r, "reason": why} for r, why in self.rejected],
            "excluded_sources": self.excluded,
        }


@dataclass
class ResearchPlan:
    spec: ResearchSpec
    variables: dict[str, VariablePlan]
    sample_limit: int
    requests: dict[str, int]
    worst_case_requests: dict[str, int]
    within_budget: dict[str, bool]
    errors: list[str]
    warnings: list[str]

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def needs_live_requests(self) -> bool:
        return any(n > 0 for n in self.requests.values())

    def chosen(self, requires_prefix: str) -> set[str]:
        return {k for k, vp in self.variables.items()
                if vp.status == "available" and vp.option and vp.option.requires.startswith(requires_prefix)}

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok, "spec": self.spec.to_dict(), "sample_limit": self.sample_limit,
            "variables": [vp.to_dict() for vp in self.variables.values()],
            "requests": self.requests, "worst_case_requests_with_retries": self.worst_case_requests,
            "within_budget": self.within_budget, "needs_live_requests": self.needs_live_requests,
            "errors": self.errors, "warnings": self.warnings,
        }


def _check_option(opt: SourceOption, region: str, caps: Capabilities) -> str | None:
    """None if usable, else the reason it is not."""
    kind, _, arg = opt.requires.partition(":")
    if kind == "kit":
        if region not in geo.COVERAGE["costar"]:
            return f"CoStar kit covers {sorted(geo.COVERAGE['costar'])} only"
        if not caps.kit_ready:
            return "CoStar kit or field map not configured"
        if arg not in caps.kit_fields:
            return f"kit field '{arg}' is not mapped (or not present in the kit)"
        return None
    if kind == "vexcel":
        if region not in geo.COVERAGE["vexcel"]:
            return "outside Vexcel geofence"
        if caps.vexcel == "blocked":
            return f"Vexcel live requests blocked: {caps.vexcel_reason}"
        return None
    if kind == "matterport":
        if region not in geo.COVERAGE["matterport"]:
            return f"Matterport models exist only in {sorted(geo.COVERAGE['matterport'])}"
        if not caps.matterport_index:
            return "models index CSV not configured"
        if arg == "rooms" and caps.matterport_api == "blocked":
            return f"Matterport API blocked: {caps.matterport_reason}"
        return None
    if kind == "kitjoin":
        if region not in geo.COVERAGE["costar"]:
            return f"CoStar kit covers {sorted(geo.COVERAGE['costar'])} only"
        if arg not in caps.kit_joins:
            return caps.kit_join_reasons.get(arg, f"kit join '{arg}' is not configured")
        return None
    if kind in {"interview", "derived"}:
        return None
    return f"unknown requirement {opt.requires}"


def plan_research(spec: ResearchSpec, caps: Capabilities, *, max_properties: int | None = None) -> ResearchPlan:
    errors: list[str] = []
    warnings: list[str] = []
    plans: dict[str, VariablePlan] = {}

    def resolve(key: str, requested: bool, stack: tuple[str, ...] = ()) -> VariablePlan:
        if key in plans:
            if requested:
                plans[key].requested = True
            return plans[key]
        var = variable(key, caps.kit_fields)
        vp = VariablePlan(key, "unavailable", None, requested=requested, label=var.label,
                          excluded=dict(var.excluded_sources))
        for opt in var.options:
            why = _check_option(opt, spec.region, caps)
            if why is None and opt.requires.startswith("derived:"):
                num, den, _ = parse_derived(opt.requires)
                inputs = [num, den]
                if any(i in stack for i in inputs):
                    why = "circular derivation"
                else:
                    subs = [resolve(i, False, (*stack, key)) for i in inputs]
                    bad = [s.variable for s in subs if s.status == "unavailable"]
                    why = f"inputs unavailable: {bad}" if bad else None
            if why is None and opt.requires == "kitjoin:tenancy" and key == "occupancy_pct":
                rba = resolve("building_area_sf", False, (*stack, key))
                why = None if rba.status == "available" else "needs rentable building area (building_area_sf)"
            if why is None:
                vp.option = opt
                vp.status = "requires_interview" if opt.requires == "interview" else "available"
                break
            vp.rejected.append((opt.requires, why))
        plans[key] = vp
        return vp

    for v in spec.variables:
        resolve(v, True)

    if spec.region not in geo.COVERAGE["costar"]:
        errors.append(
            f"No property sample source for '{spec.region}': the CoStar kit covers "
            f"{sorted(geo.COVERAGE['costar'])}. Vexcel coverage alone does not give a building sample."
        )
    elif not caps.kit_ready:
        errors.append("CoStar kit not configured: set COSTAR_KIT_ZIP, COSTAR_ZIP_PASSWORD and a local field map")
    for f in spec.filters:
        if f not in caps.kit_fields:
            errors.append(f"filter on '{f}' needs a mapped kit field (filters are applied before any API call)")
    if spec.property_types and "property_type" not in caps.kit_fields:
        errors.append("property_types filter needs the kit field 'property_type' mapped")
    for vp in plans.values():
        if vp.requested and vp.status == "unavailable":
            warnings.append(f"{vp.variable}: unavailable ({'; '.join(r for _, r in vp.rejected)})")
        if vp.requested and vp.status == "requires_interview":
            warnings.append(f"{vp.variable}: only obtainable by interview (self-reported, unverified)")

    n = min(spec.sample_limit, max_properties or spec.sample_limit)
    if n < spec.sample_limit:
        warnings.append(f"sample capped at {n} properties by URBANLAB_MAX_PROPERTIES")

    chosen = [vp.option.requires for vp in plans.values() if vp.status == "available" and vp.option]
    requests = {"vexcel": 0, "matterport": 0}
    if caps.vexcel == "live":
        if any(r.startswith("vexcel:") for r in chosen):
            requests["vexcel"] += n  # property/extract (parcel), shared by all Vexcel variables
        if "vexcel:detect" in chosen:
            requests["vexcel"] += n  # elements/detect
    if caps.matterport_api == "live" and "matterport:rooms" in chosen:
        requests["matterport"] += n  # upper bound: only properties with a linked model
    worst = {k: v * (1 + caps.max_retries) for k, v in requests.items()}
    within = {k: requests[k] <= caps.budgets.get(k, 0) for k in requests}
    for k, ok in within.items():
        if not ok:
            warnings.append(f"{k}: plan needs {requests[k]} requests but the budget is {caps.budgets.get(k, 0)}; "
                            "the run will stop that provider when the budget is reached")
    return ResearchPlan(spec, plans, n, requests, worst, within, errors, warnings)


def study_plan_event_payload(plan: ResearchPlan) -> dict[str, Any]:
    """The frontend ``StudyPlan`` (only variables with a frontend VariableKey)."""
    from .variables import FRONTEND_KEYS

    variables = []
    for vp in plan.variables.values():
        fk = FRONTEND_KEYS.get(vp.variable)
        if fk and vp.requested and vp.option:
            variables.append({"key": fk, "label": vp.label, "source": vp.option.source.value})
    region = geo.REGIONS[plan.spec.region].label
    types = ", ".join(plan.spec.property_types) or "all property types"
    return {
        "question": plan.spec.question,
        "hypothesis": plan.spec.hypothesis or "No hypothesis stated",
        "variables": variables,
        "sample": f"Up to {plan.sample_limit} {types} properties in {region} from the CoStar kit",
    }


__all__ = ["Capabilities", "ResearchPlan", "Source", "VariablePlan", "plan_research", "study_plan_event_payload"]
