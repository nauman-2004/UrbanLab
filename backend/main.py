"""FastAPI app.

    POST /studies                 {question}                       -> {study_id}
    GET  /studies/{id}/events     text/event-stream (SSE)
    POST /studies/{id}/approve    {action_id, approved, edited_args?, feedback?}
    GET  /studies/{id}/dataset    dataset snapshot with provenance
    GET  /studies/{id}            status + pending approvals

Run:  uv run uvicorn main:app --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import config
import events
import runner
from agent import build_agent
from dataset import get_store, has_store

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="UrbanLab agent backend")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

_agent = None


def agent():
    global _agent
    if _agent is None:
        _agent = build_agent()
    return _agent


class CreateStudy(BaseModel):
    question: str = Field(min_length=5)


class Approval(BaseModel):
    action_id: str
    approved: bool
    edited_args: dict[str, Any] | None = None
    feedback: str | None = None


def _study(study_id: str) -> runner.Study:
    if study_id not in runner.STUDIES:
        raise HTTPException(404, f"Unknown study {study_id}")
    return runner.STUDIES[study_id]


@app.get("/health")
def health():
    return {"ok": True, "model": config.MODEL, "demo_mode": config.DEMO_MODE}


@app.post("/studies")
async def create_study(body: CreateStudy):
    sid = runner.new_study_id()
    events.create_channel(sid, asyncio.get_running_loop())
    get_store(sid)
    study = runner.Study(id=sid, question=body.question)
    runner.STUDIES[sid] = study
    study.task = asyncio.create_task(runner.run_study(study, agent()))
    return {"study_id": sid}


@app.get("/studies/{study_id}")
def get_study(study_id: str):
    s = _study(study_id)
    return {"study_id": s.id, "question": s.question, "status": s.status, "summary": s.summary,
            "pending_approvals": [{"action_id": a.action_id, "tool": a.tool, "args": a.args} for a in s.pending.values()]}


@app.get("/studies/{study_id}/events")
async def stream_events(study_id: str):
    ch = events.get_channel(study_id)
    if ch is None:
        raise HTTPException(404, f"Unknown study {study_id}")

    async def gen():
        history, q = ch.subscribe()
        try:
            for ev in history:
                yield f"event: {ev['type']}\nid: {ev['seq']}\ndata: {json.dumps(ev, default=str)}\n\n"
                if ev["type"] in events.TERMINAL:
                    return
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"event: {ev['type']}\nid: {ev['seq']}\ndata: {json.dumps(ev, default=str)}\n\n"
                if ev["type"] in events.TERMINAL:
                    return
        finally:
            ch.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/studies/{study_id}/approve", status_code=202)
async def approve(study_id: str, body: Approval):  # async: resolves a future on the event loop
    s = _study(study_id)
    try:
        runner.answer(s, body.action_id, body.approved, body.edited_args, body.feedback)
    except KeyError:
        raise HTTPException(404, f"No pending action {body.action_id}; pending: {list(s.pending)}") from None
    return {"ok": True, "pending": list(s.pending)}


@app.get("/studies/{study_id}/dataset")
def dataset(study_id: str):
    if not has_store(study_id):
        raise HTTPException(404, f"Unknown study {study_id}")
    return get_store(study_id).snapshot()
