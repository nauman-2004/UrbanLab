from __future__ import annotations

from pathlib import Path

import pytest

from conftest import FAKE_SECRET, make_settings
from urbanlab_costar import geo, synthetic
from urbanlab_costar.budget import RequestBudget
from urbanlab_costar.http import ApiClient, HttpRequest, HttpResponse
from urbanlab_costar.matterport import MatterportAdapter, MatterportClient, ModelsIndex, showcase_url
from urbanlab_costar.matterport.client import MatterportError, MatterportNotFound
from urbanlab_costar.provenance import GapKind, Method, Source
from urbanlab_costar.vexcel import VexcelAdapter, VexcelClient, parse_property

B1 = synthetic.BUILDINGS[0]


def vclient(transport: object, budget: int = 100) -> VexcelClient:
    return VexcelClient(ApiClient("vexcel", "https://synthetic.invalid/v2", transport,  # type: ignore[arg-type]
                                  RequestBudget("vexcel", budget, 1000.0), max_retries=0))


class Fixed:
    def __init__(self, status: int, body: bytes = b"{}") -> None:
        self.status, self.body, self.sent = status, body, 0

    def send(self, request: HttpRequest) -> HttpResponse:
        self.sent += 1
        return HttpResponse(self.status, self.body)


def test_request_shape_matches_quickstart() -> None:
    seen: list[HttpRequest] = []

    class Spy(synthetic.SyntheticVexcelTransport):
        def send(self, request: HttpRequest) -> HttpResponse:
            seen.append(request)
            return super().send(request)

    c = vclient(Spy())
    c.property_extract(B1.lat, B1.lon)
    p = seen[0].params or {}
    assert seen[0].method == "GET" and seen[0].path.endswith("/v2/property/extract")
    assert p["wkt"] == f"POINT({B1.lon} {B1.lat})" and p["srid"] == 4326 and p["include"] == "precomputed"
    assert "api_key" not in p  # key travels only in the header


def test_parcel_and_parking_values() -> None:
    adapter = VexcelAdapter(vclient(synthetic.SyntheticVexcelTransport()))
    res = adapter.collect(B1.lat, B1.lon, {"land_area_sf", "footprint_sf", "surface_parking_sf"})
    lot = res.values["land_area_sf"]
    assert lot.method is Method.COMPUTED and lot.value == pytest.approx(B1.lot_sf, rel=0.01)
    park = res.values["surface_parking_sf"]
    assert park.method is Method.MODEL_ESTIMATE and park.source is Source.VEXCEL
    assert park.value == pytest.approx(B1.lot_sf * B1.parking_share, rel=0.03)  # overlap not double counted
    assert park.confidence == pytest.approx(0.80)
    assert "not a survey measurement" in (park.evidence.note or "")
    assert res.values["footprint_sf"].method is Method.MODEL_ESTIMATE


def test_404_and_403_become_gaps() -> None:
    nf = VexcelAdapter(vclient(Fixed(404))).collect(B1.lat, B1.lon, {"land_area_sf"})
    assert nf.gaps["land_area_sf"].kind is GapKind.NOT_FOUND
    gf = VexcelAdapter(vclient(Fixed(403))).collect(B1.lat, B1.lon, {"land_area_sf"})
    assert gf.gaps["land_area_sf"].kind is GapKind.OUT_OF_COVERAGE


def test_geofence_precheck_spends_no_request() -> None:
    t = Fixed(200)
    res = VexcelAdapter(vclient(t)).collect(41.88, -87.63, {"land_area_sf"})  # Chicago
    assert res.gaps["land_area_sf"].kind is GapKind.OUT_OF_COVERAGE and t.sent == 0


def test_budget_exhaustion_stops_provider() -> None:
    adapter = VexcelAdapter(vclient(synthetic.SyntheticVexcelTransport(), budget=1))
    res = adapter.collect(B1.lat, B1.lon, {"land_area_sf", "surface_parking_sf"})
    assert "land_area_sf" in res.values
    assert res.gaps["surface_parking_sf"].kind is GapKind.BUDGET and res.stop_provider


def test_blocked_by_default_from_settings(isolated: Path) -> None:
    c = VexcelClient.from_settings(make_settings(isolated, VEXCEL_API_KEY=FAKE_SECRET))
    res = VexcelAdapter(c).collect(B1.lat, B1.lon, {"land_area_sf"})
    assert res.gaps["land_area_sf"].kind is GapKind.BUDGET  # zero budget => refused before sending
    assert c.requests_used == 0


def test_parse_property_missing_fields_are_none() -> None:
    body = {"features": [{"geometry": geo.square_wkt(29.75, -95.36, 10), "properties": {}}]}
    r = parse_property(body)
    assert r.footprint_sf is None and r.structure_count is None and r.collection is None


# --------------------------------------------------------------- matterport

def test_index_lookup_and_scope(tmp_path: Path) -> None:
    idx = ModelsIndex.load(synthetic.write_models_index(tmp_path))
    assert [m.sid for m in idx.for_costar_property("0090001")] == ["SYNTHMODEL00"]
    assert idx.for_costar_property("90002") == []
    assert idx.near(B1.lat, B1.lon, km=0.01)[0][1].sid == "SYNTHMODEL00"
    res = MatterportAdapter(idx).collect("90001", {"matterport_model_count", "scanned_room_count"})
    assert res.values["matterport_model_count"].value == 1
    assert "whole building" in (res.values["scanned_room_count"].evidence.note or "")
    assert res.showcase_url == showcase_url("SYNTHMODEL00")


def test_matterport_graphql_errors_and_rooms(tmp_path: Path) -> None:
    api = ApiClient("matterport", "https://synthetic.invalid/api/models", synthetic.SyntheticMatterportTransport(),
                    RequestBudget("matterport", 10, 1000.0), max_retries=0)
    c = MatterportClient(api)
    with pytest.raises(MatterportNotFound):
        c.model_rooms("ABCDEFGHIJK")
    idx = ModelsIndex.load(synthetic.write_models_index(tmp_path))
    res = MatterportAdapter(idx, c).collect("90001", {"room_labels"})
    assert res.values["room_labels"].value == {"Office": 2, "Kitchen": 1, "Lobby": 1}
    assert res.values["room_labels"].method is Method.MODEL_ESTIMATE
    bad = MatterportClient(ApiClient("matterport", "https://x.invalid", Fixed(401), RequestBudget("m", 5, 1000.0)))
    with pytest.raises(MatterportError, match="rejected"):
        bad.graph("{ x }")


def test_showcase_url_validates_id() -> None:
    with pytest.raises(ValueError):
        showcase_url("bad id&x=1")
