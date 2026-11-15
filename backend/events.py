"""Per-study event bus. Thread-safe: tools run in worker threads and emit here.

Every event is {"type", "study_id", "seq", "ts", "data"}. History is kept so an
SSE client that connects late (or reconnects) gets the full stream replayed.

Event types (see README):
  step_started, step_done, plan_ready, cell_updated, gap_detected,
  approval_required, call_transcript, findings_ready,
  plus study_completed / study_failed so clients know when to stop listening.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

TERMINAL = {"study_completed", "study_failed"}


class StudyChannel:
    def __init__(self, study_id: str, loop: asyncio.AbstractEventLoop):
        self.study_id = study_id
        self.loop = loop
        self.history: list[dict[str, Any]] = []
        self.subscribers: list[asyncio.Queue] = []
        self._lock = threading.Lock()

    def emit(self, type_: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            event = {
                "type": type_,
                "study_id": self.study_id,
                "seq": len(self.history),
                "ts": time.time(),
                "data": data or {},
            }
            self.history.append(event)
            subs = list(self.subscribers)
        for q in subs:
            self.loop.call_soon_threadsafe(q.put_nowait, event)
        return event

    def subscribe(self) -> tuple[list[dict[str, Any]], asyncio.Queue]:
        """Return (history snapshot, queue for new events). Call from the event loop."""
        q: asyncio.Queue = asyncio.Queue()
        with self._lock:
            snapshot = list(self.history)
            self.subscribers.append(q)
        return snapshot, q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            if q in self.subscribers:
                self.subscribers.remove(q)


_channels: dict[str, StudyChannel] = {}


def create_channel(study_id: str, loop: asyncio.AbstractEventLoop) -> StudyChannel:
    ch = StudyChannel(study_id, loop)
    _channels[study_id] = ch
    return ch


def get_channel(study_id: str) -> StudyChannel | None:
    return _channels.get(study_id)


def emit(study_id: str | None, type_: str, data: dict[str, Any] | None = None) -> None:
    """Emit if the study has a channel; silently no-op otherwise (e.g. unit tests)."""
    if study_id and (ch := _channels.get(study_id)):
        ch.emit(type_, data)
