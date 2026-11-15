"""Local field map: canonical UrbanLab fields -> extraction rules for the kit schema.

The map lives OUTSIDE git (default ``costar/.local/field_map.toml``) because the
kit's schema is sponsor-confidential. Only placeholder examples are committed.

A field rule is one of:

- ``"a.b.c"`` or ``["a.b", "x.y"]``: dotted path(s); the first non-empty value wins
- a table with any of:
    ``path`` / ``paths``                 dotted path(s) to the value
    ``join = ["a", "b"]``                concatenate several text paths with spaces (e.g. an address)
    ``enum = "<EnumName>"``              decode integer codes with the kit's enum file
    ``list`` + ``take``                  read ``take`` from each item of a list ...
    ``where_field`` + ``where_in``       ... keeping only items whose field is in the set
    ``agg = "min|max|sum|count|count_null|first"``  ... combined this way (sum/count => computed;
                                         count_null counts items whose ``take`` is empty)
    ``unit_path`` + ``unit_map``         per-record unit, e.g. {"1" = "sf", "2" = "acres"}
    ``kind = "number|integer|text|bool"``
    ``skip_values = [0]``                codes meaning "unknown" (treated as missing)
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PROPERTY_FIELDS: dict[str, str] = {
    "name": "Building / property name",
    "address": "Street address",
    "city": "City",
    "state": "State code",
    "lat": "Latitude (WGS84)",
    "lon": "Longitude (WGS84)",
    "market_id": "Research market id (used for region selection)",
    "property_type": "Property type / use (e.g. Office)",
    "building_class": "Building class (A/B/C)",
    "year_built": "Year built",
    "building_area_sf": "Rentable building area (sq ft)",
    "land_area_sf": "Land / lot area",
    "parking_spaces": "Total parking spaces",
    "garage_stalls": "Structured / garage parking spaces",
    "parking_ratio": "Parking spaces per 1,000 sq ft",
    "vacancy_pct": "Percent vacant",
    "stories": "Number of stories",
}

UNIT_FACTORS_TO_SF: dict[str, float] = {"sf": 1.0, "sqft": 1.0, "acres": 43_560.0, "m2": 10.763910416709722}
FORMATS = {"json", "jsonl", "csv"}
AGGS = {"min", "max", "sum", "count", "count_null", "first"}
KINDS = {"auto", "number", "integer", "text", "bool"}


class MappingError(ValueError):
    pass


@dataclass(frozen=True)
class FieldSpec:
    paths: tuple[str, ...] = ()
    join: tuple[str, ...] = ()
    enum: str | None = None
    list_path: str | None = None
    take: str | None = None
    where_field: str | None = None
    where_in: frozenset[Any] = frozenset()
    agg: str = "first"
    unit_path: str | None = None
    unit_map: Mapping[str, str] = field(default_factory=dict)
    kind: str = "auto"
    skip_values: frozenset[Any] = frozenset()

    @property
    def configured(self) -> bool:
        return bool(self.paths or self.list_path or self.join)

    @property
    def aggregates(self) -> bool:
        return self.list_path is not None and self.agg in {"sum", "count", "count_null"}


@dataclass(frozen=True)
class DatasetMapping:
    name: str
    members: str
    format: str
    id: str
    records_path: str = ""
    fields: Mapping[str, FieldSpec] = field(default_factory=dict)
    units: Mapping[str, str] = field(default_factory=dict)

    def mapped(self) -> frozenset[str]:
        return frozenset(k for k, v in self.fields.items() if v.configured)


@dataclass(frozen=True)
class FieldMap:
    datasets: Mapping[str, DatasetMapping]
    source_path: Path | None = None
    enums_member: str | None = None
    as_of: str | None = None  # snapshot date of the kit (ISO)
    # region key -> accepted values of the canonical ``region_field`` (e.g. market ids)
    regions: Mapping[str, frozenset[str]] = field(default_factory=dict)
    region_field: str = "market_id"

    def get(self, name: str) -> DatasetMapping | None:
        return self.datasets.get(name)

    def property_fields(self) -> frozenset[str]:
        ds = self.datasets.get("commercial_property")
        return ds.mapped() if ds else frozenset()


def _paths(v: Any, where: str) -> tuple[str, ...]:
    if v is None or v == "":
        return ()
    if isinstance(v, str):
        vals = [v]
    elif isinstance(v, list) and all(isinstance(x, str) for x in v):
        vals = v
    else:
        raise MappingError(f"{where}: expected a path string or list of strings")
    vals = [x.strip() for x in vals if x.strip()]
    if any(x.startswith("<") for x in vals):
        return ()  # unfilled placeholder from the example file
    return tuple(vals)


def _field_spec(v: Any, where: str) -> FieldSpec:
    if not isinstance(v, dict):
        return FieldSpec(paths=_paths(v, where))
    unknown = set(v) - {"path", "paths", "join", "enum", "list", "take", "where_field", "where_in", "agg",
                        "unit_path", "unit_map", "kind", "skip_values"}
    if unknown:
        raise MappingError(f"{where}: unknown keys {sorted(unknown)}")
    paths = _paths(v.get("paths", v.get("path")), where)
    list_path = (str(v["list"]).strip() or None) if v.get("list") else None
    if list_path and list_path.startswith("<"):
        list_path = None
    agg = str(v.get("agg", "first"))
    kind = str(v.get("kind", "auto"))
    if agg not in AGGS:
        raise MappingError(f"{where}.agg must be one of {sorted(AGGS)}")
    if kind not in KINDS:
        raise MappingError(f"{where}.kind must be one of {sorted(KINDS)}")
    if list_path and not v.get("take") and agg not in {"count"}:
        raise MappingError(f"{where}: 'list' needs 'take' (or agg = \"count\")")
    unit_map = {str(k): str(u).lower() for k, u in (v.get("unit_map") or {}).items()}
    for u in unit_map.values():
        if u not in UNIT_FACTORS_TO_SF and u != "unknown":
            raise MappingError(f"{where}.unit_map: unknown unit {u!r}")
    return FieldSpec(
        paths=paths, join=_paths(v.get("join"), where), enum=v.get("enum"), list_path=list_path, take=v.get("take"),
        where_field=v.get("where_field"), where_in=frozenset(v.get("where_in") or []), agg=agg,
        unit_path=v.get("unit_path"), unit_map=unit_map, kind=kind,
        skip_values=frozenset(v.get("skip_values") or []),
    )


def parse_field_map(data: Mapping[str, Any], source: Path | None = None) -> FieldMap:
    raw = data.get("datasets")
    if not isinstance(raw, dict) or not raw:
        raise MappingError("field map needs a [datasets.<name>] table")
    out: dict[str, DatasetMapping] = {}
    for name, d in raw.items():
        if not isinstance(d, dict):
            raise MappingError(f"datasets.{name} must be a table")
        members = str(d.get("members", "")).strip()
        fmt = str(d.get("format", "json")).strip().lower()
        if not members or members.startswith("<"):
            continue  # placeholder: dataset not configured yet
        if fmt not in FORMATS:
            raise MappingError(f"datasets.{name}.format must be one of {sorted(FORMATS)}")
        ident = _paths(d.get("id"), f"datasets.{name}.id")
        if not ident:
            raise MappingError(f"datasets.{name}.id is required")
        fields_raw = d.get("fields", {}) or {}
        if not isinstance(fields_raw, dict):
            raise MappingError(f"datasets.{name}.fields must be a table")
        fields = {k: _field_spec(v, f"datasets.{name}.fields.{k}") for k, v in fields_raw.items()}
        units = {str(k): str(v).lower() for k, v in (d.get("units", {}) or {}).items()}
        for k, u in units.items():
            if u not in UNIT_FACTORS_TO_SF:
                raise MappingError(f"datasets.{name}.units.{k}: unknown unit {u!r}")
        out[name] = DatasetMapping(
            name=name, members=members, format=fmt, id=ident[0],
            records_path=str(d.get("records_path", "") or ""), fields=fields, units=units,
        )
    kit = data.get("kit") or {}
    as_of = str(kit.get("as_of") or "").strip()
    regions_raw = data.get("regions") or {}
    regions: dict[str, frozenset[str]] = {}
    for k, v in regions_raw.items():
        if k == "field":
            continue
        ids = frozenset(str(x) for x in (v if isinstance(v, list) else [v]) if not str(x).startswith("<"))
        if ids:
            regions[str(k).lower()] = ids
    enums_member = str(kit.get("enums") or "").strip()
    return FieldMap(out, source, enums_member=None if not enums_member or enums_member.startswith("<")
                    else enums_member, as_of=None if not as_of or as_of.startswith("<") else as_of,
                    regions=regions,
                    region_field=str(regions_raw.get("field", "market_id")))


def load_field_map(path: Path) -> FieldMap:
    if not path.is_file():
        raise MappingError(
            f"field map not found at {path}. Run `urbanlab-costar kit-inspect --write-draft` and fill it in."
        )
    with path.open("rb") as fh:
        return parse_field_map(tomllib.load(fh), path)


def get_path(record: Any, path: str) -> Any:
    """Resolve a dotted path (``a.b.0.c``) in nested dicts/lists. Missing -> None."""
    cur = record
    for part in path.split("."):
        if isinstance(cur, Mapping):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.lstrip("-").isdigit():
            idx = int(part)
            cur = cur[idx] if -len(cur) <= idx < len(cur) else None
        else:
            return None
        if cur is None:
            return None
    return cur


def first_present(record: Any, paths: tuple[str, ...]) -> tuple[Any, str | None]:
    for p in paths:
        v = get_path(record, p)
        if v is not None and not (isinstance(v, str) and not v.strip()):
            return v, p
    return None, None


@dataclass(frozen=True)
class Extracted:
    value: Any
    unit: str | None = None
    note: str | None = None
    aggregated: bool = False


def extract(record: Any, spec: FieldSpec, enums: Mapping[str, Mapping[str, str]] | None = None) -> Extracted | None:
    """Apply one field rule to one record. ``None`` means missing/unknown."""
    note = None
    if spec.list_path:
        items = get_path(record, spec.list_path)
        if not isinstance(items, list):
            return None
        if spec.where_field:
            items = [i for i in items if isinstance(i, Mapping) and i.get(spec.where_field) in spec.where_in]
        if spec.agg == "count":
            value: Any = len(items)
        elif spec.agg == "count_null":
            value = sum(1 for i in items if get_path(i, spec.take or "") is None)
        else:
            vals = [get_path(i, spec.take or "") for i in items]
            vals = [v for v in vals if v is not None
                    and not (isinstance(v, (int, float, str)) and v in spec.skip_values)]
            if not vals:
                return None
            if spec.agg == "first":
                value = vals[0]
            else:
                nums = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
                if not nums:
                    return None
                value = min(nums) if spec.agg == "min" else max(nums) if spec.agg == "max" else sum(nums)
            if spec.agg in {"sum", "count"}:
                note = f"{spec.agg} over {len(vals)} item(s)"
        extracted = Extracted(value, note=note, aggregated=spec.aggregates)
    elif spec.join:
        parts = [get_path(record, p) for p in spec.join]
        text = " ".join(str(x).strip() for x in parts if x is not None and str(x).strip())
        if not text:
            return None
        extracted = Extracted(text)
    else:
        value, _ = first_present(record, spec.paths)
        if value is None:
            return None
        extracted = Extracted(value)
    if spec.skip_values and isinstance(extracted.value, (int, float, str)) and extracted.value in spec.skip_values:
        return None
    if spec.enum:
        table = (enums or {}).get(spec.enum)
        if table is None:
            raise MappingError(f"enum {spec.enum!r} not found in the kit's enum file")
        decoded = table.get(str(extracted.value))
        if decoded is None:
            return None
        extracted = Extracted(decoded, note=extracted.note, aggregated=extracted.aggregated)
    if spec.unit_path:
        code = get_path(record, spec.unit_path)
        unit = spec.unit_map.get(str(code))
        if unit is None or unit == "unknown":
            return None  # a measurement without a known unit is not usable
        extracted = Extracted(extracted.value, unit=unit, note=extracted.note, aggregated=extracted.aggregated)
    return extracted
