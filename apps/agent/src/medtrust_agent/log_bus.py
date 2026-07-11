"""In-process pub/sub bridge between the (blocking) training executor and the
(async) WebSocket / gRPC streams.

The trainer runs in a thread-pool and emits events via ``publish`` (thread-safe,
hops onto the event loop). Stream consumers ``subscribe`` and receive the full
history followed by live events until the task reaches a terminal phase.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import AsyncIterator, Dict, List, Optional

_TERMINAL = {"done", "failed"}


class TaskLogBus:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self._history: Dict[str, List[dict]] = defaultdict(list)
        self._subscribers: Dict[str, List[asyncio.Queue]] = defaultdict(list)
        self._done: Dict[str, bool] = defaultdict(bool)
        self._results: Dict[str, dict] = {}

    # ---- producer side (called from any thread) ----
    def publish(self, task_id: str, event: dict) -> None:
        if self._loop.is_closed():
            return
        try:
            self._loop.call_soon_threadsafe(self._publish_in_loop, task_id, event)
        except RuntimeError:
            pass

    def set_result(self, task_id: str, result: dict) -> None:
        if self._loop.is_closed():
            return
        try:
            self._loop.call_soon_threadsafe(self._results.__setitem__, task_id, result)
        except RuntimeError:
            pass

    def _publish_in_loop(self, task_id: str, event: dict) -> None:
        self._history[task_id].append(event)
        for q in self._subscribers[task_id]:
            q.put_nowait(event)
        if event.get("phase") in _TERMINAL:
            self._done[task_id] = True

    # ---- consumer side (in the event loop) ----
    async def subscribe(self, task_id: str) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        # Atomic snapshot + registration (no await in between).
        for event in list(self._history[task_id]):
            q.put_nowait(event)
        already_done = self._done[task_id]
        self._subscribers[task_id].append(q)
        try:
            if already_done and q.empty():
                return
            while True:
                event = await q.get()
                yield event
                if event.get("phase") in _TERMINAL:
                    break
        finally:
            self._subscribers[task_id].remove(q)

    def snapshot(self, task_id: str) -> List[dict]:
        return list(self._history[task_id])

    def is_done(self, task_id: str) -> bool:
        return self._done[task_id]

    def result(self, task_id: str) -> Optional[dict]:
        return self._results.get(task_id)
