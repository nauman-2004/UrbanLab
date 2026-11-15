"""Tenancy join, recorded vacancy, parking separation and explicit missing-data states (synthetic)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from conftest import make_settings
from urbanlab_costar import synthetic
from urbanlab_costar.events import validate_event
from urbanlab_costar.kit import KitArchive, PropertyFilter, PropertyRepository, load_field_map
from urbanlab_costar.kit.tenancy import parse_date, summarize, tenancy_available, tenancy_values
from urbanlab_costar.provenance import GapKind, Method, Source
from urbanlab_costar.tools import plan_research_tool, run_research_tool


@pytest.fixture
def repo(tmp_path: Path) -> PropertyRepository:
    return PropertyRepository(KitArchive(synthetic.build_kit(tmp_path)),
                              load_field_map(synthetic.write_field_map(tmp_path)))


def _rba(repo: PropertyRepository, kit_id: str) -> Any:
    props = {p.kit_id: p for p in repo.properties(PropertyFilter(region="houston", limit=100))}
    return props[kit_id].values.get("building_area_sf")


def test_parse_date_handles_iso_variants() -> None:
    assert str(parse_date("2026-06-30T00:00:00Z")) == "2026-06-30"
    assert str(parse_date("2026-06-30")) == "2026-06-30"
    assert parse_date(None) is None and parse_date("not a date") is None


def test_tenancy_classification(repo: PropertyRepository) -> None:
    assert tenancy_available(repo) == (True, "ok")
    s = summarize(repo)
    one = s["90001"]
    assert (one.records, one.current, one.ended, one.future, one.occupied_sf) == (4, 2, 1, 1, 90_000.0)
    assert s["90006"].current == 1 and s["90006"].future == 1  # leased-not-moved-in excluded
    assert s["90002"].current_missing_sf == 1
    assert "90005" not in s


def test_occupancy_rules_never_invent_values(repo: PropertyRepository) -> None:
    s = summarize(repo)
    ok = tenancy_values("90001", s["90001"], _rba(repo, "90001"), "2026-06-30")
    pct = ok["occupancy_pct"]
    assert getattr(pct, "value") == 50.0 and getattr(pct, "method") is Method.COMPUTED
    assert "not a vacancy rate" in getattr(pct, "evidence").note
    missing_sf = tenancy_values("90002", s["90002"], _rba(repo, "90002"), "2026-06-30")
    assert missing_sf["occupancy_pct"].kind is GapKind.MISSING_IN_RECORD  # type: ignore[union-attr]
    over = tenancy_values("90003", s["90003"], _rba(repo, "90003"), "2026-06-30")
    assert over["occupancy_pct"].kind is GapKind.ERROR  # type: ignore[union-attr]
    ended = tenancy_values("90004", s["90004"], _rba(repo, "90004"), "2026-06-30")
    assert getattr(ended["tenancy_count_current"], "value") == 0  # a real count of current records
    assert ended["occupancy_pct"].kind is GapKind.MISSING_IN_RECORD  # type: ignore[union-attr]  # not 0 %
    none = tenancy_values("90005", None, _rba(repo, "90005"), "2026-06-30")
    assert all(g.kind is GapKind.MISSING_IN_RECORD for g in none.values())  # type: ignore[union-attr]
    no_rba = tenancy_values("90001", s["90001"], None, "2026-06-30")
    assert no_rba["occupancy_pct"].kind is GapKind.MISSING_IN_RECORD  # type: ignore[union-attr]


def test_recorded_vacancy_validation(repo: PropertyRepository) -> None:
    props = {p.kit_id: p for p in repo.properties(PropertyFilter(region="houston", limit=100))}
    assert props["90007"].values["vacancy_pct"].value == 6.0
    assert props["90008"].values["vacancy_pct"].value == 0.0  # recorded zero is kept as recorded
    assert props["90009"].gaps["vacancy_pct"].kind is GapKind.ERROR  # 120 % rejected
    assert props["90001"].gaps["vacancy_pct"].kind is GapKind.MISSING_IN_RECORD


def test_tenancy_join_requires_configuration(tmp_path: Path) -> None:
    fm_path = synthetic.write_field_map(tmp_path)
    fm_path.write_text(fm_path.read_text().replace('as_of = "2026-06-30"', ""))
    repo = PropertyRepository(KitArchive(synthetic.build_kit(tmp_path)), load_field_map(fm_path))
    ok, why = tenancy_available(repo)
    assert not ok and "as_of" in why


# ------------------------------------------------------------ pipeline level

SPEC = {**synthetic.DEMO_SPEC, "variables": [
    "year_built", "building_area_sf", "land_area_sf", "parking_spaces_covered", "garage_stalls",
    "surface_parking_sf", "occupancy_pct", "tenancy_count_current", "vacancy_pct"]}


def test_garage_stalls_never_filled_from_covered_spaces(isolated: Path) -> None:
    plan = plan_research_tool(SPEC, "synthetic", settings=make_settings(isolated))
    garage = next(v for v in plan["variables"] if v["variable"] == "garage_stalls")
    assert garage["status"] == "requires_interview"
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
        assert props["90001"]["occupancyPct"] == 50.0
        assert "occupancyPct" not in props["90002"]  # absent, never "undefined", null or 0
        for p in props.values():
            assert all(v is not None and v != "" for v in p.values())
        if profile == "extended":
            assert "current tenancies have no occupied area" in props["90002"]["missing"]["occupancyPct"]
        else:
            assert all("missing" not in p for p in props.values())


def test_tenancy_cells_carry_provenance(isolated: Path) -> None:
    out = run_research_tool(SPEC, "synthetic", profile="extended", settings=make_settings(isolated))
    occ = [e for e in out["events"] if e["type"] == "cell.filled" and e["variable"] == "occupancy_pct"]
    assert occ and all(e["cell"]["provenance"]["method"] == "computed" for e in occ)
    assert all(e["cell"]["source"] == Source.COSTAR.value for e in occ)


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
