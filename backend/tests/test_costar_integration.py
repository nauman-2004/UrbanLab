"""The backend <-> costar/ package connection (offline: synthetic kit and sample CSV only)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
import integrations  # noqa: E402
import tools  # noqa: E402
from dataset import get_store  # noqa: E402

PLAN = {
    "hypothesis": "Older Houston offices have fewer EV charging ports than newer ones.",
    "variables": [
        {"name": "year_built", "source": "costar", "type": "int"},
        {"name": "rba_sf", "source": "costar", "type": "float"},
        {"name": "lot_sf", "source": "costar", "type": "float"},
        {"name": "building_class", "source": "costar", "type": "category"},
        {"name": "parking_spaces", "source": "costar", "type": "int"},
    ],
    "sample": {"city": "Houston", "property_type": "Office", "n": 4},
}


@pytest.fixture
def synthetic(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "COSTAR_SOURCE", "synthetic")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DATASET_JSON", tmp_path / "dataset.json")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "DEMO_MODE", False)


def test_synthetic_kit_rows_have_backend_shape(synthetic):
    rows = integrations.costar_fetch_properties("Houston", "Office", 4)
    assert len(rows) == 4
    r = rows[0]
    assert r["costar_source"] == "synthetic" and r["_ref"].startswith("Synthetic CoStar kit #")
    assert isinstance(r["year_built"], int) and isinstance(r["rba_sf"], float) and r["city"] == "Houston"
    assert r["lat"] is not None and r["lng"] is not None
    # Fields the synthetic field map doesn't define become None WITH a reason, never a default.
    assert r["parking_spaces"] is None and "field map" in r["_missing"]["parking_spaces"]


def test_matterport_links_off_by_default(synthetic):
    rows = integrations.costar_fetch_properties("Houston", "Office", 50)
    assert all("matterport_url" not in r for r in rows)


def test_matterport_showcase_links_need_no_key(synthetic, monkeypatch):
    """The synthetic runtime has a models index: links come from it locally, with no API key or request."""
    monkeypatch.setattr(config, "MATTERPORT_LINKS", True)
    rows = integrations.costar_fetch_properties("Houston", "Office", 50)
    linked = [r for r in rows if r.get("matterport_url")]
    assert linked, "expected the synthetic models index to link at least one property"
    for r in linked:
        assert r["matterport_url"].startswith("https://my.matterport.com/show/?m=") and r["matterport_models"] >= 1
    assert all("matterport_models" in r for r in rows)  # 0 = index configured, no scan for that property


def test_sample_is_seeded_random_not_lowest_ids(synthetic, monkeypatch):
    lowest = [r["costar_id"] for r in integrations.costar_fetch_properties("Houston", "Office", 50)][:4]
    draws = set()
    for seed in range(5):
        monkeypatch.setattr(config, "SAMPLE_SEED", seed)
        ids = [r["costar_id"] for r in integrations.costar_fetch_properties("Houston", "Office", 4)]
        assert ids == [r["costar_id"] for r in integrations.costar_fetch_properties("Houston", "Office", 4)]
        draws.add(tuple(ids))
    assert any(list(d) != lowest for d in draws)


def test_unsupported_city_is_refused_not_substituted(synthetic):
    with pytest.raises(integrations.CoStarError, match="not supported|does not name"):
        integrations.costar_fetch_properties("Dallas", "Office", 4)


def test_kit_source_without_kit_fails_clearly(monkeypatch):
    monkeypatch.setattr(config, "COSTAR_SOURCE", "kit")
    from urbanlab_costar.config import load_settings

    no_kit = load_settings(environ={"URBANLAB_ENV_FILE": ""}, cwd=Path(__file__).parent)
    no_kit = type(no_kit)(**{**no_kit.__dict__, "costar_kit_zip": None})
    monkeypatch.setattr(integrations, "_costar_settings", lambda: no_kit)
    with pytest.raises(integrations.CoStarError, match="COSTAR_KIT_ZIP"):
        integrations.costar_fetch_properties("Houston", "Office", 4)


def test_auto_uses_sample_when_no_kit(monkeypatch):
    monkeypatch.setattr(config, "COSTAR_SOURCE", "auto")
    from urbanlab_costar.config import load_settings

    settings = load_settings(cwd=config.REPO_ROOT)
    monkeypatch.setattr(integrations, "_costar_settings",
                        lambda: type(settings)(**{**settings.__dict__, "costar_kit_zip": None}))
    assert integrations.costar_source() == "sample"


def test_tool_writes_kit_values_and_reasons_to_dataset(synthetic):
    sid = "st-costar-test"
    tools.CURRENT_STUDY.set(sid)
    store = get_store(sid)
    plan, errors = tools.validate_plan(PLAN)
    assert not errors
    store.set_plan(plan)
    out = json.loads(tools.get_costar_properties("Houston", "Office", 4))
    assert out["count"] == 4 and out["source"] == "synthetic"
    cell = store.get_cell("B-01", "year_built")
    assert cell["status"] == "filled" and cell["evidence_ref"].startswith("Synthetic CoStar kit #")
    gap = store.get_cell("B-01", "parking_spaces")
    assert gap["status"] == "missing" and "field map" in gap["reason"]
    assert store.buildings["B-01"]["costar_source"] == "synthetic"


class FakeVexcel:
    """Stands in for urbanlab_costar's VexcelClient: no network, counts requests like the real budget."""

    def __init__(self, budget: int):
        self.budget, self.requests_used = budget, 0

    def ortho_extract(self, lat, lng, wkt, buffer_m=0):
        from urbanlab_costar import geo
        from urbanlab_costar.budget import BudgetExceeded
        from PIL import Image
        import io

        geo.require_coverage("vexcel", lat, lng)  # same pre-check as the real client
        if self.requests_used >= self.budget:
            raise BudgetExceeded("vexcel: request budget exhausted")
        self.requests_used += 1
        buf = io.BytesIO()
        Image.new("RGB", (2000, 2000), (90, 90, 90)).save(buf, "JPEG")
        return buf.getvalue()


@pytest.fixture
def live_vexcel(monkeypatch, tmp_path):
    import urbanlab_costar.vexcel as vx

    monkeypatch.setattr(config, "TILES_DIR", tmp_path / "tiles")
    monkeypatch.setattr(integrations, "vexcel_live_status", lambda: (True, "ok"))
    monkeypatch.setattr(integrations, "_vexcel_clients", {})
    monkeypatch.setattr(vx.VexcelClient, "from_settings", classmethod(lambda cls, s: FakeVexcel(budget=2)))


def test_live_tile_is_saved_downscaled_and_reused(live_vexcel):
    from PIL import Image

    p = integrations.vexcel_fetch_tile(29.7571, -95.3641, "st-a")
    assert p.parent == integrations.live_tiles_dir() and p.suffix == ".jpg"
    with Image.open(p) as im:
        assert max(im.size) <= integrations.TILE_MAX_PX
    assert integrations.vexcel_fetch_tile(29.7571, -95.3641, "st-a") == p  # reused, not re-requested
    assert integrations.vexcel_requests_used("st-a") == 1


def test_live_budget_is_per_study_and_coverage_is_prechecked(live_vexcel):
    integrations.vexcel_fetch_tile(29.70, -95.30, "st-b")
    integrations.vexcel_fetch_tile(29.71, -95.31, "st-b")
    with pytest.raises(RuntimeError, match="budget"):
        integrations.vexcel_fetch_tile(29.72, -95.32, "st-b")
    integrations.vexcel_fetch_tile(29.72, -95.32, "st-c")  # a new study gets its own budget
    with pytest.raises(FileNotFoundError, match="coverage"):
        integrations.vexcel_fetch_tile(40.71, -74.00, "st-c")  # New York: refused before any request
    assert integrations.vexcel_requests_used("st-c") == 1


def test_offline_uses_local_tiles(monkeypatch):
    monkeypatch.setattr(integrations, "vexcel_live_status", lambda: (False, "URBANLAB_LIVE_MODE is not 1"))
    assert integrations.vexcel_fetch_tile(29.7571, -95.3641).name == "29.75710_-95.36410.png"
    with pytest.raises(FileNotFoundError, match="live Vexcel is off"):
        integrations.vexcel_fetch_tile(29.0, -95.0)


def test_tile_tool_refuses_unknown_coordinates(synthetic, monkeypatch):
    called = []
    monkeypatch.setattr(integrations, "vexcel_fetch_tile", lambda *a: called.append(a))
    tools.CURRENT_STUDY.set("st-tile-test")
    out = json.loads(tools.get_aerial_tile(10.0, 10.0))
    assert "No sampled building" in out["error"] and not called


@pytest.mark.parametrize("city,ok", [("Houston", True), ("los angeles", True), ("LA", True), ("Dallas", False)])
def test_plan_city_must_be_houston_or_la(city, ok):
    plan, errors = tools.validate_plan({**PLAN, "sample": {**PLAN["sample"], "city": city}})
    assert (not errors) is ok
    if ok:
        assert plan["sample"]["city"] in integrations.SUPPORTED_CITIES
    else:
        assert any("only Houston and Los Angeles" in e for e in errors)
