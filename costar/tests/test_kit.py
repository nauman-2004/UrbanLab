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


# ------------------------------------------------------- rich field rules

from urbanlab_costar.kit.mapping import FieldSpec, extract  # noqa: E402

REC = {
    "t": 5,
    "ev": [{"k": 2, "y": 1975}, {"k": 4, "y": 1999}, {"k": 2, "y": 1970}, {"k": 4, "y": 2010}],
    "lot": 2.0, "lot_u": 2,
    "pk": [{"t": 1, "n": 10}, {"t": 3, "n": 5}, {"t": 1, "n": 4}, {"t": 9, "n": None}],
    "a": {"no": "12", "st": "Main", "ty": None},
    "att": [{"r": 36}, {"r": 0}, {"r": 234}],
    "cls": 0,
}
ENUMS = {"Kinds": {"0": "Unknown", "5": "Office"}, "Grades": {"0": "Unknown", "1": "A"}}


def test_enum_decoding_and_skip_values() -> None:
    assert extract(REC, FieldSpec(paths=("t",), enum="Kinds"), ENUMS).value == "Office"  # type: ignore[union-attr]
    assert extract(REC, FieldSpec(paths=("cls",), enum="Grades", skip_values=frozenset({0})), ENUMS) is None
    with pytest.raises(MappingError):
        extract(REC, FieldSpec(paths=("t",), enum="Missing"), ENUMS)


def test_list_filters_and_aggregates() -> None:
    built = extract(REC, FieldSpec(list_path="ev", where_field="k", where_in=frozenset({2}), take="y", agg="min"))
    reno = extract(REC, FieldSpec(list_path="ev", where_field="k", where_in=frozenset({4}), take="y", agg="max"))
    surface = extract(REC, FieldSpec(list_path="pk", where_field="t", where_in=frozenset({1}), take="n", agg="sum"))
    scans = extract(REC, FieldSpec(list_path="att", where_field="r", where_in=frozenset({36, 234}), agg="count"))
    assert built and built.value == 1970 and not built.aggregated
    assert reno and reno.value == 2010
    assert surface and surface.value == 14 and surface.aggregated
    assert scans and scans.value == 2
    # A type with no recorded spaces is missing, not zero.
    assert extract(REC, FieldSpec(list_path="pk", where_field="t", where_in=frozenset({9}), take="n", agg="sum")) is None


def test_per_record_units_and_join() -> None:
    spec = FieldSpec(paths=("lot",), unit_path="lot_u", unit_map={"1": "sf", "2": "acres", "0": "unknown"})
    assert extract(REC, spec).unit == "acres"  # type: ignore[union-attr]
    assert extract({**REC, "lot_u": 0}, spec) is None  # unknown unit => unusable
    assert extract(REC, FieldSpec(join=("a.no", "a.st", "a.ty"))).value == "12 Main"  # type: ignore[union-attr]


def test_rich_rules_parse_from_toml_tables() -> None:
    fm = parse_field_map({"kit": {"enums": "e.json"}, "regions": {"field": "mk", "houston": [14]}, "datasets": {
        "commercial_property": {"members": "d.jsonl", "format": "jsonl", "id": "id", "fields": {
            "year_built": {"list": "ev", "where_field": "k", "where_in": [2], "take": "y", "agg": "min"},
            "land_area_sf": {"path": "lot", "unit_path": "lot_u", "unit_map": {"2": "acres"}},
        }}}})
    assert fm.enums_member == "e.json" and fm.regions["houston"] == frozenset({"14"}) and fm.region_field == "mk"
    with pytest.raises(MappingError):
        parse_field_map({"datasets": {"x": {"members": "a", "id": "i", "fields": {"f": {"list": "l"}}}}})
    with pytest.raises(MappingError):
        parse_field_map({"datasets": {"x": {"members": "a", "id": "i", "fields": {"f": {"bogus": 1}}}}})


def test_region_selection_by_market_id(repo: PropertyRepository) -> None:
    hou = repo.properties(PropertyFilter(region="houston", limit=100))
    la = repo.properties(PropertyFilter(region="los_angeles", limit=100))
    assert {p.kit_id for p in la} == {"90102"}
    assert "90102" not in {p.kit_id for p in hou} and len(hou) == 13
    assert repo.last_match_count == 1


def test_matterport_links_merge_with_index(tmp_path: Path) -> None:
    from urbanlab_costar.matterport import MatterportAdapter, ModelsIndex
    from urbanlab_costar.runtime import matterport_links

    kit = KitArchive(synthetic.build_kit(tmp_path))
    repo = PropertyRepository(kit, load_field_map(synthetic.write_field_map(tmp_path)))
    links = matterport_links(repo)
    assert links == {"90001": ["SYNTHMODEL00"], "90002": ["SYNTHLINK002"], "90003": ["SYNTHLINK003"]}
    mp = MatterportAdapter(ModelsIndex.load(synthetic.write_models_index(tmp_path)), None, links)
    one = mp.collect("90001", {"matterport_model_count", "scanned_room_count"})
    assert one.values["matterport_model_count"].value == 1  # deduplicated across sources
    two = mp.collect("90002", {"matterport_model_count", "scanned_room_count"})
    assert two.values["matterport_model_count"].value == 1 and two.showcase_url
    assert two.gaps["scanned_room_count"].kind is GapKind.MISSING_IN_RECORD  # not in the index


def test_committed_example_is_placeholders_only() -> None:
    example = Path(__file__).resolve().parents[1] / "field_map.example.toml"
    assert dict(load_field_map(example).datasets) == {}  # every dataset is a placeholder
    import tomllib

    fm = parse_field_map({**tomllib.loads(example.read_text()),
                          "datasets": {"x": {"members": "a.csv", "format": "csv", "id": "i"}}})
    assert fm.enums_member is None and fm.regions == {}
