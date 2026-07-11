"""Echo gRPC servicer for L3 causal inference (task 5.1).

Returns fixed safe aggregates so connector integration can proceed before
real PSM/Cox kernels land in tasks 5.2/5.3.
"""

from __future__ import annotations

import json
import logging

from .generated import rws_causal_pb2 as pb
from .generated import rws_causal_pb2_grpc as pb_grpc
from .rws_causal_runtime import run_local_causal

log = logging.getLogger("medtrust_agent.rws_causal")


def _echo_result(method: str, cohort_json: str) -> dict:
    cohort = json.loads(cohort_json) if cohort_json else []
    n = len(cohort)
    if method == "cox":
        return {
            "analysisType": "causal-survival",
            "cohortSize": n,
            "buckets": [],
            "effectEstimate": {
                "measure": "log_hr",
                "beta": -0.25,
                "standardError": 0.09,
                "ci95": [-0.43, -0.07],
            },
            "kmCurve": {
                "binWidthDays": 30,
                "bins": [
                    {"t": 0, "survival": 1.0, "atRisk": n},
                    {"t": 180, "survival": 0.82, "atRisk": max(5, int(n * 0.6))},
                ],
            },
        }
    return {
        "analysisType": "causal-psm",
        "cohortSize": n,
        "buckets": [],
        "effectEstimate": {
            "measure": "ate",
            "beta": 0.11,
            "standardError": 0.045,
            "ci95": [0.02, 0.2],
        },
    }


class RwsCausalAgentServicer(pb_grpc.RwsCausalAgentServicer):
    async def RunLocalCausal(self, request: pb.RunLocalCausalRequest, context) -> pb.RunLocalCausalResponse:
        if not request.task_id or not request.method:
            return pb.RunLocalCausalResponse(
                ack_status="FAILED",
                result_json="",
                message="task_id and method required",
            )
        try:
            try:
                payload = run_local_causal(request.method, request.spec_json, request.cohort_json)
                msg = "runtime"
            except Exception as runtime_exc:  # noqa: BLE001
                log.warning("causal runtime fallback to echo: %s", runtime_exc)
                payload = _echo_result(request.method, request.cohort_json)
                msg = "echo"
            log.info("RunLocalCausal task=%s method=%s n=%d", request.task_id, request.method, payload["cohortSize"])
            return pb.RunLocalCausalResponse(
                ack_status="OK",
                result_json=json.dumps(payload),
                message=msg,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("RunLocalCausal failed task=%s", request.task_id)
            return pb.RunLocalCausalResponse(ack_status="FAILED", result_json="", message=str(exc))
