"""L3 causal gRPC servicer — real PSM/IPTW/Cox only; no Echo fallback."""

from __future__ import annotations

import json
import logging

from .generated import rws_causal_pb2 as pb
from .generated import rws_causal_pb2_grpc as pb_grpc
from .rws_causal_runtime import run_local_causal

log = logging.getLogger("medtrust_agent.rws_causal")


class RwsCausalAgentServicer(pb_grpc.RwsCausalAgentServicer):
    async def RunLocalCausal(self, request: pb.RunLocalCausalRequest, context) -> pb.RunLocalCausalResponse:
        if not request.task_id or not request.method:
            return pb.RunLocalCausalResponse(
                ack_status="FAILED",
                result_json="",
                message="task_id and method required",
            )
        try:
            payload = run_local_causal(request.method, request.spec_json, request.cohort_json)
            log.info(
                "RunLocalCausal task=%s method=%s n=%d",
                request.task_id,
                request.method,
                payload["cohortSize"],
            )
            return pb.RunLocalCausalResponse(
                ack_status="OK",
                result_json=json.dumps(payload),
                message="runtime",
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("RunLocalCausal failed task=%s", request.task_id)
            return pb.RunLocalCausalResponse(ack_status="FAILED", result_json="", message=str(exc))
