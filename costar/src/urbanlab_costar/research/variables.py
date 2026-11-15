"""Catalog of research variables and the sources that can (honestly) provide them.

Each :class:`SourceOption` is listed in preference order. ``requires`` is checked
by the planner against what is actually configured:

- ``kit:<field>``        the field is mapped in the local CoStar field map
- ``vexcel:parcel``      one property/extract request per property (shared)
- ``vexcel:detect``      one elements/detect request per property (+ the parcel request)
- ``matterport:index``   local models index (0 requests)
- ``matterport:rooms``   one GraphQL request per property with a linked model
- ``interview``          only obtainable by asking a person (self-reported)
- ``derived:<a>,<b>``    computed from other variables
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..provenance import Method, Source


@dataclass(frozen=True)
class SourceOption:
    source: Source
    method: Method
    requires: str
    note: str = ""


@dataclass(frozen=True)
class Variable:
    key: str
    label: str
    unit: str | None
    options: tuple[SourceOption, ...]
    frontend_key: str | None = None  # VariableKey in frontend/src/lib/types.ts
    excluded_sources: dict[str, str] = field(default_factory=dict)  # source -> why it is NOT used


def _kit(f: str, note: str = "") -> SourceOption:
    return SourceOption(Source.COSTAR, Method.OBSERVED, f"kit:{f}", note)


_INTERVIEW = SourceOption(Source.INTERVIEW, Method.SELF_REPORTED, "interview",
                          "self-reported; stays unverified until independently confirmed")
_NOT_MATTERPORT = {
    "matterport": "Matterport scans cover interior spaces (often one suite or unit) and are not used "
                  "to infer parking or garage capacity"
}

VARIABLES: dict[str, Variable] = {v.key: v for v in [
    Variable("year_built", "Year built", "year", (_kit("year_built"),), "yearBuilt"),
    Variable("building_area_sf", "Rentable building area", "sf", (_kit("building_area_sf"),), "rbaSf"),
    Variable("land_area_sf", "Lot area", "sf", (
        _kit("land_area_sf"),
        SourceOption(Source.VEXCEL, Method.COMPUTED, "vexcel:parcel", "area of the Vexcel parcel polygon"),
    ), "lotSf"),
    Variable("surface_parking_sf", "Surface parking area", "sf", (
        SourceOption(Source.VEXCEL, Method.MODEL_ESTIMATE, "vexcel:detect",
                     "open-vocabulary segmentation of 'parking lot' on the ortho; estimate with confidence"),
    ), "surfaceSf", _NOT_MATTERPORT),
    Variable("garage_stalls", "Structured parking stalls", "stalls", (
        _kit("garage_stalls", "only if the kit has a structured-parking field"),
        _INTERVIEW,
    ), "garageStalls", _NOT_MATTERPORT),
    Variable("offsite_spaces", "Off-site leased parking spaces", "spaces", (_INTERVIEW,), "offsiteSpaces", {
        **_NOT_MATTERPORT,
        "vexcel": "imagery cannot establish parking ownership or lease arrangements",
        "costar": "no documented kit field records off-site leases",
    }),
    Variable("parking_spaces", "Total parking spaces", "spaces", (_kit("parking_spaces"), _INTERVIEW)),
    Variable("parking_ratio", "Parking ratio", "per 1,000 sf", (_kit("parking_ratio"),)),
    Variable("property_type", "Property type", None, (_kit("property_type"),)),
    Variable("building_class", "Building class", None, (_kit("building_class"),)),
    Variable("occupancy_pct", "Occupancy", "%", (_kit("occupancy_pct"),)),
    Variable("vacancy_pct", "Vacancy", "%", (_kit("vacancy_pct"),)),
    Variable("stories", "Stories", "floors", (_kit("stories"),)),
    Variable("footprint_sf", "Building footprint", "sf", (
        SourceOption(Source.VEXCEL, Method.MODEL_ESTIMATE, "vexcel:parcel", "Vexcel Elements structure footprints"),
    )),
    Variable("surface_parking_share", "Surface parking share of lot", "ratio", (
        SourceOption(Source.DERIVED, Method.COMPUTED, "derived:surface_parking_sf,land_area_sf",
                     "inherits the estimate status of surface_parking_sf"),
    )),
    Variable("site_coverage", "Site coverage (footprint / lot)", "ratio", (
        SourceOption(Source.DERIVED, Method.COMPUTED, "derived:footprint_sf,land_area_sf"),
    )),
    Variable("matterport_model_count", "Linked Matterport models", "models", (
        SourceOption(Source.MATTERPORT, Method.OBSERVED, "matterport:index"),
    )),
    Variable("scanned_room_count", "Rooms in linked scan", "rooms", (
        SourceOption(Source.MATTERPORT, Method.OBSERVED, "matterport:index",
                     "scan may cover only part of the building"),
    )),
    Variable("room_labels", "Room types in linked scan", None, (
        SourceOption(Source.MATTERPORT, Method.MODEL_ESTIMATE, "matterport:rooms",
                     "Matterport room classification; scan may cover only part of the building"),
    )),
]}

FRONTEND_KEYS = {v.key: v.frontend_key for v in VARIABLES.values() if v.frontend_key}
