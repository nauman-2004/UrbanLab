from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from urbanlab_costar import synthetic
from urbanlab_costar.kit import KitArchive, KitError, MappingError, PropertyFilter, PropertyRepository, load_field_map
from urbanlab_costar.kit.inspect import draft_field_map, render, summarize
from urbanlab_costar.kit.mapping import get_path, parse_field_map
from urbanlab_costar.kit.repository import normalize_id
from urbanlab_costar.provenance import GapKind, Method, Source


@pytest.fixture
def repo(tmp_path: Path) -> PropertyRepository:
    kit = KitArchive(synthetic.build_kit(tmp_path))
    return PropertyRepository(kit, load_field_map(synthetic.write_field_map(tmp_path)))


def test_normalize_id() -> None:
    assert normalize_id("0090001") == "90001"
    assert normalize_id(90001.0) == "90001"
    assert normalize_id(" A-12 ") == "A-12"
    assert normalize_id("") is None and normalize_id(None) is None


def test_get_path() -> None:
    rec = {"a": {"b": [{"c": 1}]}}
    assert get_path(rec, "a.b.0.c") == 1
    assert get_path(rec, "a.x.c") is None
    assert get_path(rec, "a.b.5.c") is None


def test_placeholder_mapping_is_ignored() -> None:
    fm = parse_field_map({"datasets": {"commercial_property": {"members": "<glob>", "id": "<id>"}}})
    assert fm.get("commercial_property") is None


def test_mapping_validation() -> None:
    with pytest.raises(MappingError):
        parse_field_map({"datasets": {"x": {"members": "a/*.json", "format": "xml", "id": "i"}}})
    with pytest.raises(MappingError):
        parse_field_map({"datasets": {"x": {"members": "a/*.json", "id": ""}}})
    with pytest.raises(MappingError):
        parse_field_map({"datasets": {"x": {"members": "a/*", "id": "i", "units": {"land_area_sf": "hectare?"}}}})


def test_select_filters_region_and_type(repo: PropertyRepository) -> None:
    props = repo.properties(PropertyFilter(region="houston", property_types=("office",), limit=50))
    assert len(props) == 12
    assert all("Office" in str(p.get("property_type")) for p in props)
    assert props[0].kit_id == "90001"  # leading zeros normalized, sorted by id


def test_values_have_provenance_and_missing_become_gaps(repo: PropertyRepository) -> None:
    props = {p.kit_id: p for p in repo.properties(PropertyFilter(region="houston", limit=50))}
    p1 = props["90001"]
    assert p1.values["year_built"].value == 1962
    assert p1.values["year_built"].source is Source.COSTAR and p1.values["year_built"].method is Method.OBSERVED
    assert p1.values["land_area_sf"].value == 60_000.0  # parsed from "60,000"
    assert props["90005"].gaps["year_built"].kind is GapKind.MISSING_IN_RECORD
    assert p1.gaps["garage_stalls"].kind is GapKind.NOT_MAPPED


def test_range_filter_and_limit(repo: PropertyRepository) -> None:
    old = repo.properties(PropertyFilter(region="houston", ranges={"year_built": (None, 1979)}, limit=50))
    assert {p.kit_id for p in old} == {"90001", "90002", "90003", "90004", "90006"}
    assert len(repo.properties(PropertyFilter(region="houston", limit=3))) == 3


def test_filter_on_unmapped_field_fails_loudly(repo: PropertyRepository) -> None:
    with pytest.raises(MappingError):
        repo.properties(PropertyFilter(ranges={"garage_stalls": (1, None)}))


def test_generic_join(repo: PropertyRepository) -> None:
    tenants = repo.lookup("synthetic_tenancy", "property_id", "90001")
    assert {t["tenant"] for t in tenants} == {"Tenant 0", "Tenant 3"}
    with pytest.raises(MappingError):
        repo.lookup("synthetic_tenancy", "nope", "1")


def test_directory_kit_blocks_path_escape(tmp_path: Path) -> None:
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "x.json").write_text("{}")
    kit = KitArchive(tmp_path / "d")
    assert kit.members() == ["x.json"]
    with pytest.raises(KitError):
        kit.open_binary("../escape.json")


def test_inspect_summarizes_without_values(repo: PropertyRepository) -> None:
    summaries = summarize(repo.kit, sample_per_group=5)
    text = render(summaries)
    assert "synthetic-commercial" in text and "facts.built" in text
    assert "Synthetic Office" not in text  # schema only, never record values
    assert "[datasets.synthetic_commercial]" in draft_field_map(summaries)


def test_not_a_zip(tmp_path: Path) -> None:
    bad = tmp_path / "k.zip"
    bad.write_text("nope")
    with pytest.raises(KitError):
        KitArchive(bad)


def test_unencrypted_zip_needs_no_password(tmp_path: Path) -> None:
    p = tmp_path / "k.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("a.csv", "id,x\n1,2\n")
    assert list(KitArchive(p).iter_csv("a.csv")) == [{"id": "1", "x": "2"}]
