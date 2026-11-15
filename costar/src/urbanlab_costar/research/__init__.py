"""Research layer: what can be measured, from where, at what cost; then collect it."""

from .planner import Capabilities, ResearchPlan, plan_research
from .spec import ResearchSpec, SpecError, spec_json_schema
from .variables import VARIABLES, SourceOption, Variable

__all__ = [
    "VARIABLES",
    "Capabilities",
    "ResearchPlan",
    "ResearchSpec",
    "SourceOption",
    "SpecError",
    "Variable",
    "plan_research",
    "spec_json_schema",
]
