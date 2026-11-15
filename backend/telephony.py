"""Phone survey calls. TEAMMATE: replace start_call() with Twilio + Cartesia.

Contract (keep it): start_call(building, questions, contact_role) blocks until
the call ends and returns a CallResult. Transcript turns are
{"speaker": "agent"|"contact", "text": str, "t": seconds_into_call}.
Set stub=False for real calls. If the contact declines consent, return an
empty-answer transcript with consent=False; the caller marks cells missing.

The current body is a STUB: it waits 3 s and returns a scripted transcript.
Every value extracted from it is tagged as stub data in the dataset
(evidence_ref starts with "STUB").
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CallResult:
    call_id: str
    building_id: str
    contact_role: str
    consent: bool
    transcript: list[dict[str, Any]] = field(default_factory=list)
    duration_s: float = 0.0
    stub: bool = True


def start_call(building: dict[str, Any], questions: list[str], contact_role: str = "Property manager") -> CallResult:
    """Place a survey call to the building's contact and return the transcript."""
    time.sleep(3)
    call_id = f"call-{uuid.uuid4().hex[:6]}"
    h = int(hashlib.sha256(building["building_id"].encode()).hexdigest(), 16)
    t = 0.0
    turns: list[dict[str, Any]] = []

    def say(speaker: str, text: str, dt: float = 4.0) -> None:
        nonlocal t
        turns.append({"speaker": speaker, "text": text, "t": round(t, 1)})
        t += dt

    say("agent", f"Hi, this is an automated research assistant from UrbanLab calling about {building.get('name', 'your building')}. "
                 "This call is recorded for research. Is it okay to ask a few short questions?")
    say("contact", "Sure, go ahead.")
    # Scripted answers (stub only). Vary by building so the demo isn't uniform.
    ports = [0, 2, 4, 6, 8, 12][h % 6]
    for q in questions:
        say("agent", q)
        ql = q.lower()
        if "charg" in ql and ("how many" in ql or "number" in ql or "ports" in ql or "installed" in ql):
            say("contact", "None right now." if ports == 0 else f"We have {ports} charging ports in the garage today.")
        elif "plan" in ql or "next" in ql or "expan" in ql or "budget" in ql:
            say("contact", "Yes, we've budgeted more chargers for next year." if h % 3 else "No, nothing planned at the moment.")
        elif "tenant" in ql or "request" in ql or "ask" in ql:
            say("contact", "Yes, a couple of tenants have asked about it." if h % 2 else "Honestly no one has asked yet.")
        else:
            say("contact", "I'm not sure, I'd have to check on that.")
    say("agent", "That's everything. Thank you for your time!")
    return CallResult(call_id=call_id, building_id=building["building_id"], contact_role=contact_role,
                      consent=True, transcript=turns, duration_s=t, stub=True)
