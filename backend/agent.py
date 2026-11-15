"""The DeepAgents graph: a Principal Investigator orchestrator + five subagents.

One human gate via DeepAgents `interrupt_on` (HumanInTheLoopMiddleware):
  planner -> submit_plan  (approve / edit / reject)
A `when` predicate skips the interrupt for plans that would be refused anyway
(invalid plan), so humans only review real plans.
"""

from __future__ import annotations

import json

from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

import config
import tools as t
from dataset import VARIABLE_CATALOG

_CATALOG = json.dumps({k: {"source": v["source"], "type": v["type"], "label": v["label"]} for k, v in VARIABLE_CATALOG.items()}, indent=1)

PLAN_GATE = {"allowed_decisions": ["approve", "edit", "reject"], "when": t.plan_needs_review,
             "description": "Review the research plan before any data is collected."}

SUBAGENTS = [
    {
        "name": "planner",
        "description": "Turns the research question into a structured study plan and submits it for human approval. Call first.",
        "system_prompt": (
            "You design built-environment studies. Turn the question into a plan and call submit_plan ONCE.\n"
            "- hypothesis: one falsifiable sentence about how the outcome varies with building age.\n"
            "- variables: choose ONLY from this catalog, using the catalog's source and type. Always include year_built. "
            "Only these variables can be collected (CoStar records and aerial imagery). If the question's outcome "
            "isn't among them, study the closest measurable proxy and say so in the hypothesis.\n"
            f"{_CATALOG}\n"
            f"- sample: city, property_type as CoStar names it (e.g. 'Office'), n (default {config.DEFAULT_SAMPLE_N}).\n"
            "  The CoStar data covers only Houston and Los Angeles. If the question is about another city, "
            "do not substitute one: reply that it can't be studied with the available data and do not submit a plan.\n"
            "If submit_plan returns status 'invalid', fix the errors and resubmit. If the reviewer rejects it, revise per "
            "their message and resubmit. When approved, reply with the approved plan JSON and nothing else."
        ),
        "tools": [t.submit_plan],
        "interrupt_on": {"submit_plan": PLAN_GATE},
    },
    {
        "name": "data_collector",
        "description": "Pulls the CoStar sample for the approved plan into the dataset.",
        "system_prompt": (
            "Call get_costar_properties once with the city, property_type and n (as limit) you are given. "
            "The tool writes the dataset itself. Never state or invent property values. Reply with the building "
            "ids and their lat/lng exactly as returned, or the error."
        ),
        "tools": [t.get_costar_properties],
    },
    {
        "name": "vision_measurer",
        "description": "Measures surface parking for each building from Vexcel aerial tiles.",
        "system_prompt": (
            "For EVERY building you are given: call get_aerial_tile(lat, lng) with the exact coordinates, then "
            "measure_parking(image_path) with the exact image_path it returns. Make the calls for all buildings in "
            "parallel. If a tile or measurement fails, do not retry more than once and do not estimate yourself; "
            "the tool already records the gap. Reply with a one-line result per building."
        ),
        "tools": [t.get_aerial_tile, t.measure_parking],
    },
    {
        "name": "gap_analyst",
        "description": "Checks dataset coverage against the plan and explains what is missing and why.",
        "system_prompt": (
            "Call check_coverage once. Report the coverage and, per building, the missing variables with the reason. "
            "Do not invent reasons beyond the tool output."
        ),
        "tools": [t.check_coverage],
    },
    {
        "name": "analyst",
        "description": "Runs the statistical analysis and writes up findings, effect sizes, chart and limitations.",
        "system_prompt": (
            "Call run_analysis once. Then write a short report using ONLY its numbers: findings, effect sizes with "
            "95% CIs, and every limitation it lists. Say clearly when an interval includes zero. Never add numbers "
            "that are not in the tool output."
        ),
        "tools": [t.run_analysis],
    },
]

ORCHESTRATOR_PROMPT = """You are the Principal Investigator of UrbanLab, an AI scientist for the built environment.
Run the study by delegating with the `task` tool, in this order, one subagent at a time:
1. planner - pass the research question. Wait for the approved plan.
2. data_collector - pass city, property_type and n from the approved plan.
3. vision_measurer - pass every building_id with its lat/lng exactly as returned.
4. gap_analyst - ask for the coverage report.
5. analyst - ask for the final analysis.
Track progress with write_todos. Never invent data values: every number comes from a tool via a subagent.
If a step fails, note it and continue; missing data is recorded as missing. Finish with a 3-5 sentence summary
that cites the analyst's numbers and limitations."""


def build_agent(model=None, checkpointer=None):
    return create_deep_agent(
        model=model or config.MODEL,
        tools=[],
        system_prompt=ORCHESTRATOR_PROMPT,
        subagents=SUBAGENTS,
        interrupt_on={"submit_plan": PLAN_GATE},
        checkpointer=checkpointer or MemorySaver(),
        name="principal_investigator",
    )
