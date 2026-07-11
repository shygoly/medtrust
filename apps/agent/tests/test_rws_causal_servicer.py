"""Tests for L3 causal gRPC echo servicer (task 5.1)."""

from __future__ import annotations

import asyncio
import json

from medtrust_agent.rws_causal_servicer import RwsCausalAgentServicer, _echo_result


def test_echo_psm_returns_ate():
    out = _echo_result("psm", json.dumps([{"treated": True}, {"treated": False}]))
    assert out["analysisType"] == "causal-psm"
    assert out["effectEstimate"]["measure"] == "ate"
    assert out["cohortSize"] == 2


def test_echo_cox_returns_hr_and_km():
    out = _echo_result("cox", "[]")
    assert out["analysisType"] == "causal-survival"
    assert out["effectEstimate"]["measure"] == "log_hr"
    assert out["kmCurve"]["bins"]


def test_servicer_run_local_causal():
    async def _run():
        svc = RwsCausalAgentServicer()
        from medtrust_agent.generated import rws_causal_pb2 as pb

        return await svc.RunLocalCausal(
            pb.RunLocalCausalRequest(task_id="t1", method="psm", spec_json="{}", cohort_json="[]"),
            None,
        )

    resp = asyncio.run(_run())
    assert resp.ack_status == "OK"
    body = json.loads(resp.result_json)
    assert body["effectEstimate"]["measure"] == "ate"
