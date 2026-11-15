from __future__ import annotations

import pytest

from urbanlab_costar import geo


def test_wkt_is_lon_lat() -> None:
    assert geo.point_wkt(29.75, -95.36) == "POINT(-95.36 29.75)"


def test_regions_and_coverage() -> None:
    assert geo.region_for(29.7604, -95.3698).key == "houston"  # type: ignore[union-attr]
    assert geo.region_for(40.3573, -74.6672).key == "princeton"  # type: ignore[union-attr]
    assert geo.region_for(41.88, -87.63) is None  # Chicago
    geo.require_coverage("vexcel", 40.3573, -74.6672)
    with pytest.raises(geo.GeofenceError):
        geo.require_coverage("costar", 40.3573, -74.6672)  # Princeton: Vexcel yes, CoStar no
    with pytest.raises(geo.GeofenceError, match="swapped"):
        geo.require_coverage("vexcel", -95.36, 29.75)


def test_invalid_coordinates() -> None:
    with pytest.raises(ValueError):
        geo.point_wkt(95.0, 29.0)


def test_square_area_and_parse_roundtrip() -> None:
    wkt = geo.square_wkt(29.75, -95.36, 50)  # 100 m x 100 m
    polys = geo.parse_wkt(wkt)
    assert geo.area_m2(polys) == pytest.approx(10_000, rel=0.002)


def test_multipolygon_and_holes() -> None:
    wkt = "MULTIPOLYGON(((0 0,0.001 0,0.001 0.001,0 0.001,0 0)),((1 1,1.001 1,1.001 1.001,1 1.001,1 1)))"
    polys = geo.parse_wkt(wkt)
    assert len(polys) == 2
    holed = geo.geometry_polygons({"type": "Polygon", "coordinates": [
        [[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]],
        [[0.0005, 0.0005], [0.0015, 0.0005], [0.0015, 0.0015], [0.0005, 0.0015], [0.0005, 0.0005]],
    ]})
    full = geo.area_m2([[holed[0][0]]])
    assert geo.area_m2(holed) == pytest.approx(full * 0.75, rel=1e-6)


def test_covered_area_unions_overlaps_and_clips_to_parcel() -> None:
    parcel = geo.parse_wkt(geo.square_wkt(29.75, -95.36, 20))  # 40 x 40 m = 1600 m2
    a = geo.parse_wkt(geo.square_wkt(29.75, -95.36, 10))  # 400 m2, inside
    b = geo.parse_wkt(geo.square_wkt(29.75, -95.36, 10))  # identical: must not double count
    outside = geo.parse_wkt(geo.square_wkt(29.80, -95.36, 10))
    assert geo.covered_area_m2(parcel, a + b) == pytest.approx(400, rel=0.03)
    assert geo.covered_area_m2(parcel, outside) == 0.0
    big = geo.parse_wkt(geo.square_wkt(29.75, -95.36, 40))
    assert geo.covered_area_m2(parcel, big) == pytest.approx(1600, rel=0.03)
