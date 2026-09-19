"""End-to-end agent server test: real gRPC dispatch + WebSocket log stream.

Boots the agent's gRPC + WS servers on test ports, submits a task over gRPC,
streams the live training log over WebSocket, and fetches the safe result.
"""

import asyncio
import json

import grpc
import pytest
import websockets
import yaml

from medtrust_agent import config
from medtrust_agent.generated import secretflow_pb2 as pb
from medtrust_agent.generated import secretflow_pb2_grpc as pbg
from medtrust_agent.grpc_server import build_server
from medtrust_agent.log_bus import TaskLogBus
from medtrust_agent.scenario import default_secretflow_spec
from medtrust_agent.ws_server import start_ws_server

SPEC_YAML = yaml.dump({**default_secretflow_spec(), "epochs": 3}, allow_unicode=True)


async def _scenario():
    config.GRPC_PORT = 5724
    config.WS_PORT = 5723
    config.WS_ADVERTISE_HOST = "127.0.0.1"
    # 院内调用鉴权(outbound-longpoll-agent-auth D6):连接器必须带共享凭证。
    config.SHARED_TOKEN = "test-shared-token"
    _auth = (("x-agent-token", config.SHARED_TOKEN),)

    loop = asyncio.get_running_loop()
    bus = TaskLogBus(loop)
    server, shutdown_runner = build_server(bus, loop)
    await server.start()
    ws = await start_ws_server(bus, "127.0.0.1", config.WS_PORT)

    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{config.GRPC_PORT}") as ch:
            stub = pbg.SecretFlowAgentStub(ch)
            resp = await stub.SubmitFLTask(
                pb.SubmitFLTaskRequest(
                    task_id="t-e2e",
                    spec_yaml=SPEC_YAML,
                    node_plan=[
                        pb.NodePlan(participant_id="hospital-huashan", tier="teeu_full", device="H100"),
                        pb.NodePlan(participant_id="hospital-ruijin", tier="pyu_only", device="CPU"),
                        pb.NodePlan(participant_id="hospital-zhongshan", tier="pyu_only", device="CPU"),
                    ],
                ),
                metadata=_auth,
            )
            assert resp.ack_status == "ACCEPTED"
            assert resp.task_stream_url.endswith("/logs/t-e2e")

            events = []
            async with websockets.connect(resp.task_stream_url) as wsc:
                async for raw in wsc:
                    events.append(json.loads(raw))

            phases = {e["phase"] for e in events}
            assert {"baseline", "training", "round_complete", "done", "result"} <= phases

            result_frame = next(e for e in events if e["phase"] == "result")["result"]
            assert result_frame["loraDeltaHash"].startswith("LORA:")
            assert result_frame["metrics"]["lossReduction"] > 0.05

            res = await stub.GetTaskResult(
                pb.TaskRef(task_id="t-e2e"), metadata=_auth
            )
            assert res.state == "COMPLETED"
            assert res.lora_delta_hash.startswith("LORA:")
            assert res.runtime in ("torch", "ray_torch", "secretflow_teeu")

            # 无凭证调用被拒(outbound-longpoll-agent-auth D6)
            with pytest.raises(grpc.aio.AioRpcError) as err:
                await stub.GetTaskResult(pb.TaskRef(task_id="t-e2e"))
            assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED

            # 错误凭证同样被拒
            with pytest.raises(grpc.aio.AioRpcError) as err:
                await stub.GetTaskResult(
                    pb.TaskRef(task_id="t-e2e"),
                    metadata=(("x-agent-token", "wrong-token"),),
                )
            assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
    finally:
        ws.close()
        await ws.wait_closed()
        await server.stop(0)
        await shutdown_runner()


def test_dispatch_stream_and_result():
    asyncio.run(_scenario())
