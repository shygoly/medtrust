"""WebSocket training-log server.

Clients connect to ``ws://<host>:<port>/logs/<task_id>`` and receive a JSON
event stream: history replay followed by live training events until the task
finishes. This is the data-plane → control-plane log channel the design calls
for (the NestJS orchestrator subscribes here and fans out to browsers).
"""

from __future__ import annotations

import asyncio
import json
import logging

import websockets

from .log_bus import TaskLogBus

log = logging.getLogger("medtrust_agent.ws")


def _task_id_from_path(websocket) -> str:
    # websockets >=11 exposes the path on websocket.request.path; older on .path
    request = getattr(websocket, "request", None)
    path = getattr(request, "path", None) or getattr(websocket, "path", "") or ""
    return path.rstrip("/").rsplit("/", 1)[-1]


def make_ws_handler(bus: TaskLogBus):
    async def handler(websocket):
        task_id = _task_id_from_path(websocket)
        if not task_id:
            await websocket.close(code=1008, reason="missing task id in path")
            return
        log.info("ws subscriber attached task=%s", task_id)
        try:
            async for event in bus.subscribe(task_id):
                await websocket.send(json.dumps({"taskId": task_id, **event}))
            # The terminal phase can land just before set_result is processed;
            # briefly wait so the final safe result frame is reliably delivered.
            result = bus.result(task_id)
            for _ in range(40):
                if result is not None:
                    break
                await asyncio.sleep(0.05)
                result = bus.result(task_id)
            if result is not None:
                await websocket.send(json.dumps({"taskId": task_id, "phase": "result", "result": result}))
        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("ws subscriber detached task=%s", task_id)

    return handler


async def start_ws_server(bus: TaskLogBus, host: str, port: int):
    return await websockets.serve(make_ws_handler(bus), host, port)
