"""Dataset with per-cell provenance.

Every cell: {building_id, variable, value, source, confidence, evidence_ref,
status, reason, updated_at}. status is "filled" or "missing"; missing cells
always exist explicitly with value=None and a human-readable reason.

One DatasetStore per study, held in memory and mirrored to JSON on every write
(data/dataset.json = latest study, data/studies/<id>/dataset.json = per study).
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Literal

import config
import events

Source = Literal["costar", "vexcel", "survey"]

# Variables the pipeline knows how to collect. The planner must pick from here,
# so every planned variable has a tool that can actually fill it.
VARIABLE_CATALOG: dict[str, dict[str, str]] = {
    # CoStar property records
    "year_built": {"source": "costar", "type": "int", "label": "Year built"},
    "rba_sf": {"source": "costar", "type": "float", "label": "Rentable building area (sf)"},
    "lot_sf": {"source": "costar", "type": "float", "label": "Lot size (sf)"},
    "building_class": {"source": "costar", "type": "category", "label": "Building class"},
    "occupancy_pct": {"source": "costar", "type": "float", "label": "Occupancy (%)"},
    "parking_spaces": {"source": "costar", "type": "int", "label": "Parking spaces (CoStar)"},
    "parking_ratio": {"source": "costar", "type": "float", "label": "Parking ratio (/1,000 sf)"},
    # Vexcel aerial imagery measured by the vision model
    "est_surface_spaces": {"source": "vexcel", "type": "int", "label": "Est. surface spaces (aerial)"},
    "surface_parking_pct": {"source": "vexcel", "type": "float", "label": "Surface parking (% of lot)"},
    # Phone survey of the property manager
    "ev_chargers_installed": {"source": "survey", "type": "int", "label": "EV charging ports installed"},
    "ev_expansion_planned": {"source": "survey", "type": "bool", "label": "EV charger expansion planned (12 mo)"},
    "tenant_ev_requests": {"source": "survey", "type": "bool", "label": "Tenants have requested EV charging"},
}

# Why a variable can't be observed digitally — used by check_coverage.
UNOBSERVABLE_REASON = {
    "survey": "Not recorded in CoStar and not visible from aerial imagery (chargers, plans and tenant "
    "requests need the property manager); requires an approved phone survey.",
}


class DatasetStore:
    def __init__(self, study_id: str):
        self.study_id = study_id
        self.plan: dict[str, Any] | None = None
        self.buildings: dict[str, dict[str, Any]] = {}
        self.cells: dict[tuple[str, str], dict[str, Any]] = {}
        self.findings: dict[str, Any] | None = None
        self._lock = threading.RLock()

    # ---- plan -------------------------------------------------------------
    def set_plan(self, plan: dict[str, Any]) -> None:
        with self._lock:
            self.plan = plan
            # Every existing building gets explicit cells for every planned variable.
            for bid in self.buildings:
                self._ensure_cells(bid)
            self._persist()

    def planned_variables(self) -> list[dict[str, Any]]:
        return list((self.plan or {}).get("variables", []))

    # ---- buildings & cells -----------------------------------------------
    def add_building(self, building_id: str, meta: dict[str, Any]) -> None:
        with self._lock:
            self.buildings[building_id] = {"building_id": building_id, **meta}
            self._ensure_cells(building_id)
            self._persist()
        events.emit(self.study_id, "building_added", {"building": self.buildings[building_id]})

    def _ensure_cells(self, building_id: str) -> None:
        for v in self.planned_variables():
            key = (building_id, v["name"])
            if key not in self.cells:
                self.cells[key] = self._cell(
                    building_id, v["name"], None, v["source"], None, None,
                    status="missing", reason="Not yet collected.",
                )

    @staticmethod
    def _cell(building_id, variable, value, source, confidence, evidence_ref, *, status, reason=None, note=None):
        return {
            "building_id": building_id,
            "variable": variable,
            "value": value,
            "source": source,
            "confidence": confidence,
            "evidence_ref": evidence_ref,
            "status": status,
            "reason": reason,
            "note": note,
            "updated_at": time.time(),
        }

    def set_cell(
        self,
        building_id: str,
        variable: str,
        value: Any,
        source: Source,
        confidence: float | None,
        evidence_ref: str,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Record an observed value. A None value is recorded as missing."""
        if value is None:
            return self.mark_missing(building_id, variable, source, note or "Source returned no value.", evidence_ref)
        with self._lock:
            cell = self._cell(building_id, variable, value, source, confidence, evidence_ref, status="filled", note=note)
            self.cells[(building_id, variable)] = cell
            self._persist()
        events.emit(self.study_id, "cell_updated", {"cell": cell})
        return cell

    def mark_missing(
        self, building_id: str, variable: str, source: Source, reason: str, evidence_ref: str | None = None
    ) -> dict[str, Any]:
        with self._lock:
            existing = self.cells.get((building_id, variable))
            if existing and existing["status"] == "filled":
                return existing  # never overwrite real data with a gap
            cell = self._cell(building_id, variable, None, source, None, evidence_ref, status="missing", reason=reason)
            self.cells[(building_id, variable)] = cell
            self._persist()
        events.emit(self.study_id, "cell_updated", {"cell": cell})
        return cell

    def get_cell(self, building_id: str, variable: str) -> dict[str, Any] | None:
        return self.cells.get((building_id, variable))

    def set_findings(self, findings: dict[str, Any]) -> None:
        with self._lock:
            self.findings = findings
            self._persist()

    # ---- export -------------------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "study_id": self.study_id,
                "plan": self.plan,
                "buildings": list(self.buildings.values()),
                "cells": list(self.cells.values()),
                "findings": self.findings,
            }

    def _persist(self) -> None:
        payload = json.dumps(self.snapshot(), indent=2, default=str)
        study_dir = config.DATA_DIR / "studies" / self.study_id
        study_dir.mkdir(parents=True, exist_ok=True)
        (study_dir / "dataset.json").write_text(payload, encoding="utf-8")
        config.DATASET_JSON.parent.mkdir(parents=True, exist_ok=True)
        config.DATASET_JSON.write_text(payload, encoding="utf-8")


_stores: dict[str, DatasetStore] = {}


def get_store(study_id: str) -> DatasetStore:
    if study_id not in _stores:
        _stores[study_id] = DatasetStore(study_id)
    return _stores[study_id]


def has_store(study_id: str) -> bool:
    return study_id in _stores
