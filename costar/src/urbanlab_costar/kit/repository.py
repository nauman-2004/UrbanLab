"""Reusable research operations over the kit: iterate, filter, look up, join.

Every value carries provenance; any field that is unmapped or empty becomes an
explicit :class:`~urbanlab_costar.provenance.Gap` rather than a default.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from .. import geo
from ..provenance import EvidenceRef, Gap, GapKind, Method, Source, Value
from .archive import KitArchive
from .mapping import UNIT_FACTORS_TO_SF, DatasetMapping, Extracted, FieldMap, MappingError, extract, get_path

NUMERIC_FIELDS = {
    "lat", "lon", "year_built", "building_area_sf", "land_area_sf", "parking_spaces",
    "garage_stalls", "parking_ratio", "occupancy_pct", "vacancy_pct", "stories",
}
INT_FIELDS = {"year_built", "parking_spaces", "garage_stalls", "stories"}
TEXT_FIELDS = {"name", "address", "city", "state", "property_type", "building_class"}
YEAR_FIELDS = {"year_built", "year_renovated"}


def is_area_field(name: str) -> bool:
    return name.endswith("_sf")


def normalize_id(v: Any) -> str | None:
    """Make identifiers comparable across datasets: '00123 ', 123, 123.0 -> '123'."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if s.isdigit():
        s = s.lstrip("0") or "0"
    return s or None


def _to_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "").rstrip("%")
        try:
            return float(s)
        except ValueError:
            return None
    return None


@dataclass
class PropertyRecord:
    kit_id: str
    dataset: str
    values: dict[str, Value] = field(default_factory=dict)
    gaps: dict[str, Gap] = field(default_factory=dict)

    def get(self, name: str) -> Any:
        v = self.values.get(name)
        return v.value if v else None

    @property
    def latlon(self) -> tuple[float, float] | None:
        lat, lon = self.get("lat"), self.get("lon")
        return (float(lat), float(lon)) if lat is not None and lon is not None else None


@dataclass(frozen=True)
class PropertyFilter:
    region: str | None = None
    property_types: tuple[str, ...] = ()
    ranges: Mapping[str, tuple[float | None, float | None]] = field(default_factory=dict)
    require: tuple[str, ...] = ()
    limit: int = 25
    ids: tuple[str, ...] = ()


class PropertyRepository:
    PROPERTY_DATASET = "commercial_property"

    def __init__(self, kit: KitArchive, field_map: FieldMap) -> None:
        self.kit = kit
        self.field_map = field_map
        self._indexes: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = {}
        self._enums: dict[str, dict[str, str]] | None = None
        self.last_match_count = 0

    # ---------------------------------------------------------------- raw
    @property
    def enums(self) -> dict[str, dict[str, str]]:
        if self._enums is None:
            self._enums = {}
            if self.field_map.enums_member:
                raw = self.kit.read_json(self.field_map.enums_member)
                if isinstance(raw, dict):
                    self._enums = {str(k): {str(c): str(n) for c, n in v.items()}
                                   for k, v in raw.items() if isinstance(v, dict)}
        return self._enums

    def _dataset(self, name: str) -> DatasetMapping:
        ds = self.field_map.get(name)
        if ds is None:
            raise MappingError(f"dataset {name!r} is not configured in the field map")
        return ds

    def iter_raw(self, name: str, max_records: int | None = None) -> Iterator[Any]:
        ds = self._dataset(name)
        n = 0
        for member in sorted(self.kit.match(ds.members)):
            if ds.format == "csv":
                it: Iterator[Any] = self.kit.iter_csv(member)
            elif ds.format == "jsonl":
                it = self.kit.iter_jsonl(member)
            else:
                obj = self.kit.read_json(member)
                if ds.records_path:
                    obj = get_path(obj, ds.records_path) or []
                it = iter(obj if isinstance(obj, list) else [obj])
            for rec in it:
                yield rec
                n += 1
                if max_records is not None and n >= max_records:
                    return

    def _extract_all(self, rec: Any, ds: DatasetMapping) -> dict[str, Extracted]:
        out: dict[str, Extracted] = {}
        for k, spec in ds.fields.items():
            if spec.configured:
                ex = extract(rec, spec, self.enums)
                if ex is not None:
                    out[k] = ex
        return out

    def records(self, name: str, max_records: int | None = None) -> Iterator[dict[str, Any]]:
        """Records as ``{"_id": ..., <canonical field>: value}`` (missing fields absent)."""
        ds = self._dataset(name)
        for rec in self.iter_raw(name, max_records):
            rid = normalize_id(get_path(rec, ds.id))
            if rid is None:
                continue
            out: dict[str, Any] = {"_id": rid}
            for k, ex in self._extract_all(rec, ds).items():
                out[k] = ex.value
            yield out

    def lookup(self, name: str, field_name: str, key: Any) -> list[dict[str, Any]]:
        """All records of dataset ``name`` whose canonical ``field_name`` equals ``key`` (normalized)."""
        idx_key = (name, field_name)
        if idx_key not in self._indexes:
            ds = self._dataset(name)
            if field_name != "_id" and field_name not in ds.mapped():
                raise MappingError(f"{name}.{field_name} is not mapped; cannot join on it")
            idx: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for r in self.records(name):
                k = normalize_id(r.get(field_name))
                if k is not None:
                    idx[k].append(r)
            self._indexes[idx_key] = dict(idx)
        nk = normalize_id(key)
        return list(self._indexes[idx_key].get(nk, [])) if nk else []

    # --------------------------------------------------------- properties
    def available_fields(self) -> frozenset[str]:
        return self.field_map.property_fields()

    def _value(self, name: str, ex: Extracted, ds: DatasetMapping, ref: str) -> Value | Gap:
        raw = ex.value
        notes = [n for n in [ex.note] if n]
        spec = ds.fields[name]
        numeric = name in NUMERIC_FIELDS or spec.kind in {"number", "integer"} or is_area_field(name)
        value: Any = raw
        unit = None
        if numeric:
            num = _to_number(raw)
            if num is None:
                return Gap(name, GapKind.ERROR, "value in record is not numeric", Source.COSTAR)
            src_unit = ex.unit or ds.units.get(name)
            if is_area_field(name):
                unit = "sf"
                if src_unit and src_unit not in {"sf", "sqft"}:
                    num *= UNIT_FACTORS_TO_SF[src_unit]
                    notes.append(f"converted from {src_unit} to sq ft")
            if name in INT_FIELDS or spec.kind == "integer" or name in YEAR_FIELDS:
                value = int(round(num))
            else:
                value = round(num, 2) if is_area_field(name) else num
            if name in YEAR_FIELDS and not (1700 <= value <= 2100):
                return Gap(name, GapKind.ERROR, f"implausible year {value}", Source.COSTAR)
            if name.endswith("_pct") and not (0 <= value <= 100):
                return Gap(name, GapKind.ERROR, f"recorded percentage {value} is outside 0-100", Source.COSTAR)
        elif name in TEXT_FIELDS or spec.kind == "text":
            value = str(raw).strip()
        elif spec.kind == "bool":
            if not isinstance(raw, bool):
                return Gap(name, GapKind.ERROR, "value in record is not true/false", Source.COSTAR)
        return Value(
            variable=name, value=value, source=Source.COSTAR,
            method=Method.COMPUTED if ex.aggregated else Method.OBSERVED, unit=unit,
            evidence=EvidenceRef(ref=ref, note="; ".join(notes) or None),
        )

    def _to_property(self, rec: Any, ds: DatasetMapping, rid: str) -> PropertyRecord:
        pr = PropertyRecord(kit_id=rid, dataset=ds.name)
        ref = f"CoStar kit · {ds.name} · {rid}"
        extracted = self._extract_all(rec, ds)
        for name, spec in ds.fields.items():
            if not spec.configured:
                pr.gaps[name] = Gap(name, GapKind.NOT_MAPPED, "field not mapped in local field map", Source.COSTAR)
                continue
            ex = extracted.get(name)
            if ex is None:
                pr.gaps[name] = Gap(name, GapKind.MISSING_IN_RECORD, "not recorded in the CoStar record",
                                    Source.COSTAR)
                continue
            item = self._value(name, ex, ds, ref)
            if isinstance(item, Value):
                pr.values[name] = item
            else:
                pr.gaps[name] = item
        return pr

    def properties(self, flt: PropertyFilter) -> list[PropertyRecord]:
        ds = self._dataset(self.PROPERTY_DATASET)
        mapped = ds.mapped()
        for f in [*flt.ranges, *flt.require]:
            if f not in mapped:
                raise MappingError(f"cannot filter on {f!r}: not mapped in the field map")
        if flt.property_types and "property_type" not in mapped:
            raise MappingError("cannot filter on property type: 'property_type' is not mapped")
        region = geo.REGIONS.get(flt.region) if flt.region else None
        if flt.region and region is None:
            raise ValueError(f"unknown region {flt.region!r}")
        region_values = self.field_map.regions.get(flt.region or "") if flt.region else None
        rfield = self.field_map.region_field
        if region and region_values is None and not ({"lat", "lon"} <= mapped or "city" in mapped):
            raise MappingError("cannot filter by region: map [regions] market ids, lat/lon or city")
        wanted_types = [t.lower() for t in flt.property_types]
        seen: set[str] = set()
        wanted_ids = {normalize_id(i) for i in flt.ids} - {None}
        matched: list[PropertyRecord] = []
        # Stream: each raw record is reduced to its small PropertyRecord immediately.
        for rec in self.iter_raw(self.PROPERTY_DATASET):
            rid = normalize_id(get_path(rec, ds.id))
            if rid is None or rid in seen:
                continue  # duplicate ids across files: keep the first
            seen.add(rid)
            if wanted_ids and rid not in wanted_ids:
                continue
            pr = self._to_property(rec, ds, rid)
            if region and not self._in_region(pr, region, region_values, rfield):
                continue
            if wanted_types:
                pt = str(pr.get("property_type") or "").lower()
                if not any(t == pt or t in pt for t in wanted_types):
                    continue
            if not self._in_ranges(pr, flt.ranges):
                continue
            if any(r not in pr.values for r in flt.require):
                continue
            matched.append(pr)
        matched.sort(key=lambda p: (len(p.kit_id), p.kit_id))  # deterministic sample
        self.last_match_count = len(matched)
        return matched[: flt.limit]

    @staticmethod
    def _in_region(pr: PropertyRecord, region: geo.Region, region_values: frozenset[str] | None,
                   rfield: str) -> bool:
        if region_values is not None:
            return normalize_id(pr.get(rfield)) in region_values
        ll = pr.latlon
        if ll is not None:
            return region.bbox.contains(*ll)
        city = str(pr.get("city") or "").strip().lower()
        return bool(city) and city in {c.lower() for c in region.city_names}

    @staticmethod
    def _in_ranges(pr: PropertyRecord, ranges: Mapping[str, tuple[float | None, float | None]]) -> bool:
        for name, (lo, hi) in ranges.items():
            v = _to_number(pr.get(name))
            if v is None or (lo is not None and v < lo) or (hi is not None and v > hi):
                return False
        return True
