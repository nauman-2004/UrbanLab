"""Serializer + validator for the frontend ``StudyEvent`` contract.

Source of truth: ``frontend/src/lib/events.ts`` and ``frontend/src/lib/types.ts``.
This module mirrors them in Python so the agent backend can emit and check
events without importing TypeScript.

Two profiles:

- ``strict`` (default): exactly the current contract. Only the six frontend
  ``VariableKey``s are emitted as cells; method/confidence/uncertainty are
  carried inside ``evidence.note`` / ``evidence.confidence``.
- ``extended``: ALSO adds an optional ``cell.provenance`` object and emits
  catalog variables under their own keys. This is a PROPOSED, not yet
  approved contract extension.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Literal

from .provenance import Gap, Method, Value
from .research.variables import FRONTEND_KEYS, VARIABLES

Profile = Literal["strict", "extended"]

VARIABLE_KEYS = frozenset({"yearBuilt", "lotSf", "rbaSf", "surfaceSf", "garageStalls"})
SOURCES = frozenset({"costar", "vexcel", "matterport", "derived"})
VERIFICATIONS = frozenset({"observed"})
STAGES = frozenset({"plan", "collect", "measure", "fill", "analyze", "report"})
TODO_STATUS = frozenset({"pending", "running", "done"})
GAP_STATUS = frozenset({"open", "queued", "collecting", "filled", "declined"})

# Required keys per event type (mirrors events.ts).
REQUIRED: dict[str, tuple[str, ...]] = {
    "study.started": ("studyId", "question"),
    "study.error": ("message",),
    "plan.updated": ("plan",),
    "todos.updated": ("todos",),
    "stage.changed": ("stage",),
    "tool.called": ("name",),
    "subagent.started": ("name", "task"),
    "subagent.finished": ("name", "summary"),
    "property.added": ("property",),
    "cell.filled": ("propertyId", "variable", "cell"),
    "gap.detected": ("gap",),
    "gap.status": ("propertyId", "variable", "status"),
    "approval.requested": ("request",),
    "analysis.started": (),
    "report.ready": ("draft",),
}
PROPERTY_REQUIRED = ("id", "costarId", "name", "address", "propertyClass", "lat", "lng")


_IDENT = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _variable_ok(v: Any, profile: Profile) -> bool:
    """Strict: the six template keys. Extended: also any catalog or locally mapped kit variable name."""
    if v in VARIABLE_KEYS:
        return True
    return profile == "extended" and isinstance(v, str) and (v in VARIABLES or bool(_IDENT.match(v)))


def validate_event(e: Any, profile: Profile = "strict") -> list[str]:
    """Return a list of contract violations (empty list = valid)."""
    if not isinstance(e, dict):
        return ["event must be an object"]
    t = e.get("type")
    if t not in REQUIRED:
        return [f"unknown event type {t!r}"]
    errs = [f"{t}: missing '{k}'" for k in REQUIRED[t] if k not in e]
    if errs:
        return errs
    if t == "cell.filled":
        if not _variable_ok(e["variable"], profile):
            errs.append(f"cell.filled: unknown variable {e['variable']!r}")
        c = e["cell"]
        if not isinstance(c, dict):
            return errs + ["cell.filled: cell must be an object"]
        for k in ("value", "source", "verification", "evidence"):
            if k not in c:
                errs.append(f"cell.filled: cell missing '{k}'")
        if c.get("source") not in SOURCES:
            errs.append(f"cell.filled: bad source {c.get('source')!r}")
        if c.get("verification") not in VERIFICATIONS:
            errs.append(f"cell.filled: bad verification {c.get('verification')!r}")
        if profile == "strict" and not isinstance(c.get("value"), (int, float)):
            errs.append("cell.filled: strict profile requires a numeric value")
        ev = c.get("evidence")
        if not isinstance(ev, dict) or not isinstance(ev.get("ref"), str):
            errs.append("cell.filled: evidence.ref is required")
        elif "confidence" in ev and not (isinstance(ev["confidence"], (int, float)) and 0 <= ev["confidence"] <= 1):
            errs.append("cell.filled: evidence.confidence must be 0..1")
        allowed = {"value", "source", "verification", "evidence"} | ({"provenance"} if profile == "extended" else set())
        extra = set(c) - allowed - {"at"}
        if extra:
            errs.append(f"cell.filled: unexpected cell keys {sorted(extra)}")
    elif t == "gap.detected":
        g = e["gap"]
        for k in ("propertyId", "variable", "reason"):
            if not isinstance(g, dict) or k not in g:
                errs.append(f"gap.detected: gap missing '{k}'")
        if isinstance(g, dict) and not _variable_ok(g.get("variable"), profile):
            errs.append(f"gap.detected: unknown variable {g.get('variable')!r}")
    elif t == "property.added":
        p = e["property"]
        if not isinstance(p, dict):
            return errs + ["property.added: property must be an object"]
        for k in ("id", "costarId", "name", "address", "lat", "lng"):
            if k not in p:
                errs.append(f"property.added: property missing '{k}'")
    elif t == "stage.changed" and e["stage"] not in STAGES:
        errs.append(f"stage.changed: bad stage {e['stage']!r}")
    elif t == "todos.updated":
        for td in e["todos"]:
            if not {"id", "label", "status"} <= set(td) or td["status"] not in TODO_STATUS:
                errs.append("todos.updated: each todo needs id, label and a valid status")
    elif t == "gap.status" and e["status"] not in GAP_STATUS:
        errs.append(f"gap.status: bad status {e['status']!r}")
    return errs


def _fmt_conf(c: float | None) -> str:
    return f"; confidence {c:.2f}" if c is not None else ""


def cell_from_value(v: Value, profile: Profile = "strict") -> dict[str, Any]:
    notes = []
    if v.method is Method.MODEL_ESTIMATE:
        notes.append("MODEL ESTIMATE")
    elif v.method is Method.COMPUTED:
        notes.append("computed")
    if v.evidence.note:
        notes.append(v.evidence.note)
    if v.uncertainty:
        notes.append(f"uncertainty: {v.uncertainty}")
    evidence: dict[str, Any] = {"ref": v.evidence.ref}
    if notes:
        evidence["note"] = " · ".join(notes)
    if v.confidence is not None:
        evidence["confidence"] = v.confidence
    if v.evidence.quote:
        evidence["quote"] = v.evidence.quote
    if v.evidence.url:
        evidence["url"] = v.evidence.url
    cell: dict[str, Any] = {
        "value": v.value,
        "source": v.source.value,
        "verification": (v.verification.value if v.verification else "observed"),
        "evidence": evidence,
    }
    if profile == "extended":
        cell["provenance"] = {
            "method": v.method.value, "unit": v.unit, "confidence": v.confidence,
            "uncertainty": v.uncertainty, "inputs": list(v.inputs),
        }
    return cell


def frontend_variable(variable: str, profile: Profile) -> str | None:
    fk = FRONTEND_KEYS.get(variable)
    if fk:
        return fk
    return variable if profile == "extended" else None


class EventWriter:
    """Builds, validates and forwards events. Invalid events raise immediately."""

    def __init__(self, emit: Callable[[dict[str, Any]], None] | None = None, profile: Profile = "strict") -> None:
        self.profile: Profile = profile
        self._emit = emit
        self.events: list[dict[str, Any]] = []
        self.contract_warnings: list[str] = []

    def send(self, event: dict[str, Any]) -> None:
        errs = validate_event(event, self.profile)
        if errs:
            raise ValueError(f"contract violation: {errs}")
        self.events.append(event)
        if self._emit:
            self._emit(event)

    def study_started(self, study_id: str, question: str) -> None:
        self.send({"type": "study.started", "studyId": study_id, "question": question})

    def error(self, message: str, supported_regions: list[str] | None = None) -> None:
        e: dict[str, Any] = {"type": "study.error", "message": message}
        if supported_regions:
            e["supportedRegions"] = supported_regions
        self.send(e)

    def plan_updated(self, plan: dict[str, Any]) -> None:
        self.send({"type": "plan.updated", "plan": plan})

    def todos(self, todos: list[dict[str, str]]) -> None:
        self.send({"type": "todos.updated", "todos": todos})

    def stage(self, stage: str) -> None:
        self.send({"type": "stage.changed", "stage": stage})

    def tool(self, name: str, summary: str | None = None, args: str | None = None) -> None:
        e: dict[str, Any] = {"type": "tool.called", "name": name}
        if args:
            e["args"] = args
        if summary:
            e["summary"] = summary
        self.send(e)

    def property_added(self, info: dict[str, Any]) -> None:
        missing = [k for k in PROPERTY_REQUIRED if k not in info]
        if self.profile == "strict" and "missing" in info:
            raise ValueError("PropertyInfo.missing is only allowed in the extended profile")
        if missing:
            self.contract_warnings.append(
                f"{info.get('id')}: PropertyInfo fields not available from data and left out (not invented): {missing}"
            )
        self.send({"type": "property.added", "property": info})

    def cell(self, property_id: str, v: Value) -> bool:
        key = frontend_variable(v.variable, self.profile)
        if key is None:
            return False
        if self.profile == "strict" and not isinstance(v.value, (int, float)):
            return False
        self.send({"type": "cell.filled", "propertyId": property_id, "variable": key,
                   "cell": cell_from_value(v, self.profile)})
        return True

    def gap(self, property_id: str, g: Gap) -> bool:
        key = frontend_variable(g.variable, self.profile)
        if key is None:
            return False
        self.send({"type": "gap.detected", "gap": {"propertyId": property_id, "variable": key,
                                                   "reason": g.reason}})
        return True

    def analysis_started(self) -> None:
        self.send({"type": "analysis.started"})

    def report_ready(self, draft: int = 1) -> None:
        self.send({"type": "report.ready", "draft": draft})
