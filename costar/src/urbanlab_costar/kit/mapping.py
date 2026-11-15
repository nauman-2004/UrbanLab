"""Local field map: canonical UrbanLab fields -> paths in the kit's own schema.

The map lives OUTSIDE git (default ``costar/.local/field_map.toml``) because the
kit's schema is sponsor-confidential. Only placeholder examples are committed.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Canonical fields the property repository understands. Each is optional:
# an unmapped field becomes an explicit "not_mapped" gap, never a guess.
PROPERTY_FIELDS: dict[str, str] = {
    "name": "Building / property name",
    "address": "Street address",
    "city": "City",
    "state": "State code",
    "lat": "Latitude (WGS84)",
    "lon": "Longitude (WGS84)",
    "property_type": "Property type / use (e.g. Office)",
    "building_class": "Building class (A/B/C)",
    "year_built": "Year built",
    "building_area_sf": "Rentable building area (sq ft)",
    "land_area_sf": "Land / lot area",
    "parking_spaces": "Total parking spaces",
    "garage_stalls": "Structured / garage parking spaces",
    "parking_ratio": "Parking spaces per 1,000 sq ft",
    "occupancy_pct": "Percent occupied / leased",
    "vacancy_pct": "Percent vacant",
    "stories": "Number of stories",
}

UNIT_FACTORS_TO_SF: dict[str, float] = {"sf": 1.0, "sqft": 1.0, "acres": 43_560.0, "m2": 10.763910416709722}
FORMATS = {"json", "jsonl", "csv"}


class MappingError(ValueError):
    pass


@dataclass(frozen=True)
class DatasetMapping:
    name: str
    members: str
    format: str
    id: str
    records_path: str = ""
    fields: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    units: Mapping[str, str] = field(default_factory=dict)

    def mapped(self) -> frozenset[str]:
        return frozenset(k for k, v in self.fields.items() if v)


@dataclass(frozen=True)
class FieldMap:
    datasets: Mapping[str, DatasetMapping]
    source_path: Path | None = None

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
        fields = {k: _paths(v, f"datasets.{name}.fields.{k}") for k, v in fields_raw.items()}
        units = {str(k): str(v).lower() for k, v in (d.get("units", {}) or {}).items()}
        for k, u in units.items():
            if u not in UNIT_FACTORS_TO_SF:
                raise MappingError(f"datasets.{name}.units.{k}: unknown unit {u!r}")
        out[name] = DatasetMapping(
            name=name, members=members, format=fmt, id=ident[0],
            records_path=str(d.get("records_path", "") or ""), fields=fields, units=units,
        )
    return FieldMap(out, source)


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
