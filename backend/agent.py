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
import integrations
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
            "- goal: 'lookup' when the question asks to find, filter, list or rank properties (e.g. 'find Class B "
            "buildings built 1975-1995 ... return the top 5'); 'compare' when it asks whether an outcome differs by "
            "building age.\n"
            "- hypothesis: compare: one falsifiable sentence about how the outcome varies with building age. "
            "lookup: one sentence restating exactly what to find.\n"
            "- variables: choose ONLY from this catalog, using the catalog's source and type. For compare, always "
            "include year_built. For lookup, include every value the question asks to see (e.g. year_built, lot_sf, "
            "year_renovated). Only these variables exist (CoStar records and aerial imagery); if the question needs "
            "something else, say so instead of substituting. Only add vexcel variables when aerial measurement is "
            "actually asked for.\n"
            f"{_CATALOG}\n"
            f"- sample.city: Houston or Los Angeles. sample.property_type: one of {list(integrations.PROPERTY_TYPES)} "
            "(apartments = Multifamily, hotels = Hospitality, warehouses = Industrial, retail = GeneralRetail).\n"
            f"- sample.n: how many to return (default {config.DEFAULT_SAMPLE_N}; the top n when sorted).\n"
            "- sample.filters: EVERY condition in the question, one filter each, on CoStar variables only. Numbers "
            "use min/max (inclusive): 'built 1975-1995' -> year_built min 1975 max 1995; 'lot of at least 5 acres' "
            "-> lot_sf min 217800 (lot_sf is square feet; 1 acre = 43,560 sf); 'rating of 3' -> building_rating "
            "min 3 max 3. Categories use values: 'Class B' -> building_class values ['B']. 'No renovation since "
            "2012' -> year_renovated max 2012 with include_missing true (never renovated also qualifies).\n"
            "- sample.sort_by / sort_desc: when the question says rank, top, largest, oldest... ('rank by lot size, "
            "top 5' -> sort_by lot_sf, sort_desc true, n 5). Omit for a random sample.\n"
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
        "description": "Runs the approved plan's CoStar search (filters, ranking) into the dataset.",
        "system_prompt": (
            "Call get_costar_properties once (it takes no arguments: it runs the approved plan's search exactly). "
            "The tool writes the dataset itself. Never state or invent property values. Reply with how many "
            "properties matched, the building ids and their lat/lng exactly as returned, or the error."
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
            "Call run_analysis once. Then write a short report using ONLY its numbers. For a comparison: findings, "
            "effect sizes with 95% CIs, and every limitation; say clearly when an interval includes zero. For a "
            "lookup: how many properties matched, then the ranked list with CoStar ID and the requested values. "
            "Never add numbers that are not in the tool output."
        ),
        "tools": [t.run_analysis],
    },
]

ORCHESTRATOR_PROMPT = """You are the Principal Investigator of UrbanLab, an AI scientist for the built environment.
Run the study by delegating with the `task` tool, in this order, one subagent at a time:
1. planner - pass the research question. Wait for the approved plan.
2. data_collector - ask it to run the approved plan's search.
3. vision_measurer - ONLY if the approved plan has vexcel variables: pass every building_id with its lat/lng
   exactly as returned. Skip this step when the plan has no vexcel variables.
4. gap_analyst - ask for the coverage report.
5. analyst - ask for the final analysis. For a lookup plan this is the ranked list of matching properties.
Track progress with write_todos. Never invent data values: every number comes from a tool via a subagent.
If a step fails, note it and continue; missing data is recorded as missing. Finish with a 3-5 sentence summary
that cites the analyst's numbers and limitations; for a lookup, list each returned property with its CoStar ID and
the requested values exactly as the analyst reported them."""


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
