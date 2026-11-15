"""JSON-in / JSON-out functions for the agent backend (e.g. LangChain Deep Agents).

These are plain Python callables with docstrings; wrap them with your agent
framework's tool decorator. No orchestration lives here: the agent decides
when to plan, when to ask for approval, and when to run.

Typical flow:

1. ``describe_capabilities()``          -> what can be measured right now
2. LLM turns the question into a spec (``research_spec_schema()``)
3. ``plan_research_tool(spec)``          -> sources, gaps, request estimate
4. human approval if ``needs_live_requests``
5. ``run_research_tool(spec, ...)``      -> events + dataset + gaps
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from .config import Settings, load_settings
from .events import Profile
from .research.planner import plan_research
from .research.pipeline import run_research
from .research.spec import SUPPORTED_REGIONS, ResearchSpec, SpecError, spec_json_schema
from .research.variables import VARIABLES
from .runtime import Mode, build_runtime


def research_spec_schema(mode: Mode = "synthetic", settings: Settings | None = None) -> dict[str, Any]:
    """JSON Schema of the research spec the agent must produce from the user's question.
    Includes every catalog variable plus any extra field mapped in the local kit field map."""
    settings = settings or load_settings()
    with build_runtime(settings, mode) as rt:
        return spec_json_schema(rt.capabilities.kit_fields)


def describe_capabilities(mode: Mode = "synthetic", settings: Settings | None = None) -> dict[str, Any]:
    """Which variables exist, which sources are configured, and coverage/limits. Makes no requests."""
    settings = settings or load_settings()
    with build_runtime(settings, mode) as rt:
        return {
            "mode": mode,
            "capabilities": rt.capabilities.to_dict(),
            "problems": rt.problems,
            "regions": list(SUPPORTED_REGIONS),
            "variables": {
                k: {"label": v.label, "unit": v.unit, "frontend_key": v.frontend_key,
                    "sources": [{"source": o.source.value, "method": o.method.value, "requires": o.requires,
                                 "note": o.note} for o in v.options],
                    "excluded_sources": v.excluded_sources}
                for k, v in VARIABLES.items()
            },
        }


def plan_research_tool(spec: dict[str, Any], mode: Mode = "synthetic",
                       settings: Settings | None = None) -> dict[str, Any]:
    """Validate a spec and return the research plan (sources, gaps, request estimate). Makes no requests."""
    settings = settings or load_settings()
    with build_runtime(settings, mode) as rt:
        try:
            rs = ResearchSpec.from_dict(spec, rt.capabilities.kit_fields)
        except SpecError as e:
            return {"ok": False, "errors": e.errors, "problems": rt.problems}
        plan = plan_research(rs, rt.capabilities, max_properties=settings.max_properties)
        out = plan.to_dict()
        out["problems"] = rt.problems
        return out


def run_research_tool(spec: dict[str, Any], mode: Mode = "synthetic", *, approved_live_requests: bool = False,
                      emit: Callable[[dict[str, Any]], None] | None = None, profile: Profile = "strict",
                      finalize: bool = False, settings: Settings | None = None) -> dict[str, Any]:
    """Run a study. In ``real`` mode with live requests planned, ``approved_live_requests`` must be True
    (the human approval step); budgets and live flags in the root .env still apply."""
    settings = settings or load_settings()
    with build_runtime(settings, mode) as rt:
        try:
            rs = ResearchSpec.from_dict(spec, rt.capabilities.kit_fields)
        except SpecError as e:
            return {"ok": False, "errors": e.errors, "problems": rt.problems}
        plan = plan_research(rs, rt.capabilities, max_properties=settings.max_properties)
        if not plan.ok or rt.adapters is None:
            return {"ok": False, "errors": plan.errors + rt.problems, "plan": plan.to_dict()}
        if plan.needs_live_requests and not approved_live_requests:
            return {"ok": False, "errors": ["live requests planned; human approval required"],
                    "plan": plan.to_dict()}
        result = run_research(plan, rt.adapters, study_id=f"st-{uuid.uuid4().hex[:8]}", emit=emit,
                              profile=profile, finalize=finalize)
        return {"ok": True, "plan": plan.to_dict(), **result.to_dict()}
