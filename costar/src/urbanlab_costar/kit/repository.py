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
from .mapping import UNIT_FACTORS_TO_SF, DatasetMapping, FieldMap, MappingError, first_present

NUMERIC_FIELDS = {
    "lat", "lon", "year_built", "building_area_sf", "land_area_sf", "parking_spaces",
    "garage_stalls", "parking_ratio", "occupancy_pct", "vacancy_pct", "stories",
}
INT_FIELDS = {"year_built", "parking_spaces", "garage_stalls", "stories"}
AREA_FIELDS = {"building_area_sf", "land_area_sf"}
TEXT_FIELDS = {"name", "address", "city", "state", "property_type", "building_class"}


def normalize_id(v: Any) -> str | None:
    """Make identifiers comparable across datasets: '00123 ', 123, 123.0 -> '123'."""
    if v is None:
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


class PropertyRepository:
    PROPERTY_DATASET = "commercial_property"

    def __init__(self, kit: KitArchive, field_map: FieldMap) -> None:
        self.kit = kit
        self.field_map = field_map
        self._indexes: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = {}

    # ---------------------------------------------------------------- raw
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
                    from .mapping import get_path

                    obj = get_path(obj, ds.records_path) or []
                it = iter(obj if isinstance(obj, list) else [obj])
            for rec in it:
                yield rec
                n += 1
                if max_records is not None and n >= max_records:
                    return

    def records(self, name: str, max_records: int | None = None) -> Iterator[dict[str, Any]]:
        """Records as ``{"_id": ..., <canonical field>: value}`` (unmapped fields absent)."""
        ds = self._dataset(name)
        for rec in self.iter_raw(name, max_records):
            rid = normalize_id(first_present(rec, (ds.id,))[0])
            if rid is None:
                continue
            out: dict[str, Any] = {"_id": rid}
            for k, paths in ds.fields.items():
                v, _ = first_present(rec, paths)
                if v is not None:
                    out[k] = v
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

    def _to_property(self, rec: Mapping[str, Any], ds: DatasetMapping) -> PropertyRecord:
        pr = PropertyRecord(kit_id=str(rec["_id"]), dataset=ds.name)
        ref = f"CoStar kit · {ds.name} · {pr.kit_id}"
        for name, paths in ds.fields.items():
            if not paths:
                pr.gaps[name] = Gap(name, GapKind.NOT_MAPPED, "field not mapped in local field map", Source.COSTAR)
                continue
            raw = rec.get(name)
            if raw is None:
                pr.gaps[name] = Gap(name, GapKind.MISSING_IN_RECORD, "empty in the CoStar record", Source.COSTAR)
                continue
            note = None
            value: Any = raw
            if name in NUMERIC_FIELDS:
                num = _to_number(raw)
                if num is None:
                    pr.gaps[name] = Gap(name, GapKind.ERROR, "value in record is not numeric", Source.COSTAR)
                    continue
                unit = ds.units.get(name)
                if name in AREA_FIELDS and unit and unit not in {"sf", "sqft"}:
                    num *= UNIT_FACTORS_TO_SF[unit]
                    note = f"converted from {unit} to sq ft"
                value = int(round(num)) if name in INT_FIELDS else num
                if name == "year_built" and not (1700 <= value <= 2100):
                    pr.gaps[name] = Gap(name, GapKind.ERROR, f"implausible year {value}", Source.COSTAR)
                    continue
            elif name in TEXT_FIELDS:
                value = str(raw).strip()
            pr.values[name] = Value(
                variable=name, value=value, source=Source.COSTAR, method=Method.OBSERVED,
                unit="sf" if name in AREA_FIELDS else None, evidence=EvidenceRef(ref=ref, note=note),
            )
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
        if region and not ({"lat", "lon"} <= mapped or "city" in mapped):
            raise MappingError("cannot filter by region: map lat/lon or city")
        wanted_types = [t.lower() for t in flt.property_types]
        seen: set[str] = set()
        picked: list[PropertyRecord] = []
        for rec in sorted(self.records(self.PROPERTY_DATASET), key=lambda r: str(r["_id"])):
            if rec["_id"] in seen:
                continue  # duplicate ids across files: keep the first
            pr = self._to_property(rec, ds)
            if region and not self._in_region(pr, region):
                continue
            if wanted_types:
                pt = str(pr.get("property_type") or "").lower()
                if not any(t in pt for t in wanted_types):
                    continue
            if not self._in_ranges(pr, flt.ranges):
                continue
            if any(r not in pr.values for r in flt.require):
                continue
            seen.add(rec["_id"])
            picked.append(pr)
            if len(picked) >= flt.limit:
                break
        return picked

    @staticmethod
    def _in_region(pr: PropertyRecord, region: geo.Region) -> bool:
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
