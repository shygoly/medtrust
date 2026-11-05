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

import grpc

from . import config
from .generated import secretflow_pb2 as pb
from .generated import secretflow_pb2_grpc as pb_grpc
from .generated import deidentify_pb2_grpc as deidentify_pb_grpc
from .generated import rws_causal_pb2_grpc as causal_pb_grpc
from .deidentify_servicer import DeidentificationAgentServicer
from .rws_causal_servicer import RwsCausalAgentServicer
from .log_bus import TaskLogBus
from .runtime import run_local_round, run_task

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

    async def run_local_round(
        self,
        task_id: str,
        spec_yaml: str,
        round_index: int,
        global_adapter_json: str,
        node_plan,
        training_slice_json: str,
    ) -> dict:
        node_epochs = self.node_local_epochs(node_plan)
        stream_id = task_id.split("::", 1)[0]
        bus = self._bus

        def emit(event: dict) -> None:
            bus.publish(stream_id, event)

        return await self._loop.run_in_executor(
            self._executor,
            lambda: run_local_round(
                task_id,
                spec_yaml,
                round_index=round_index,
                training_slice_json=training_slice_json,
                global_adapter_json=global_adapter_json,
                emit=emit,
                node_local_epochs=node_epochs or None,
            ),
        )

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


    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


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

    async def RunLocalRound(self, request: pb.RunLocalRoundRequest, context) -> pb.RunLocalRoundResponse:
        if not request.task_id or not request.spec_yaml:
            return pb.RunLocalRoundResponse(
                task_id=request.task_id,
                ack_status="FAILED",
                message="task_id and spec_yaml required",
            )
        try:
            result = await self._runner.run_local_round(
                request.task_id,
                request.spec_yaml,
                int(request.round_index),
                request.global_adapter_json,
                request.node_plan,
                request.training_slice_json,
            )
            return pb.RunLocalRoundResponse(
                task_id=request.task_id,
                participant_id=result.get("participantId", ""),
                ack_status="OK",
                adapter_delta_json=result.get("adapterDeltaJson", ""),
                sample_count=int(result.get("sampleCount", 0)),
                local_loss=float(result.get("localLoss", 0.0)),
                message="ok",
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("RunLocalRound failed task=%s", request.task_id)
            return pb.RunLocalRoundResponse(
                task_id=request.task_id,
                ack_status="FAILED",
                message=str(exc),
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


AGENT_TOKEN_METADATA_KEY = "x-agent-token"
"""共享凭证的元数据键(连接器侧同常量:apps/connector/src/domain/fl-round/agent-auth.ts)。"""


class SharedTokenInterceptor(grpc.aio.ServerInterceptor):
    """院内调用鉴权(outbound-longpoll-agent-auth D6)。

    每次调用必须带元数据 ``x-agent-token`` 且等于 ``AGENT_SHARED_TOKEN``；
    未配置共享凭证时一律拒绝(fail-closed)——agent 只在院内可达,但仍不信任网络。
    """

    def __init__(self, token: str):
        self._token = (token or "").strip()

    async def intercept_service(self, continuation, handler_call_details):
        metadata = dict(handler_call_details.invocation_metadata or ())
        presented = metadata.get(AGENT_TOKEN_METADATA_KEY)
        if not self._token or presented != self._token:
            reason = (
                "AGENT_SHARED_TOKEN 未配置:拒绝一切调用"
                if not self._token
                else "共享凭证缺失或不正确"
            )
            log.warning(
                "拒绝未认证调用 method=%s reason=%s",
                handler_call_details.method,
                reason,
            )
            return self._deny(handler_call_details.method, reason)
        return await continuation(handler_call_details)

    def _deny(self, method: str, reason: str):
        async def abort_unary(request, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, reason)

        async def abort_stream(request, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, reason)
            yield None  # pragma: no cover - abort 后不会继续

        if method.endswith("ReportNodeStatus"):
            return grpc.unary_stream_rpc_method_handler(abort_stream)
        return grpc.unary_unary_rpc_method_handler(abort_unary)


def build_server(bus: TaskLogBus, loop: asyncio.AbstractEventLoop):
    runner = TaskRunner(bus, loop)
    server = grpc.aio.server(
        interceptors=[SharedTokenInterceptor(config.SHARED_TOKEN)]
    )
    pb_grpc.add_SecretFlowAgentServicer_to_server(SecretFlowAgentServicer(runner, bus), server)
    causal_pb_grpc.add_RwsCausalAgentServicer_to_server(RwsCausalAgentServicer(), server)
    deidentify_pb_grpc.add_DeidentificationAgentServicer_to_server(
        DeidentificationAgentServicer(), server
    )
    server.add_insecure_port(f"{config.GRPC_HOST}:{config.GRPC_PORT}")

    async def shutdown() -> None:
        runner.shutdown()

    return server, shutdown
