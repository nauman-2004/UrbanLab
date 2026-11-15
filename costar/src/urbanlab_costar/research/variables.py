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
- ``kitjoin:tenancy``    joined from the kit's tenancy dataset (0 requests)
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
    Variable("surface_parking_sf", "Surface parking area (Vexcel model estimate)", "sf", (
        SourceOption(Source.VEXCEL, Method.MODEL_ESTIMATE, "vexcel:detect",
                     "open-vocabulary segmentation of 'parking lot' on the ortho; estimate with confidence"),
    ), "surfaceSf", _NOT_MATTERPORT),
    Variable("garage_stalls", "Garage (structured) parking stalls", "stalls", (
        _kit("garage_stalls", "only if a source field explicitly records garage / structured stalls"),
        _INTERVIEW,
    ), "garageStalls", {
        **_NOT_MATTERPORT,
        "costar": "the kit records 'Covered' parking, which is not necessarily a garage; covered spaces are "
                  "reported separately as parking_spaces_covered",
        "vexcel": "aerial imagery cannot count stalls inside a structure",
    }),
    Variable("offsite_spaces", "Off-site leased parking spaces", "spaces", (_INTERVIEW,), "offsiteSpaces", {
        **_NOT_MATTERPORT,
        "vexcel": "imagery cannot establish parking ownership or lease arrangements",
        "costar": "no documented kit field records off-site leases",
    }),
    Variable("parking_spaces", "Total parking spaces (CoStar-reported count)", "spaces", (
        _kit("parking_spaces", "CoStar-reported count across all parking types"), _INTERVIEW)),
    Variable("parking_ratio", "Parking ratio", "per 1,000 sf", (_kit("parking_ratio"),)),
    Variable("property_type", "Property type", None, (_kit("property_type"),)),
    Variable("building_class", "Building class", None, (_kit("building_class"),)),
    Variable("occupancy_pct", "Occupancy (recorded)", "%", (
        _kit("occupancy_pct", "occupancy field recorded on the property"),
        SourceOption(Source.COSTAR, Method.COMPUTED, "kitjoin:tenancy",
                     "recorded tenant occupancy: occupied SF of current tenancies / RBA; not a vacancy rate"),
    )),
    Variable("vacancy_pct", "Vacancy (recorded)", "%", (
        _kit("vacancy_pct", "vacancy recorded on the property record (multifamily communities in this kit)"),
    ), excluded_sources={"costar_tenancies": "kit guidance: tenancy occupancy must not be used as a vacancy "
                                             "numerator"}),
    Variable("tenancy_count_current", "Current tenancies on record", "tenancies", (
        SourceOption(Source.COSTAR, Method.COMPUTED, "kitjoin:tenancy", "tenancies current on the kit snapshot date"),
    )),
    Variable("occupied_sf_current", "Occupied area of current tenancies", "sf", (
        SourceOption(Source.COSTAR, Method.COMPUTED, "kitjoin:tenancy",
                     "sum of occupied SF; only when every current tenancy has an area"),
    )),
    Variable("stories", "Stories", "floors", (_kit("stories"),)),
    Variable("gross_building_area_sf", "Gross building area", "sf", (_kit("gross_building_area_sf"),)),
    Variable("property_subtype", "Property subtype", None, (_kit("property_subtype"),)),
    Variable("building_rating", "Building rating (stars)", None, (_kit("building_rating"),)),
    Variable("construction_status", "Construction status", None, (_kit("construction_status"),)),
    Variable("year_renovated", "Latest renovation year", "year", (_kit("year_renovated"),)),
    Variable("building_height_ft", "Building height", "ft", (_kit("building_height_ft"),)),
    Variable("tenancy_type", "Tenancy (single / multi)", None, (_kit("tenancy_type"),)),
    Variable("owner_occupied", "Owner occupied", None, (_kit("owner_occupied"),)),
    Variable("parking_spaces_surface", "Surface parking spaces (CoStar-reported count)", "spaces", (
        _kit("parking_spaces_surface", "CoStar-reported count of surface parking spaces (record, not imagery)"),)),
    Variable("parking_spaces_covered", "Covered parking spaces (CoStar-reported count)", "spaces", (
        _kit("parking_spaces_covered", "CoStar-reported count of covered spaces; covered is not necessarily a "
                                       "garage and is never used as garage stalls"),)),
    Variable("matterport_scan_count", "Matterport scans on record", "scans", (_kit("matterport_scan_count"),)),
    Variable("floor_area_ratio", "Floor area ratio (GBA / lot)", "ratio", (
        SourceOption(Source.DERIVED, Method.COMPUTED, "derived:gross_building_area_sf,land_area_sf"),)),
    Variable("surface_spaces_per_1000sf_lot", "Surface spaces per 1,000 sf of lot", "per 1,000 sf", (
        SourceOption(Source.DERIVED, Method.COMPUTED, "derived:parking_spaces_surface,land_area_sf*1000"),)),
    Variable("parcel_area_sf", "Parcel area (Vexcel parcel polygon)", "sf", (
        SourceOption(Source.VEXCEL, Method.COMPUTED, "vexcel:parcel",
                     "area of the Vexcel parcel polygon; compare with the CoStar-recorded lot size"),
    )),
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


def variable(key: str, kit_fields: frozenset[str] = frozenset()) -> Variable:
    """Catalog variable, or a dynamic one for any field mapped in the local kit field map."""
    if key in VARIABLES:
        return VARIABLES[key]
    if key in kit_fields:
        return Variable(key, key.replace("_", " ").capitalize(), None, (_kit(key, "mapped kit field"),))
    raise KeyError(key)


def parse_derived(requires: str) -> tuple[str, str, float]:
    """``derived:num,den[*scale]`` -> (num, den, scale)."""
    body = requires.partition(":")[2]
    scale = 1.0
    if "*" in body:
        body, _, sc = body.partition("*")
        scale = float(sc)
    num, den = body.split(",")
    return num, den, scale
