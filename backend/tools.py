"""Agent tools. Each tool writes to the study's DatasetStore directly, so values
go source -> dataset without passing through the LLM (the LLM can't invent them).

The study is resolved from the run config (configurable.study_id), which
DeepAgents propagates from the orchestrator into every subagent.
"""

from __future__ import annotations

import contextvars
import json
import math
from typing import Any, Literal

from langgraph.config import get_config
from pydantic import BaseModel, Field

import analysis
import cache
import config
import events
import integrations
import llm
from dataset import VARIABLE_CATALOG, DatasetStore, get_store

CURRENT_STUDY: contextvars.ContextVar[str | None] = contextvars.ContextVar("CURRENT_STUDY", default=None)


def _study_id() -> str:
    try:
        sid = (get_config().get("configurable") or {}).get("study_id")
        if sid:
            return sid
    except RuntimeError:
        pass
    sid = CURRENT_STUDY.get()
    if not sid:
        raise RuntimeError("No study_id in run config")
    return sid


def _store() -> DatasetStore:
    return get_store(_study_id())


def _json(obj: Any) -> str:
    return json.dumps(obj, default=str)


# ============================================================== planner ====
class PlanVariable(BaseModel):
    name: str = Field(description="Variable name from the catalog.")
    source: Literal["costar", "vexcel"]
    type: str = Field(description="int | float | bool | category")


class PlanSample(BaseModel):
    city: str
    property_type: str
    n: int = Field(ge=1, le=50)


def _as_dict(x: Any) -> Any:
    if hasattr(x, "model_dump"):
        return x.model_dump()
    if isinstance(x, list):
        return [_as_dict(i) for i in x]
    return x


def validate_plan(args: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """Normalise a submit_plan payload against the catalog. Returns (plan, errors)."""
    errors: list[str] = []
    variables = _as_dict(args.get("variables") or [])
    sample = _as_dict(args.get("sample") or {})
    clean: list[dict[str, Any]] = []
    for v in variables:
        name = (v or {}).get("name")
        if name not in VARIABLE_CATALOG:
            errors.append(f"Unknown variable '{name}'. Allowed: {sorted(VARIABLE_CATALOG)}")
            continue
        cat = VARIABLE_CATALOG[name]
        if v.get("source") != cat["source"]:
            errors.append(f"Variable '{name}' comes from '{cat['source']}', not '{v.get('source')}'.")
            continue
        if name not in {c["name"] for c in clean}:
            clean.append({"name": name, "source": cat["source"], "type": cat["type"], "label": cat["label"]})
    if "year_built" not in {c["name"] for c in clean}:
        errors.append("Plan must include 'year_built' (needed for the decade-built comparison).")
    if not args.get("hypothesis"):
        errors.append("Missing hypothesis.")
    if not sample.get("city") or not sample.get("property_type") or not sample.get("n"):
        errors.append("sample needs city, property_type and n.")
    city = _CITY_ALIASES.get(str(sample.get("city") or "").strip().lower().replace(".", ""))
    if sample.get("city") and city is None:
        errors.append(f"City {sample['city']!r} is not supported: the CoStar data covers only "
                      f"{' and '.join(integrations.SUPPORTED_CITIES)}. Use one of those, or tell the user the "
                      "question can't be studied with the available data.")
    if errors:
        return None, errors
    return {"hypothesis": args["hypothesis"], "variables": clean,
            "sample": {"city": city, "property_type": sample["property_type"], "n": int(sample["n"])}}, []


_CITY_ALIASES = {"houston": "Houston", "los angeles": "Los Angeles", "la": "Los Angeles"}


def submit_plan(hypothesis: str, variables: list[PlanVariable], sample: PlanSample) -> str:
    """Submit the research plan for human approval. Only call once the plan is final.

    Args:
        hypothesis: One falsifiable sentence.
        variables: Variables to collect; each name must come from the catalog with its catalog source.
        sample: Which properties to study: city, property_type (e.g. "Office") and n.
    """
    plan, errors = validate_plan({"hypothesis": hypothesis, "variables": variables, "sample": sample})
    if errors:
        return _json({"status": "invalid", "errors": errors})
    store = _store()
    store.set_plan(plan)
    events.emit(store.study_id, "plan_ready", {"plan": plan})
    return _json({"status": "approved", "plan": plan})


def plan_needs_review(request: Any) -> bool:
    """`when` predicate for interrupt_on: only send VALID plans to the human."""
    _, errors = validate_plan(request.tool_call.get("args", {}))
    return not errors


# ======================================================= data_collector ====
_COSTAR_FIELDS = ["year_built", "rba_sf", "lot_sf", "building_class", "parking_spaces", "parking_ratio"]


def _coerce(name: str, raw: Any) -> Any:
    if raw is None:
        return None
    t = VARIABLE_CATALOG[name]["type"]
    try:
        if t == "int":
            return int(float(raw))
        if t == "float":
            return float(raw)
    except (TypeError, ValueError):
        return None
    return raw


def get_costar_properties(city: str, property_type: str, limit: int) -> str:
    """Fetch CoStar property records and write them into the dataset.

    Adds each property as a building (ids B-01, B-02, ...) and fills every planned
    CoStar variable. Values CoStar doesn't have are recorded as missing.
    Returns a short list of buildings with their coordinates.

    Args:
        city: City name, e.g. "Houston".
        property_type: CoStar property type, e.g. "Office".
        limit: Max number of properties.
    """
    store = _store()
    if store.plan is None:
        return _json({"error": "No approved plan yet. The plan must be approved before collecting data."})
    fetch = lambda: integrations.costar_fetch_properties(city, property_type, limit)  # noqa: E731
    try:
        source = integrations.costar_source()
        if source == "kit":
            # Sponsor data: don't make extra copies of it in the demo cache.
            rows, from_cache = fetch(), False
        else:
            rows, from_cache = cache.cached("costar", f"{source}|{city}|{property_type}|{limit}|{config.SAMPLE_SEED}",
                                            fetch)
    except integrations.CoStarError as e:
        return _json({"error": str(e)})
    except Exception as e:  # noqa: BLE001
        return _json({"error": f"CoStar request failed: {e}"})
    if not rows:
        return _json({"error": f"CoStar returned no {property_type} properties in {city}."})

    planned = {v["name"] for v in store.planned_variables() if v["source"] == "costar"}
    vexcel_vars = _vexcel_vars(store)
    out = []
    for i, row in enumerate(rows, start=1):
        bid = f"B-{i:02d}"
        meta = {k: row.get(k) for k in ("costar_id", "name", "address", "city", "property_type", "costar_source",
                                        "matterport_url", "matterport_models")}
        has_coords = row.get("lat") is not None and row.get("lng") is not None
        meta["lat"] = float(row["lat"]) if has_coords else None
        meta["lng"] = float(row["lng"]) if has_coords else None
        store.add_building(bid, meta)
        ref = row.get("_ref") or f"CoStar #{row.get('costar_id')}"
        missing = row.get("_missing") or {}
        for name in _COSTAR_FIELDS:
            if name not in planned:
                continue
            value = _coerce(name, row.get(name))
            if value is None:
                reason = missing.get(name) or f"not recorded in CoStar record {row.get('costar_id')}"
                store.mark_missing(bid, name, "costar", f"CoStar: {reason}.", ref)
            else:
                store.set_cell(bid, name, value, "costar", 1.0, ref)
        if not has_coords:
            for var in vexcel_vars:
                store.mark_missing(bid, var, "vexcel", "No coordinates in the CoStar record, so no aerial tile.")
        out.append({"building_id": bid, "name": meta["name"], "lat": meta["lat"], "lng": meta["lng"]})
    return _json({"buildings": out, "count": len(out), "source": source, "cached": from_cache,
                  "note": "Buildings with lat/lng null have no coordinates: skip them for aerial tiles."})


# ====================================================== vision_measurer ====
def _building_at(store: DatasetStore, lat: float, lng: float) -> str | None:
    best, best_d = None, 1e9
    for bid, b in store.buildings.items():
        if b.get("lat") is None or b.get("lng") is None:
            continue
        d = math.hypot(b["lat"] - lat, b["lng"] - lng)
        if d < best_d:
            best, best_d = bid, d
    return best if best_d < 0.0005 else None  # ~50 m


def _vexcel_vars(store: DatasetStore) -> list[str]:
    return [v["name"] for v in store.planned_variables() if v["source"] == "vexcel"]


def get_aerial_tile(lat: float, lng: float) -> str:
    """Get the Vexcel orthophoto tile for a building's coordinates. Returns the image path, or an error.

    Args:
        lat: Latitude (WGS84), exactly as returned by get_costar_properties.
        lng: Longitude (WGS84), exactly as returned by get_costar_properties.
    """
    store = _store()
    bid = _building_at(store, lat, lng)
    if bid is None:
        # Never spend imagery requests on a point that isn't one of the sampled buildings.
        return _json({"error": "No sampled building at these coordinates; pass lat/lng exactly as "
                               "get_costar_properties returned them."})
    try:
        path = integrations.vexcel_fetch_tile(lat, lng, store.study_id)
    except Exception as e:  # noqa: BLE001
        for var in _vexcel_vars(store):
            store.mark_missing(bid, var, "vexcel", f"No aerial imagery: {e}")
        return _json({"building_id": bid, "error": str(e)})
    store.buildings[bid]["aerial_tile"] = str(path)
    rel = path.relative_to(config.TILES_DIR).as_posix() if path.is_relative_to(config.TILES_DIR) else path.name
    events.emit(store.study_id, "building_updated", {"building_id": bid, "aerial_url": f"/tiles/{rel}"})
    return _json({"building_id": bid, "image_path": str(path)})


def measure_parking(image_path: str) -> str:
    """Measure surface parking in an aerial tile with a vision model and write it to the dataset.

    Args:
        image_path: Path returned by get_aerial_tile.
    """
    store = _store()
    bid = next((b for b, m in store.buildings.items() if m.get("aerial_tile") == image_path), None)
    if bid is None:
        return _json({"error": "Unknown image_path; call get_aerial_tile first and pass its image_path unchanged."})
    from pathlib import Path

    path = Path(image_path)
    n = (store.plan or {}).get("sample", {}).get("n", config.DEFAULT_SAMPLE_N)
    try:
        m, from_cache = cache.cached("vision", path.name,
                                     lambda: llm.measure_parking_image(path).model_dump(), pace_items=n)
    except Exception as e:  # noqa: BLE001
        for var in _vexcel_vars(store):
            store.mark_missing(bid, var, "vexcel", f"Vision measurement failed: {e}", f"Vexcel tile {path.name}")
        return _json({"building_id": bid, "error": f"Vision measurement failed: {e}"})

    ref = f"Vexcel tile {path.name}"
    planned = set(_vexcel_vars(store))
    if "est_surface_spaces" in planned:
        store.set_cell(bid, "est_surface_spaces", m["est_spaces"], "vexcel", m["confidence"], ref, note=m["notes"])
    if "surface_parking_pct" in planned:
        store.set_cell(bid, "surface_parking_pct", m["surface_parking_pct"], "vexcel", m["confidence"], ref, note=m["notes"])
    return _json({"building_id": bid, **m, "cached": from_cache})


# ========================================================= gap_analyst ====
_emitted_gaps: set[tuple[str, str, str]] = set()


def check_coverage() -> str:
    """Compare the dataset against the approved plan. Returns, per building, the missing
    variables and why."""
    store = _store()
    report = []
    for bid in store.buildings:
        missing = []
        for v in store.planned_variables():
            cell = store.get_cell(bid, v["name"])
            if cell and cell["status"] == "filled":
                continue
            reason = (cell or {}).get("reason") or "Not collected."
            missing.append({"variable": v["name"], "source": v["source"], "reason": reason})
            key = (store.study_id, bid, v["name"])
            if key not in _emitted_gaps:
                _emitted_gaps.add(key)
                events.emit(store.study_id, "gap_detected",
                            {"building_id": bid, "variable": v["name"], "source": v["source"], "reason": reason})
        report.append({"building_id": bid, "name": store.buildings[bid].get("name"), "missing": missing})
    total = len(store.buildings) * len(store.planned_variables())
    filled = sum(1 for c in store.cells.values() if c["status"] == "filled")
    return _json({"coverage": f"{filled}/{total} cells filled", "buildings": report})


# ============================================================== analyst ====
def run_analysis() -> str:
    """Run the grouped comparison by decade built (bootstrap 95% CIs, Spearman, Mann-Whitney)
    on all filled cells. Returns findings, effect sizes, a Vega-Lite chart spec and limitations."""
    store = _store()
    result = analysis.run(store)
    store.set_findings(result)
    events.emit(store.study_id, "findings_ready", result)
    return _json(result)
