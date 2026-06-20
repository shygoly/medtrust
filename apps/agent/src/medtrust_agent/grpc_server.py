"""gRPC SecretFlowAgent servicer (§4.1 SubmitFLTask, §4.2 ReportNodeStatus).

The orchestrator dispatches a task; the agent runs real FedAvg in a thread pool,
streaming progress to the log bus. Coarse node status is also available as a
server-streamed gRPC channel; fine-grained logs flow over WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from . import config
from .generated import secretflow_pb2 as pb
from .generated import secretflow_pb2_grpc as pb_grpc
from .log_bus import TaskLogBus
from .runtime import run_task

log = logging.getLogger("medtrust_agent.grpc")

# Degraded (pyu_only) nodes run fewer local epochs than full TEEU nodes.
_TIER_LOCAL_EPOCHS = {"teeu_full": 2, "pyu_only": 1}


class TaskRunner:
    def __init__(self, bus: TaskLogBus, loop: asyncio.AbstractEventLoop, max_workers: int = 2):
        self._bus = bus
        self._loop = loop
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def node_local_epochs(self, node_plan) -> Dict[str, int]:
        return {
            np.participant_id: _TIER_LOCAL_EPOCHS.get(np.tier, 2)
            for np in node_plan
            if np.participant_id
        }

    def submit(self, task_id: str, spec_yaml: str, node_plan) -> None:
        node_epochs = self.node_local_epochs(node_plan)
        asyncio.run_coroutine_threadsafe(self._run(task_id, spec_yaml, node_epochs), self._loop)

    async def _run(self, task_id: str, spec_yaml: str, node_epochs: Dict[str, int]) -> None:
        bus = self._bus
        try:
            result = await self._loop.run_in_executor(
                self._executor,
                lambda: run_task(
                    task_id,
                    spec_yaml,
                    emit=lambda e: bus.publish(task_id, e),
                    node_local_epochs=node_epochs or None,
                ),
            )
            bus.set_result(task_id, result)
        except Exception as exc:  # noqa: BLE001
            log.exception("task %s failed", task_id)
            bus.publish(task_id, {"phase": "failed", "reason": str(exc)})
            bus.set_result(task_id, {"taskId": task_id, "state": "FAILED", "error": str(exc)})


class SecretFlowAgentServicer(pb_grpc.SecretFlowAgentServicer):
    def __init__(self, runner: TaskRunner, bus: TaskLogBus):
        self._runner = runner
        self._bus = bus

    async def SubmitFLTask(self, request: pb.SubmitFLTaskRequest, context) -> pb.SubmitFLTaskResponse:
        if not request.task_id or not request.spec_yaml:
            return pb.SubmitFLTaskResponse(
                task_id=request.task_id, ack_status="REJECTED", message="task_id and spec_yaml required"
            )
        log.info("SubmitFLTask task=%s parties=%d", request.task_id, len(request.node_plan))
        self._runner.submit(request.task_id, request.spec_yaml, request.node_plan)
        stream_url = f"ws://{config.WS_ADVERTISE_HOST}:{config.WS_PORT}/logs/{request.task_id}"
        return pb.SubmitFLTaskResponse(
            task_id=request.task_id,
            ack_status="ACCEPTED",
            task_stream_url=stream_url,
            message="dispatched",
        )

    async def GetTaskResult(self, request: pb.TaskRef, context) -> pb.TaskResult:
        result = self._bus.result(request.task_id)
        if result is None:
            state = "FAILED" if self._bus.is_done(request.task_id) else "RUNNING"
            return pb.TaskResult(task_id=request.task_id, state=state)
        if result.get("state") == "FAILED":
            return pb.TaskResult(task_id=request.task_id, state="FAILED")
        att = result.get("attestation", {})
        return pb.TaskResult(
            task_id=request.task_id,
            state="COMPLETED",
            rounds_completed=int(result.get("roundsCompleted", 0)),
            metrics_json=json.dumps(result.get("metrics", {})),
            lora_delta_hash=result.get("loraDeltaHash", ""),
            encrypted_delta_ref=result.get("encryptedDeltaRef", ""),
            attestation_report_hash=att.get("reportHash", ""),
            privacy_summary_json=json.dumps(result.get("privacySummary", {})),
            model_card_json=json.dumps(result.get("modelCard", {})),
            runtime=att.get("runtime", ""),
        )

    async def ReportNodeStatus(self, request: pb.TaskRef, context):
        async for event in self._bus.subscribe(request.task_id):
            phase = event.get("phase", "")
            if phase not in ("baseline", "training", "round_complete", "compensation", "done", "failed"):
                continue
            yield pb.NodeStatus(
                task_id=request.task_id,
                participant_id=event.get("participant_id", ""),
                hardware_attestation=event.get("attestation", ""),
                current_epoch=int(event.get("epoch", event.get("round", 0)) or 0),
                loss_metric=float(event.get("loss", event.get("global_loss", 0.0)) or 0.0),
                estimated_time_seconds=float(event.get("elapsed_seconds", 0.0) or 0.0),
                phase=phase,
            )


def build_server(bus: TaskLogBus, loop: asyncio.AbstractEventLoop):
    import grpc

    runner = TaskRunner(bus, loop)
    server = grpc.aio.server()
    pb_grpc.add_SecretFlowAgentServicer_to_server(SecretFlowAgentServicer(runner, bus), server)
    server.add_insecure_port(f"{config.GRPC_HOST}:{config.GRPC_PORT}")
    return server
