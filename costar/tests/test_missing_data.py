"""Recorded vacancy, parking separation and explicit missing-data states (synthetic)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from conftest import make_settings
from urbanlab_costar import synthetic
from urbanlab_costar.events import validate_event
from urbanlab_costar.kit import KitArchive, PropertyFilter, PropertyRepository, load_field_map
from urbanlab_costar.provenance import GapKind
from urbanlab_costar.tools import plan_research_tool, run_research_tool


@pytest.fixture
def repo(tmp_path: Path) -> PropertyRepository:
    return PropertyRepository(KitArchive(synthetic.build_kit(tmp_path)),
                              load_field_map(synthetic.write_field_map(tmp_path)))


def test_recorded_vacancy_validation(repo: PropertyRepository) -> None:
    props = {p.kit_id: p for p in repo.properties(PropertyFilter(region="houston", limit=100))}
    assert props["90007"].values["vacancy_pct"].value == 6.0
    assert props["90008"].values["vacancy_pct"].value == 0.0  # recorded zero is kept as recorded
    assert props["90009"].gaps["vacancy_pct"].kind is GapKind.ERROR  # 120 % rejected
    assert props["90001"].gaps["vacancy_pct"].kind is GapKind.MISSING_IN_RECORD


# ------------------------------------------------------------ pipeline level

SPEC = {**synthetic.DEMO_SPEC, "variables": [
    "year_built", "building_area_sf", "land_area_sf", "parking_spaces_covered", "garage_stalls",
    "surface_parking_sf", "vacancy_pct"]}


def test_garage_stalls_never_filled_from_covered_spaces(isolated: Path) -> None:
    plan = plan_research_tool(SPEC, "synthetic", settings=make_settings(isolated))
    garage = next(v for v in plan["variables"] if v["variable"] == "garage_stalls")
    assert garage["status"] == "unavailable"  # only a kit field could fill it, and none is mapped
    assert "not necessarily a garage" in garage["excluded_sources"]["costar"]
    out = run_research_tool(SPEC, "synthetic", settings=make_settings(isolated))
    assert not [e for e in out["events"] if e["type"] == "cell.filled" and e["variable"] == "garageStalls"]


def test_parking_count_and_area_stay_separate(isolated: Path) -> None:
    spec = {**SPEC, "variables": ["parking_spaces_surface", "surface_parking_sf", "land_area_sf"]}
    out = run_research_tool(spec, "synthetic", settings=make_settings(isolated))
    assert out["ok"]
    surf = [e for e in out["events"] if e["type"] == "cell.filled" and e["variable"] == "surfaceSf"]
    assert surf and all(e["cell"]["source"] == "vexcel" for e in surf)
    assert all("MODEL ESTIMATE" in e["cell"]["evidence"]["note"] for e in surf)


def test_frontend_never_gets_placeholders(isolated: Path) -> None:
    for profile in ("strict", "extended"):
        out = run_research_tool(SPEC, "synthetic", profile=profile, settings=make_settings(isolated))
        for e in out["events"]:
            assert validate_event(e, profile) == []
        props = {e["property"]["costarId"]: e["property"] for e in out["events"] if e["type"] == "property.added"}
        assert all("occupancyPct" not in p for p in props.values())
        for p in props.values():
            assert all(v is not None and v != "" for v in p.values())
        if profile == "strict":
            assert all("missing" not in p for p in props.values())


def test_property_ids_filter_and_parcel_area(isolated: Path) -> None:
    spec = {**synthetic.DEMO_SPEC, "property_ids": ["0090003"], "sample_limit": 1,
            "variables": ["land_area_sf", "parcel_area_sf", "footprint_sf", "surface_parking_sf"]}
    plan = plan_research_tool(spec, "synthetic", settings=make_settings(isolated))
    src = {v["variable"]: v["source"] for v in plan["variables"]}
    assert src == {"land_area_sf": "costar", "parcel_area_sf": "vexcel", "footprint_sf": "vexcel",
                   "surface_parking_sf": "vexcel"}
    out = run_research_tool(spec, "synthetic", settings=make_settings(isolated))
    (prop,) = out["dataset"]["properties"]
    assert prop["costar_id"] == "90003"
    assert prop["values"]["parcel_area_sf"]["source"] == "vexcel"
    assert prop["values"]["land_area_sf"]["source"] == "costar"
    assert out["requests_used"]["vexcel"] == 2  # one parcel lookup + one detection


# ---------------------------------------------------------- geographic scope

from urbanlab_costar.research.spec import resolve_region  # noqa: E402


@pytest.mark.parametrize("question,region", [
    ("Do older offices in Houston have more surface parking?", "houston"),
    ("Which Harris County industrial buildings are newest?", "houston"),
    ("How old are apartment buildings in Los Angeles?", "los_angeles"),
    ("Vacancy of LA apartments by class", "los_angeles"),
    ("What about L.A. offices?", "los_angeles"),
])
def test_resolve_supported_city(question: str, region: str) -> None:
    r = resolve_region(question)
    assert r["ok"] and r["region"] == region


@pytest.mark.parametrize("question,needle", [
    ("Office vacancy in Chicago", "does not name a supported city"),
    ("Parking at Princeton office parks", "Princeton, NJ is not supported"),
    ("San Francisco apartments by age", "Northern California is not supported"),
    ("Compare Houston and Los Angeles offices", "both Houston and Los Angeles"),
    ("la vida en la ciudad", "does not name a supported city"),  # lowercase 'la' is not LA
])
def test_unsupported_or_ambiguous_city_is_explained_not_substituted(question: str, needle: str) -> None:
    r = resolve_region(question)
    assert not r["ok"] and r["region"] is None and needle in r["message"]
    assert r["supportedRegions"] == ["Houston, TX", "Los Angeles, CA"]


def test_unsupported_region_emits_study_error(isolated: Path) -> None:
    seen: list[dict[str, Any]] = []
    out = run_research_tool({**synthetic.DEMO_SPEC, "region": "princeton"}, "synthetic", emit=seen.append,
                            settings=make_settings(isolated))
    assert not out["ok"] and seen and seen[0]["type"] == "study.error"
    assert "Houston, TX and Los Angeles, CA only" in seen[0]["message"]
    assert validate_event(seen[0]) == []


def test_property_info_carries_recorded_city_state_type(isolated: Path) -> None:
    out = run_research_tool(SPEC, "synthetic", settings=make_settings(isolated))
    props = [e["property"] for e in out["events"] if e["type"] == "property.added"]
    assert props and all(p["city"] == "Houston" and p["state"] == "TX" and p["propertyType"] == "Office" for p in props)


def test_extended_plan_lists_every_requested_variable(isolated: Path) -> None:
    spec = {**SPEC, "variables": ["year_built", "vacancy_pct", "garage_stalls", "market_id"]}
    out = run_research_tool(spec, "synthetic", settings=make_settings(isolated))  # extended is the default
    plan = next(e["plan"] for e in out["events"] if e["type"] == "plan.updated")
    assert [v["key"] for v in plan["variables"]] == ["yearBuilt", "vacancy_pct", "garageStalls", "market_id"]
    for e in out["events"]:
        assert validate_event(e, "extended") == []
