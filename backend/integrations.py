"""Data-source clients: CoStar and Vexcel.

These are the ONLY places that touch external data. The tools in tools.py call
them and don't care where the rows come from, as long as the shapes stay the same.

CoStar records come from one of (URBANLAB_COSTAR_SOURCE, see .env.example):
  - kit:       the sponsor's CoStar data kit, read by the costar/ package (urbanlab_costar)
  - synthetic: the costar/ package's invented test kit (no sponsor data; for development)
  - sample:    backend/data/costar_sample.csv (placeholder rows)
  - auto:      kit if COSTAR_KIT_ZIP is configured, otherwise sample (default)
"""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
from typing import Any

import config

# Backend variable (dataset.VARIABLE_CATALOG) -> canonical urbanlab_costar kit field.
COSTAR_FIELDS: dict[str, str] = {
    "year_built": "year_built",
    "rba_sf": "building_area_sf",
    "lot_sf": "land_area_sf",
    "building_class": "building_class",
    "parking_spaces": "parking_spaces",
    "parking_ratio": "parking_ratio",
}
SUPPORTED_CITIES = ("Houston", "Los Angeles")  # where the CoStar kit has properties


class CoStarError(RuntimeError):
    """The study can't get CoStar records (bad city, kit not configured...). The message is shown to the agent."""


# ---------------------------------------------------------------- CoStar ----
@lru_cache(maxsize=1)
def _costar_settings():
    from urbanlab_costar.config import load_settings

    # Read the same root .env as everything else (works from backend/ or the repo root).
    return load_settings(cwd=config.REPO_ROOT)


def costar_source() -> str:
    """Which source a study will use right now: "kit", "synthetic" or "sample"."""
    src = config.COSTAR_SOURCE
    if src == "auto":
        return "kit" if _costar_settings().costar_kit_zip else "sample"
    if src not in {"kit", "synthetic", "sample"}:
        raise CoStarError(f"URBANLAB_COSTAR_SOURCE={src!r} is not one of auto, kit, synthetic, sample.")
    return src


def costar_fetch_properties(city: str, property_type: str, limit: int) -> list[dict[str, Any]]:
    """Return CoStar property records as dicts.

    Keys: costar_id, name, address, city, property_type, lat, lng, the COSTAR_FIELDS
    variables, plus:
      - costar_source: "kit" | "synthetic" | "sample"
      - _ref:          evidence reference for every value from this record
      - _missing:      {variable: reason} for each variable the record doesn't have
    A missing value is None (never a default). lat/lng may be None if the kit has no coordinates.
    """
    src = costar_source()
    if src == "sample":
        return _sample_csv(city, property_type, limit)
    return _kit(city, property_type, limit, mode="real" if src == "kit" else "synthetic")


def _kit(city: str, property_type: str, limit: int, mode: str) -> list[dict[str, Any]]:
    from urbanlab_costar.kit.repository import PropertyFilter
    from urbanlab_costar.research.spec import resolve_region
    from urbanlab_costar.runtime import build_runtime

    region = resolve_region(city)
    if not region["ok"]:
        raise CoStarError(f"{region['message']} (asked for {city!r})")
    settings = _costar_settings()
    with build_runtime(settings, mode) as rt:  # type: ignore[arg-type]
        if rt.adapters is None:
            raise CoStarError("CoStar kit unavailable: " + ("; ".join(rt.problems) or "not configured")
                              + ". Set COSTAR_KIT_ZIP / COSTAR_ZIP_PASSWORD in the root .env "
                                "(see costar/README.md), or URBANLAB_COSTAR_SOURCE=sample.")
        repo = rt.adapters.repository
        cap = min(limit, settings.max_properties)
        records = repo.properties(PropertyFilter(region=region["region"], property_types=(property_type,),
                                                 limit=cap, seed=config.SAMPLE_SEED))
        label = "CoStar kit" if mode == "real" else "Synthetic CoStar kit"
        rows = [_kit_row(r, label, "kit" if mode == "real" else "synthetic") for r in records]
        # Matterport, no API key: link each property to its public Showcase 3D tour via the sponsor's
        # models_index.csv (MATTERPORT_INDEX_CSV) or the kit's own link list. Local lookup, 0 requests.
        mp = rt.adapters.matterport if config.MATTERPORT_LINKS else None  # on hold: URBANLAB_MATTERPORT_LINKS
        for row, rec in zip(rows, records):
            if mp is not None:
                found = mp.collect(rec.kit_id, set())
                row["matterport_url"] = found.showcase_url
                row["matterport_models"] = len(found.sids)
        return rows


def _kit_row(rec: Any, label: str, source: str) -> dict[str, Any]:
    lat, lng = rec.latlon if rec.latlon else (None, None)
    row: dict[str, Any] = {
        "costar_id": rec.kit_id,
        "name": rec.get("name"),
        "address": rec.get("address"),
        "city": rec.get("city"),
        "property_type": rec.get("property_type"),
        "lat": lat,
        "lng": lng,
        "costar_source": source,
        "_ref": f"{label} #{rec.kit_id}",
        "_missing": {},
    }
    for var, field in COSTAR_FIELDS.items():
        if field in rec.values:
            row[var] = rec.values[field].value
            continue
        row[var] = None
        gap = rec.gaps.get(field)
        # A field absent from the local field map produces no gap at all; say so instead of staying silent.
        row["_missing"][var] = (gap.reason if gap else "not in the CoStar field map (costar/.local/field_map.toml)")
    if lat is None:
        row["_missing"]["lat"] = "no coordinates in the CoStar record"
    return row


def _sample_csv(city: str, property_type: str, limit: int) -> list[dict[str, Any]]:
    """Placeholder rows from config.COSTAR_CSV (keys as costar_fetch_properties)."""
    rows: list[dict[str, Any]] = []
    with open(config.COSTAR_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["city"].strip().lower() != city.strip().lower():
                continue
            if row["property_type"].strip().lower() != property_type.strip().lower():
                continue
            clean = {k: (v.strip() if isinstance(v, str) and v.strip() != "" else None) for k, v in row.items()}
            clean.update({"costar_source": "sample", "_ref": f"CoStar #{clean.get('costar_id')}", "_missing": {}})
            rows.append(clean)
            if len(rows) >= limit:
                break
    return rows


# ---------------------------------------------------------------- Vexcel ----
TILE_HALF_M = 60  # ~120 m square around the property: one parcel plus its immediate surroundings
TILE_MAX_PX = 1024  # downscale before the vision model sees it
_vexcel_clients: dict[str, Any] = {}  # study_id -> VexcelClient, so the request budget covers the whole study


def tile_name(lat: float, lng: float) -> str:
    return f"{lat:.5f}_{lng:.5f}.png"


def live_tiles_dir() -> Path:
    """Where live Vexcel tiles are stored (git-ignored, served at /tiles/live/)."""
    return config.TILES_DIR / "live"


def vexcel_live_status() -> tuple[bool, str]:
    """Whether live Vexcel requests are allowed by the root .env (key + all three switches), and why not."""
    return _costar_settings().live_allowed("vexcel")


def vexcel_fetch_tile(lat: float, lng: float, study_id: str | None = None) -> Path:
    """Return a local path to an orthophoto tile centred on (lat, lng).

    Live (VEXCEL_API_KEY + URBANLAB_LIVE_MODE=1 + VEXCEL_LIVE=1 + a budget): requests the
    ortho image from Vexcel through urbanlab_costar's client, which pre-checks coverage,
    enforces the per-study request budget and never logs the key. Tiles are kept in
    data/tiles/live/ and reused, so a location is only paid for once.
    Otherwise: the local placeholder tile config.TILES_DIR/<lat>_<lng>.png.
    Raises FileNotFoundError / RuntimeError with a human-readable reason when there's no imagery.
    """
    allowed, why = vexcel_live_status()
    if not allowed:
        path = config.TILES_DIR / tile_name(lat, lng)
        if not path.exists():
            raise FileNotFoundError(f"No Vexcel tile available for ({lat:.5f}, {lng:.5f}); live Vexcel is off: {why}")
        return path

    path = live_tiles_dir() / f"{lat:.5f}_{lng:.5f}.jpg"
    if path.exists():
        return path

    from urbanlab_costar import geo
    from urbanlab_costar.budget import BudgetExceeded
    from urbanlab_costar.vexcel import VexcelClient

    key = study_id or "_default"
    client = _vexcel_clients.get(key)
    if client is None:
        client = _vexcel_clients[key] = VexcelClient.from_settings(_costar_settings())
    try:
        img = client.ortho_extract(lat, lng, geo.square_wkt(lat, lng, TILE_HALF_M), buffer_m=0)
    except geo.GeofenceError as e:
        raise FileNotFoundError(f"Outside Vexcel coverage: {e}") from None
    except BudgetExceeded as e:
        raise RuntimeError(f"Vexcel request budget for this study is used up ({e}). "
                           "Raise VEXCEL_MAX_REQUESTS_PER_RUN in .env to measure more buildings.") from None
    path.parent.mkdir(parents=True, exist_ok=True)
    _save_downscaled(img, path)
    return path


def _save_downscaled(img: bytes, path: Path) -> None:
    import io

    from PIL import Image

    with Image.open(io.BytesIO(img)) as im:
        im = im.convert("RGB")
        im.thumbnail((TILE_MAX_PX, TILE_MAX_PX))
        im.save(path, "JPEG", quality=88)


def vexcel_requests_used(study_id: str) -> int:
    client = _vexcel_clients.get(study_id)
    return client.requests_used if client else 0
