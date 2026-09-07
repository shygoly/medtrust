"""Tests for L3 causal gRPC servicer — runtime only, fail-closed."""

from __future__ import annotations

import asyncio
import json

from medtrust_agent.rws_causal_servicer import RwsCausalAgentServicer


def _cohort(n: int = 80) -> str:
    rows = []
    for i in range(n):
        treated = i % 2 == 0
        rows.append(
            {
                "ageBand": "50-59",
                "sex": "M" if i % 3 else "F",
                "treated": treated,
                "eventOccurred": (i % 5 == 0),
                "followUpDays": 200 + (i % 400),
            }
        )
    return json.dumps(rows)


def test_servicer_run_local_causal_runtime():
    async def _run():
        svc = RwsCausalAgentServicer()
        from medtrust_agent.generated import rws_causal_pb2 as pb

        return await svc.RunLocalCausal(
            pb.RunLocalCausalRequest(
                task_id="t1",
                method="psm",
                spec_json="{}",
                cohort_json=_cohort(),
            ),
            None,
        )

    resp = asyncio.run(_run())
    assert resp.ack_status == "OK"
    assert resp.message == "runtime"
    body = json.loads(resp.result_json)
    assert body["effectEstimate"]["measure"] == "ate"
    assert body["cohortSize"] == 80


def test_servicer_empty_cohort_fail_closed():
    async def _run():
        svc = RwsCausalAgentServicer()
        from medtrust_agent.generated import rws_causal_pb2 as pb

        return await svc.RunLocalCausal(
            pb.RunLocalCausalRequest(
                task_id="t-empty",
                method="psm",
                spec_json="{}",
                cohort_json="[]",
            ),
            None,
        )

    resp = asyncio.run(_run())
    assert resp.ack_status == "FAILED"
    assert resp.result_json == ""


def test_servicer_missing_task_id_rejected():
    async def _run():
        svc = RwsCausalAgentServicer()
        from medtrust_agent.generated import rws_causal_pb2 as pb

        return await svc.RunLocalCausal(
            pb.RunLocalCausalRequest(task_id="", method="cox", spec_json="{}", cohort_json=_cohort()),
            None,
        )

    resp = asyncio.run(_run())
    assert resp.ack_status == "FAILED"
    assert "required" in resp.message
