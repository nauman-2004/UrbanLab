from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from conftest import make_settings
from urbanlab_costar import synthetic
from urbanlab_costar.events import validate_event
from urbanlab_costar.interviews import InterviewAnswer, apply_answer, interview_requests
from urbanlab_costar.provenance import GapKind, Method, Verification
from urbanlab_costar.purge import UnsafePurge, purge
from urbanlab_costar.research import Capabilities, ResearchSpec, SpecError, plan_research
from urbanlab_costar.research.pipeline import run_research
from urbanlab_costar.runtime import build_runtime
from urbanlab_costar.tools import describe_capabilities, plan_research_tool, run_research_tool

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib"


def caps(**kw: Any) -> Capabilities:
    base: dict[str, Any] = dict(kit_ready=True, kit_fields=frozenset({"year_built", "building_area_sf", "property_type",
                                                                       "lat", "lon"}),
                                vexcel="live", vexcel_reason="ok", matterport_index=True, matterport_api="blocked",
                                matterport_reason="off", budgets={"vexcel": 100, "matterport": 0}, max_retries=2)
    base.update(kw)
    return Capabilities(**base)


# ------------------------------------------------------------------ spec

def test_spec_validation() -> None:
    with pytest.raises(SpecError) as e:
        ResearchSpec.from_dict({"question": "", "region": "mars", "variables": ["vibes"], "sample_limit": 0})
    assert len(e.value.errors) == 4
    s = ResearchSpec.from_dict(synthetic.DEMO_SPEC)
    assert s.region == "houston" and "surface_parking_sf" in s.variables


# --------------------------------------------------------------- planner

def test_houston_parking_plan_source_selection() -> None:
    plan = plan_research(ResearchSpec.from_dict(synthetic.DEMO_SPEC), caps())
    v = plan.variables
    assert v["year_built"].option.source.value == "costar"  # type: ignore[union-attr]
    assert v["land_area_sf"].option.requires == "vexcel:parcel"  # type: ignore[union-attr]  # kit field not mapped
    assert v["surface_parking_sf"].option.method is Method.MODEL_ESTIMATE  # type: ignore[union-attr]
    assert v["offsite_spaces"].status == "requires_interview"
    assert v["garage_stalls"].status == "requires_interview"
    assert "matterport" in v["garage_stalls"].to_dict()["excluded_sources"]
    assert v["surface_parking_share"].status == "available"
    assert plan.requests == {"vexcel": 40, "matterport": 0}  # 20 parcels + 20 detections
    assert plan.worst_case_requests["vexcel"] == 120
    assert plan.ok


def test_plan_flags_budget_and_blocked_live() -> None:
    plan = plan_research(ResearchSpec.from_dict(synthetic.DEMO_SPEC), caps(budgets={"vexcel": 10}))
    assert plan.within_budget["vexcel"] is False
    blocked = plan_research(ResearchSpec.from_dict(synthetic.DEMO_SPEC), caps(vexcel="blocked", vexcel_reason="off"))
    assert blocked.variables["surface_parking_sf"].status == "unavailable"
    assert blocked.variables["surface_parking_share"].status == "unavailable"
    assert blocked.requests["vexcel"] == 0


def test_only_houston_and_los_angeles_are_accepted() -> None:
    for region in ("princeton", "northern_california", "florida_panhandle", "chicago"):
        with pytest.raises(SpecError, match="houston"):
            ResearchSpec.from_dict({**synthetic.DEMO_SPEC, "region": region})
    assert ResearchSpec.from_dict({**synthetic.DEMO_SPEC, "region": "los_angeles"}).region == "los_angeles"
    from urbanlab_costar.research import spec_json_schema

    assert spec_json_schema()["properties"]["region"]["enum"] == ["houston", "los_angeles"]


def test_filters_must_be_on_mapped_kit_fields() -> None:
    spec = ResearchSpec.from_dict({**synthetic.DEMO_SPEC, "filters": {"surface_parking_sf": {"min": 1}}})
    assert not plan_research(spec, caps()).ok


# ------------------------------------------------- pipeline + contract

@pytest.fixture
def result(isolated: Path) -> Any:
    settings = make_settings(isolated)
    with build_runtime(settings, "synthetic") as rt:
        plan = plan_research(ResearchSpec.from_dict(synthetic.DEMO_SPEC), rt.capabilities)
        assert rt.adapters is not None
        yield run_research(plan, rt.adapters, study_id="st-test", finalize=True)


def test_every_event_satisfies_strict_contract(result: Any) -> None:
    for e in result.events:
        assert validate_event(e) == [], e
    types = [e["type"] for e in result.events]
    assert types[0] == "study.started" and types[-1] == "report.ready"
    # property.added always precedes that property's cells
    seen: set[str] = set()
    for e in result.events:
        if e["type"] == "property.added":
            seen.add(e["property"]["id"])
        if e["type"] in {"cell.filled"}:
            assert e["propertyId"] in seen


@pytest.mark.skip(reason="The frontend now consumes the agent backend's events (backend/events.py, "
                         "frontend/src/lib/events.ts). urbanlab_costar.events targets the earlier StudyEvent "
                         "format and is only used by this package's CLI demo; the backend calls the data adapters.")
def test_contract_constants_match_frontend_source() -> None:
    types_ts = (FRONTEND / "types.ts").read_text()
    events_ts = (FRONTEND / "events.ts").read_text()
    from urbanlab_costar.events import REQUIRED, SOURCES, VARIABLE_KEYS

    for k in VARIABLE_KEYS:
        assert f'"{k}"' in types_ts
    for s in SOURCES:
        assert f'"{s}"' in types_ts
    for t in REQUIRED:
        assert f'type: "{t}"' in events_ts


def test_dataset_provenance_and_gaps(result: Any) -> None:
    ds = result.dataset
    assert len(ds.properties) == 12
    p1 = ds.get("P-01")
    share = p1.values["surface_parking_share"]
    assert share.method is Method.MODEL_ESTIMATE and share.inputs == ("surface_parking_sf", "land_area_sf")
    assert p1.values["land_area_sf"].source.value == "costar"  # kit mapped in synthetic map
    p10 = ds.get("P-10")  # synthetic Vexcel 404
    assert p10.gaps["surface_parking_sf"].kind is GapKind.NOT_FOUND
    assert p10.gaps["surface_parking_share"].kind is GapKind.MISSING_IN_RECORD
    assert all(p.gaps["offsite_spaces"].kind is GapKind.REQUIRES_INTERVIEW for p in ds.properties)
    csv_text = ds.to_csv()
    assert "surface_parking_sf__method" in csv_text and "model_estimate" in csv_text
    old = [p.values["surface_parking_share"].value for p in ds.properties[:6] if "surface_parking_share" in p.values]
    new = [p.values["surface_parking_share"].value for p in ds.properties[6:] if "surface_parking_share" in p.values]
    assert min(old) > max(new)  # the synthetic pattern survives the whole pipeline


def test_model_estimates_are_labelled_in_strict_events(result: Any) -> None:
    surf = [e for e in result.events if e["type"] == "cell.filled" and e["variable"] == "surfaceSf"]
    assert surf and all("MODEL ESTIMATE" in e["cell"]["evidence"]["note"] for e in surf)
    assert all(0 <= e["cell"]["evidence"]["confidence"] <= 1 for e in surf)


def test_interview_interface_values_stay_unverified(result: Any) -> None:
    reqs = interview_requests(result.dataset)
    assert {r["variable"] for r in reqs} == {"garage_stalls", "offsite_spaces"}
    v = apply_answer(result.dataset, InterviewAnswer("iv-01", "P-01", "offsite_spaces", 120, "about a hundred "
                                                     "and twenty spaces in the lot across the street", 72, 0.86,
                                                     "Property manager"))
    assert v.verification is Verification.UNVERIFIED and v.evidence.ref == "iv-01 @ 01:12"
    assert v.verified("Parking lease agreement").verification is Verification.VERIFIED
    with pytest.raises(ValueError):
        apply_answer(result.dataset, InterviewAnswer("iv-02", "P-01", "year_built", 1970, "q", 1, 0.5))


def test_extended_profile_adds_provenance(isolated: Path) -> None:
    out = run_research_tool(synthetic.DEMO_SPEC, "synthetic", profile="extended",
                            settings=make_settings(isolated))
    cells = [e for e in out["events"] if e["type"] == "cell.filled"]
    assert all("provenance" in e["cell"] for e in cells)
    assert {e["variable"] for e in cells} >= {"matterport_model_count"}
    for e in out["events"]:
        assert validate_event(e, "extended") == []


def test_tools_surface_is_json_serializable(isolated: Path) -> None:
    s = make_settings(isolated)
    json.dumps(describe_capabilities("synthetic", s))
    json.dumps(plan_research_tool(synthetic.DEMO_SPEC, "synthetic", settings=s))
    assert plan_research_tool({"question": "x"}, settings=s)["ok"] is False
    out = run_research_tool(synthetic.DEMO_SPEC, "synthetic", settings=s)
    json.dumps(out)
    assert out["ok"] and out["requests_used"]["vexcel"] == 23  # 12 parcel lookups (one 404) + 11 detections


def test_real_mode_without_config_reports_problems(isolated: Path) -> None:
    out = plan_research_tool(synthetic.DEMO_SPEC, "real", settings=make_settings(isolated))
    assert out["ok"] is False and any("COSTAR_KIT_ZIP" in p for p in out["problems"])
    run = run_research_tool(synthetic.DEMO_SPEC, "real", settings=make_settings(isolated))
    assert run["ok"] is False


# ------------------------------------------------------------------ purge

def test_purge_dry_run_then_delete(isolated: Path) -> None:
    s = make_settings(isolated)
    s.data_dir.mkdir(parents=True)
    (s.data_dir / "field_map.toml").write_text("x")
    report = purge(s)
    assert report.dry_run and s.data_dir.resolve() in report.targets and s.data_dir.exists()
    purge(s, dry_run=False)
    assert not s.data_dir.exists()


def test_purge_refuses_dangerous_targets(isolated: Path) -> None:
    with pytest.raises(UnsafePurge):
        purge(make_settings(isolated, URBANLAB_SPONSOR_DATA_DIR=str(isolated)), dry_run=True)
    with pytest.raises(UnsafePurge):
        purge(make_settings(isolated, URBANLAB_SPONSOR_DATA_DIR=str(Path.home())), dry_run=True)


def test_budget_exhaustion_mid_run_stops_provider(isolated: Path) -> None:
    from urbanlab_costar.budget import RequestBudget

    with build_runtime(make_settings(isolated), "synthetic") as rt:
        assert rt.adapters is not None and rt.adapters.vexcel is not None
        rt.adapters.vexcel.client.api.budget = RequestBudget("vexcel", 5, 1000.0)
        plan = plan_research(ResearchSpec.from_dict(synthetic.DEMO_SPEC), rt.capabilities)
        res = run_research(plan, rt.adapters, study_id="st-budget")
    assert res.requests_used["vexcel"] == 5
    tail = res.dataset.properties[-1]
    assert tail.gaps["surface_parking_sf"].kind is GapKind.BUDGET
    assert any("Vexcel stopped" in w for w in res.warnings)
    for e in res.events:
        assert validate_event(e) == []
