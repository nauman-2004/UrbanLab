"""Offline end-to-end test: the real DeepAgents graph, real tools, real interrupts,
driven by a scripted fake chat model (no API key, no network).

LLM vision/extraction calls are monkeypatched; telephony stub runs as-is.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402

PLAN_ARGS = {
    "hypothesis": "Older Houston offices have fewer EV charging ports than newer ones.",
    "variables": [
        {"name": "year_built", "source": "costar", "type": "int"},
        {"name": "parking_spaces", "source": "costar", "type": "int"},
        {"name": "surface_parking_pct", "source": "vexcel", "type": "float"},
        {"name": "est_surface_spaces", "source": "vexcel", "type": "int"},
        {"name": "ev_chargers_installed", "source": "survey", "type": "int"},
        {"name": "ev_expansion_planned", "source": "survey", "type": "bool"},
    ],
    "sample": {"city": "Houston", "property_type": "Office", "n": 8},
}


class ScriptedModel(BaseChatModel):
    """Decides the next move from the system prompt (which agent) and prior tool results."""

    calls: int = 0

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.calls += 1
        sys_text = " ".join(m.text for m in messages if isinstance(m, SystemMessage))
        tool_msgs = [m for m in messages if isinstance(m, ToolMessage)]
        msg = self._decide(sys_text, tool_msgs)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    @staticmethod
    def _tc(name: str, args: dict, i: int = 0) -> dict:
        return {"name": name, "args": args, "id": f"call_{name}_{i}_{abs(hash(json.dumps(args, sort_keys=True))) % 10**8}"}

    def _decide(self, sys_text: str, tool_msgs: list[ToolMessage]) -> AIMessage:
        done = len(tool_msgs)
        if "Principal Investigator" in sys_text:
            tasks = [m for m in tool_msgs if m.name == "task"]
            order = ["planner", "data_collector", "vision_measurer", "gap_analyst", "field_surveyor", "analyst"]
            if len(tasks) < len(order):
                step = order[len(tasks)]
                return AIMessage(content="", tool_calls=[self._tc("task", {"subagent_type": step, "description": f"Do {step}"}, len(tasks))])
            return AIMessage(content="Study complete. See analyst findings.")
        if "submit_plan" in sys_text:
            last = tool_msgs[-1].content if tool_msgs else ""
            if '"approved"' in last:
                return AIMessage(content=last)
            if tool_msgs and "rejected" in str(last):  # reviewer rejected -> resubmit once
                return AIMessage(content="", tool_calls=[self._tc("submit_plan", PLAN_ARGS, done)])
            if not tool_msgs:
                return AIMessage(content="", tool_calls=[self._tc("submit_plan", PLAN_ARGS)])
            return AIMessage(content=str(last))
        if "get_costar_properties" in sys_text:
            if not done:
                return AIMessage(content="", tool_calls=[self._tc("get_costar_properties", {"city": "Houston", "property_type": "Office", "limit": 8})])
            return AIMessage(content=tool_msgs[-1].content)
        if "get_aerial_tile" in sys_text:
            from dataset import get_store
            import tools as t
            store = get_store(t._study_id())
            if not done:
                return AIMessage(content="", tool_calls=[self._tc("get_aerial_tile", {"lat": b["lat"], "lng": b["lng"]}, i)
                                                          for i, b in enumerate(store.buildings.values())])
            if all(m.name == "get_aerial_tile" for m in tool_msgs):
                paths = [json.loads(m.content).get("image_path") for m in tool_msgs]
                return AIMessage(content="", tool_calls=[self._tc("measure_parking", {"image_path": p}, i) for i, p in enumerate(paths) if p])
            return AIMessage(content="measured")
        if "check_coverage" in sys_text:
            if not done:
                return AIMessage(content="", tool_calls=[self._tc("check_coverage", {})])
            return AIMessage(content="Survey B-01, B-05, B-08")
        if "request_survey_call" in sys_text:
            if not done:
                qs = ["How many EV charging ports does the property have today?", "Do you plan to add EV chargers in the next 12 months?"]
                return AIMessage(content="", tool_calls=[self._tc("request_survey_call", {"building_id": b, "questions": qs}, i)
                                                          for i, b in enumerate(["B-01", "B-05", "B-08"])])
            return AIMessage(content="surveys done")
        if "run_analysis" in sys_text:
            if not done:
                return AIMessage(content="", tool_calls=[self._tc("run_analysis", {})])
            return AIMessage(content="report")
        return AIMessage(content="noop")


@pytest.fixture
def tmp_data(tmp_path, monkeypatch):
    return install_fakes(tmp_path, monkeypatch)


def install_fakes(tmp_path, monkeypatch):
    """Point data paths at tmp_path and replace the LLM vision/extraction calls with fakes."""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DATASET_JSON", tmp_path / "dataset.json")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "DEMO_MODE", False)
    import llm

    def fake_measure(path):
        older = path.name in {"29.75710_-95.36410.png", "29.74980_-95.46120.png", "29.73890_-95.46310.png",
                              "29.76050_-95.36980.png", "29.73360_-95.43180.png"}
        return llm.ParkingMeasurement(est_spaces=120 if older else 60, surface_parking_pct=70.0 if older else 30.0,
                                      confidence=0.8, notes="fake")

    def fake_extract(transcript, targets):
        answers = []
        for var in targets:
            contact = [t for t in transcript if t["speaker"] == "contact"]
            if var == "ev_chargers_installed":
                turn = contact[1]
                import re
                n = re.search(r"(\d+)", turn["text"])
                answers.append(llm.ExtractedAnswer(variable=var, value=float(n.group(1)) if n else 0.0, confidence=0.9, quote=turn["text"], t=turn["t"]))
            else:
                answers.append(llm.ExtractedAnswer(variable=var, value=None, confidence=0.2, quote=None, t=None))
        return llm.TranscriptExtraction(answers=answers)

    monkeypatch.setattr(llm, "measure_parking_image", fake_measure)
    monkeypatch.setattr(llm, "extract_survey_answers", fake_extract)
    return tmp_path


def test_full_pipeline(tmp_data):
    import events
    import runner
    from agent import build_agent
    from dataset import get_store

    async def main() -> list[dict[str, Any]]:
        sid = "st-test"
        ch = events.create_channel(sid, asyncio.get_running_loop())
        study = runner.Study(id=sid, question="How prepared are commercial office properties in Houston for EV adoption?")
        runner.STUDIES[sid] = study
        _, q = ch.subscribe()
        task = asyncio.create_task(runner.run_study(study, build_agent(model=ScriptedModel())))
        seen: list[dict[str, Any]] = []
        plan_rejected = False
        while True:
            ev = await asyncio.wait_for(q.get(), timeout=60)
            seen.append(ev)
            if ev["type"] == "approval_required":
                d = ev["data"]
                await asyncio.sleep(0.05)
                if d["kind"] == "plan" and not plan_rejected:
                    plan_rejected = True
                    runner.answer(study, d["action_id"], False, feedback="Add EV expansion plans.")
                elif d["kind"] == "survey" and d["args"]["building_id"] == "B-08":
                    runner.answer(study, d["action_id"], False)
                else:
                    runner.answer(study, d["action_id"], True)
            if ev["type"] in events.TERMINAL:
                break
        await task
        return seen

    seen = asyncio.run(main())
    types = [e["type"] for e in seen]
    print("\n".join(f"{e['type']}: {json.dumps(e['data'])[:140]}" for e in seen if e["type"] != "cell_updated"))
    assert types[-1] == "study_completed", seen[-1]
    approvals = [e["data"] for e in seen if e["type"] == "approval_required"]
    assert [a["kind"] for a in approvals].count("plan") == 2  # rejected once, then approved
    assert [a["kind"] for a in approvals].count("survey") == 3
    for t in ["step_started", "step_done", "plan_ready", "cell_updated", "gap_detected", "call_transcript", "findings_ready"]:
        assert t in types, f"missing {t}"
    assert types.count("call_transcript") == 2  # B-08 rejected -> no call

    store = get_store("st-test")
    snap = store.snapshot()
    by = {(c["building_id"], c["variable"]): c for c in snap["cells"]}
    # Every building x planned variable exists explicitly
    assert len(snap["cells"]) == len(snap["buildings"]) * len(PLAN_ARGS["variables"])
    # Provenance
    assert by[("B-01", "year_built")]["source"] == "costar" and by[("B-01", "year_built")]["evidence_ref"].startswith("CoStar #")
    assert by[("B-04", "parking_spaces")]["status"] == "missing"  # blank in CSV -> missing, not invented
    assert by[("B-07", "surface_parking_pct")]["status"] == "missing"  # no tile
    assert "No aerial imagery" in by[("B-07", "surface_parking_pct")]["reason"]
    assert by[("B-01", "ev_chargers_installed")]["source"] == "survey"
    assert by[("B-01", "ev_chargers_installed")]["evidence_ref"].startswith("STUB call-")
    assert by[("B-08", "ev_chargers_installed")]["reason"] == "Survey call not approved by the reviewer."
    assert by[("B-01", "ev_expansion_planned")]["status"] == "missing"  # extraction returned null
    assert snap["findings"]["chart_spec"] is not None
    assert json.loads((tmp_data / "dataset.json").read_text())["study_id"] == "st-test"
