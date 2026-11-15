"""Runs one study: streams the deep agent, turns its progress into events,
and pauses on interrupts until POST /approve answers every pending action."""

from __future__ import annotations

import asyncio
import itertools
import logging
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command

import events
import tools
from dataset import get_store

log = logging.getLogger("urbanlab.runner")

_GATE_KIND = {"submit_plan": "plan", "request_survey_call": "survey"}


@dataclass
class PendingAction:
    action_id: str
    interrupt_id: str
    index: int
    tool: str
    args: dict[str, Any]
    allowed: list[str]
    future: asyncio.Future


@dataclass
class Study:
    id: str
    question: str
    status: str = "running"  # running | awaiting_approval | completed | failed
    pending: dict[str, PendingAction] = field(default_factory=dict)
    summary: str | None = None
    task: asyncio.Task | None = None
    _counter: itertools.count = field(default_factory=lambda: itertools.count(1))


STUDIES: dict[str, Study] = {}


def new_study_id() -> str:
    return f"st-{uuid.uuid4().hex[:8]}"


def answer(study: Study, action_id: str, approved: bool, edited_args: dict | None = None, feedback: str | None = None) -> None:
    """Resolve one pending approval. Raises KeyError if unknown."""
    action = study.pending.pop(action_id)
    if approved and edited_args and "edit" in action.allowed:
        decision = {"type": "edit", "edited_action": {"name": action.tool, "args": edited_args}}
    elif approved:
        decision = {"type": "approve"}
    else:
        if action.tool == "request_survey_call":
            bid = action.args.get("building_id")
            store = get_store(study.id)
            for v in store.planned_variables():
                if v["source"] == "survey" and bid in store.buildings:
                    store.mark_missing(bid, v["name"], "survey", "Survey call not approved by the reviewer.")
            msg = "The reviewer did NOT approve this call; it was not placed. Do not retry it. Continue without it."
        else:
            msg = "The reviewer rejected the plan." + (f" Feedback: {feedback}" if feedback else " Revise it and resubmit.")
        decision = {"type": "reject", "message": msg}
    action.future.set_result(decision)


def _unpack(chunk: Any) -> tuple[tuple, str, Any]:
    """Normalise astream(subgraphs=True) output across stream formats."""
    if isinstance(chunk, dict) and "type" in chunk and "data" in chunk:
        return tuple(chunk.get("ns") or ()), chunk["type"], chunk["data"]
    if isinstance(chunk, tuple) and len(chunk) == 3:
        return tuple(chunk[0]), chunk[1], chunk[2]
    if isinstance(chunk, tuple) and len(chunk) == 2:
        return tuple(chunk[0]), "updates", chunk[1]
    return (), "updates", chunk


def _iter_messages(update: Any):
    if not isinstance(update, dict):
        return
    for node_update in update.values():
        msgs = node_update.get("messages") if isinstance(node_update, dict) else None
        if not msgs:
            continue
        for m in (msgs if isinstance(msgs, list) else [msgs]):
            yield m


async def run_study(study: Study, agent) -> None:
    sid = study.id
    tools.CURRENT_STUDY.set(sid)
    cfg = {"configurable": {"thread_id": sid, "study_id": sid}, "recursion_limit": 300}
    inp: Any = {"messages": [{"role": "user", "content": study.question}]}
    open_steps: dict[str, str] = {}  # task tool_call_id -> subagent name

    try:
        while True:
            interrupts: dict[str, Any] = {}
            async for chunk in agent.astream(inp, cfg, stream_mode="updates", subgraphs=True, version="v2"):
                ns, mode, data = _unpack(chunk)
                if mode != "updates" or not isinstance(data, dict):
                    continue
                if "__interrupt__" in data:
                    for it in data["__interrupt__"]:
                        interrupts[it.id] = it
                    continue
                if ns:  # only the orchestrator's own messages drive step events
                    continue
                for m in _iter_messages(data):
                    if isinstance(m, AIMessage):
                        for tc in m.tool_calls or []:
                            if tc["name"] == "task" and tc["id"] not in open_steps:
                                step = tc["args"].get("subagent_type", "unknown")
                                open_steps[tc["id"]] = step
                                events.emit(sid, "step_started", {"step": step, "step_id": tc["id"],
                                                                  "description": tc["args"].get("description", "")})
                    elif isinstance(m, ToolMessage) and m.tool_call_id in open_steps:
                        step = open_steps.pop(m.tool_call_id)
                        events.emit(sid, "step_done", {"step": step, "step_id": m.tool_call_id,
                                                       "summary": str(m.content)[:2000]})

            if not interrupts:
                break

            # Emit one approval_required per action, then wait for all of them.
            study.status = "awaiting_approval"
            loop = asyncio.get_running_loop()
            per_interrupt: dict[str, list[PendingAction]] = {}
            for iid, it in interrupts.items():
                value = it.value or {}
                configs = {c["action_name"]: c for c in value.get("review_configs", [])}
                for i, req in enumerate(value.get("action_requests", [])):
                    action_id = f"ap-{next(study._counter)}"
                    allowed = configs.get(req["name"], {}).get("allowed_decisions", ["approve", "reject"])
                    pa = PendingAction(action_id, iid, i, req["name"], req.get("args", {}), allowed, loop.create_future())
                    study.pending[action_id] = pa
                    per_interrupt.setdefault(iid, []).append(pa)
                    events.emit(sid, "approval_required", {
                        "action_id": action_id,
                        "kind": _GATE_KIND.get(req["name"], "tool"),
                        "tool": req["name"],
                        "args": req.get("args", {}),
                        "description": req.get("description", ""),
                        "allowed_decisions": allowed,
                    })
            resume: dict[str, Any] = {}
            for iid, actions in per_interrupt.items():
                decisions = [await a.future for a in sorted(actions, key=lambda a: a.index)]
                resume[iid] = {"decisions": decisions}
            study.status = "running"
            inp = Command(resume=resume if len(resume) > 1 else next(iter(resume.values())))

        state = await agent.aget_state(cfg)
        msgs = state.values.get("messages", [])
        study.summary = next((m.text if hasattr(m, "text") else str(m.content)
                              for m in reversed(msgs) if isinstance(m, AIMessage) and not m.tool_calls), None)
        study.status = "completed"
        events.emit(sid, "study_completed", {"summary": study.summary})
    except asyncio.CancelledError:
        study.status = "failed"
        events.emit(sid, "study_failed", {"error": "cancelled"})
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("study %s failed", sid)
        study.status = "failed"
        events.emit(sid, "study_failed", {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})
