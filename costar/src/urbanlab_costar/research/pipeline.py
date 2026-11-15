"""Execute a :class:`ResearchPlan`: select properties, collect values with
provenance, record gaps, and stream frontend-compatible events.

Approval, interviews and narrative analysis belong to the agent backend; the
pipeline ends after gaps are known (optionally signalling analysis/report for
a self-contained demo).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from ..dataset import Dataset, StudyProperty
from ..events import EventWriter, Profile
from ..interviews import interview_gap
from ..kit.repository import PropertyFilter, PropertyRepository
from ..matterport.adapter import MatterportAdapter
from ..provenance import Gap, GapKind, Source, Value, derive_ratio
from ..vexcel.adapter import VexcelAdapter
from .planner import ResearchPlan, study_plan_event_payload
from .variables import VARIABLES


class PlanError(RuntimeError):
    pass


@dataclass
class Adapters:
    repository: PropertyRepository
    vexcel: VexcelAdapter | None = None
    matterport: MatterportAdapter | None = None


@dataclass
class StudyResult:
    study_id: str
    dataset: Dataset
    events: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)
    contract_warnings: list[str] = field(default_factory=list)
    requests_used: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "study_id": self.study_id, "dataset": self.dataset.to_json(), "events": self.events,
            "warnings": self.warnings, "contract_warnings": self.contract_warnings,
            "requests_used": self.requests_used,
        }


class _Todos:
    def __init__(self, w: EventWriter, items: list[tuple[str, str]]) -> None:
        self.w = w
        self.items = [{"id": i, "label": label, "status": "pending"} for i, label in items]
        w.todos([dict(t) for t in self.items])

    def set(self, todo_id: str, status: str, detail: str | None = None) -> None:
        for t in self.items:
            if t["id"] == todo_id:
                t["status"] = status
                if detail:
                    t["detail"] = detail
        self.w.todos([dict(t) for t in self.items])


def _items(values: Mapping[str, Value], gaps: Mapping[str, Gap]) -> list[Value | Gap]:
    return [*values.values(), *gaps.values()]


def _collect_set(plan: ResearchPlan) -> list[str]:
    return list(plan.variables)  # requested + derived inputs, in resolution order


def run_research(
    plan: ResearchPlan,
    adapters: Adapters,
    *,
    study_id: str,
    emit: Callable[[dict[str, Any]], None] | None = None,
    profile: Profile = "strict",
    finalize: bool = False,
) -> StudyResult:
    if not plan.ok:
        raise PlanError("; ".join(plan.errors))
    spec = plan.spec
    w = EventWriter(emit, profile)
    warnings = list(plan.warnings)
    w.study_started(study_id, spec.question)
    w.stage("plan")
    w.plan_updated(study_plan_event_payload(plan))

    kit_vars = plan.chosen("kit:")
    vexcel_vars = plan.chosen("vexcel:")
    mp_index_vars = plan.chosen("matterport:index")
    mp_live_vars = plan.chosen("matterport:rooms")
    derived_vars = plan.chosen("derived:")

    steps = [("t-select", "Select properties from the CoStar kit"), ("t-kit", "Read CoStar attributes")]
    if vexcel_vars:
        steps.append(("t-vexcel", "Measure parcels / parking with Vexcel"))
    if mp_index_vars or mp_live_vars:
        steps.append(("t-mp", "Link Matterport scans"))
    steps.append(("t-gaps", "Identify evidence gaps"))
    todos = _Todos(w, steps)

    # ---------------------------------------------------------- selection
    w.stage("collect")
    todos.set("t-select", "running")
    records = adapters.repository.properties(PropertyFilter(
        region=spec.region, property_types=spec.property_types, ranges=spec.filters, limit=plan.sample_limit,
    ))
    w.tool("costar.kit.select_properties", summary=f"{len(records)} properties matched",
           args=f"region={spec.region} types={list(spec.property_types)} limit={plan.sample_limit}")
    todos.set("t-select", "done", f"{len(records)} properties")
    if not records:
        warnings.append("no properties in the kit matched the spec")

    dataset = Dataset(variables=_collect_set(plan))
    todos.set("t-kit", "running")
    for i, rec in enumerate(records, start=1):
        sp = StudyProperty(
            property_id=f"P-{i:02d}", costar_id=rec.kit_id, name=rec.get("name"), address=rec.get("address"),
            lat=rec.latlon[0] if rec.latlon else None, lon=rec.latlon[1] if rec.latlon else None,
        )
        dataset.properties.append(sp)
        for var in kit_vars:
            sp.set(rec.values.get(var) or rec.gaps.get(var)
                   or Gap(var, GapKind.MISSING_IN_RECORD, "empty in the CoStar record", Source.COSTAR))
        if adapters.matterport and (mp_index_vars or mp_live_vars):
            mres = adapters.matterport.collect(rec.kit_id, mp_index_vars)
            for item in _items(mres.values, mres.gaps):
                sp.set(item)
            if mres.showcase_url:
                sp.media["matterportUrl"] = mres.showcase_url
        info: dict[str, Any] = {"id": sp.property_id, "costarId": sp.costar_id,
                                "name": sp.name or f"CoStar {sp.costar_id}", "address": sp.address or ""}
        if sp.lat is not None and sp.lon is not None:
            info["lat"], info["lng"] = sp.lat, sp.lon
        if rec.get("building_class") is not None:
            info["propertyClass"] = str(rec.get("building_class"))
        if rec.get("occupancy_pct") is not None:
            info["occupancyPct"] = rec.get("occupancy_pct")
        info.update(sp.media)
        if "lat" not in info:
            warnings.append(f"{sp.property_id}: no coordinates in kit; kept in dataset, not sent to the map")
            continue
        w.property_added(info)
        for var in kit_vars | mp_index_vars:
            if var in sp.values:
                w.cell(sp.property_id, sp.values[var])
    todos.set("t-kit", "done")

    # ------------------------------------------------------------ measure
    if vexcel_vars:
        w.stage("measure")
        todos.set("t-vexcel", "running")
        stopped: Gap | None = None
        for sp in dataset.properties:
            if stopped is not None:
                for v in vexcel_vars:
                    sp.set(Gap(v, stopped.kind, f"not requested: {stopped.reason}", Source.VEXCEL))
                continue
            if adapters.vexcel is None:
                for v in vexcel_vars:
                    sp.set(Gap(v, GapKind.BLOCKED, "Vexcel adapter not configured", Source.VEXCEL))
                continue
            if sp.lat is None or sp.lon is None:
                for v in vexcel_vars:
                    sp.set(Gap(v, GapKind.MISSING_IN_RECORD, "no coordinates for Vexcel lookup", Source.VEXCEL))
                continue
            vres = adapters.vexcel.collect(sp.lat, sp.lon, vexcel_vars)
            for item in _items(vres.values, vres.gaps):
                sp.set(item)
                if isinstance(item, Value):
                    w.cell(sp.property_id, item)
            if vres.stop_provider:
                stopped = next(g for g in vres.gaps.values() if g.kind in (GapKind.BUDGET, GapKind.BLOCKED))
                warnings.append(f"Vexcel stopped after {sp.property_id}: {stopped.reason}")
        used = adapters.vexcel.client.requests_used if adapters.vexcel else 0
        w.tool("vexcel.collect", summary=f"{used} Vexcel request(s) this run")
        todos.set("t-vexcel", "done")

    if mp_live_vars and adapters.matterport:
        todos.set("t-mp", "running")
        for sp in dataset.properties:
            mres = adapters.matterport.collect(sp.costar_id, mp_live_vars)
            for item in _items(mres.values, mres.gaps):
                sp.set(item)
            if mres.stop_provider:
                warnings.append(f"Matterport stopped after {sp.property_id}")
                break
    if mp_index_vars or mp_live_vars:
        todos.set("t-mp", "done")

    # ------------------------------------------------------- derive + gaps
    w.stage("fill")
    todos.set("t-gaps", "running")
    for sp in dataset.properties:
        for var in derived_vars:
            opt = plan.variables[var].option
            assert opt is not None
            num, den = opt.requires.partition(":")[2].split(",")
            item = derive_ratio(var, sp.values.get(num) or sp.gaps.get(num), sp.values.get(den) or sp.gaps.get(den))
            sp.set(item)
        for var, vp in plan.variables.items():
            if vp.status == "requires_interview" and var not in sp.values:
                sp.set(interview_gap(var, [r for _, r in vp.rejected]))
            elif vp.status == "unavailable":
                reasons = "; ".join(r for _, r in vp.rejected) or "no source"
                sp.set(Gap(var, GapKind.NO_SOURCE, reasons))
        emitted = any(e.get("type") == "property.added" and e["property"]["id"] == sp.property_id
                      for e in w.events)
        if emitted:
            for g in sp.gaps.values():
                w.gap(sp.property_id, g)
    n_gaps = sum(len(p.gaps) for p in dataset.properties)
    todos.set("t-gaps", "done", f"{n_gaps} gap(s)")

    if finalize:
        w.stage("analyze")
        w.analysis_started()
        w.stage("report")
        w.report_ready(1)

    usage: dict[str, int] = {}
    if adapters.vexcel:
        usage["vexcel"] = adapters.vexcel.client.requests_used
    if adapters.matterport and adapters.matterport.client:
        usage["matterport"] = adapters.matterport.client.api.budget.used
    return StudyResult(study_id, dataset, w.events, warnings, w.contract_warnings, usage)


__all__ = ["VARIABLES", "Adapters", "PlanError", "StudyResult", "run_research"]
