"""院内计算后端鉴权（outbound-longpoll-agent-auth D6 / 任务 6.4）。

无凭证、错误凭证 → UNAUTHENTICATED；正确凭证 → 正常返回（未知任务返回 RUNNING/FAILED
而不是认证错误）。共享凭证未配置时一律拒绝（fail-closed）。
"""

from __future__ import annotations

import asyncio

import grpc
import pytest

from medtrust_agent import config
from medtrust_agent.generated import secretflow_pb2 as pb
from medtrust_agent.generated import secretflow_pb2_grpc as pbg
from medtrust_agent.grpc_server import build_server
from medtrust_agent.log_bus import TaskLogBus


async def _call(stub, metadata=None):
    return await stub.GetTaskResult(pb.TaskRef(task_id="missing"), metadata=metadata)


async def _boot(port: int, token: str):
    config.GRPC_PORT = port
    config.SHARED_TOKEN = token
    loop = asyncio.get_running_loop()
    server, shutdown = build_server(TaskLogBus(loop), loop)
    await server.start()
    return server, shutdown


def test_grpc_requires_shared_token():
    async def _run():
        server, shutdown = await _boot(5734, "secret-token")
        try:
            async with grpc.aio.insecure_channel("127.0.0.1:5734") as ch:
                stub = pbg.SecretFlowAgentStub(ch)

                with pytest.raises(grpc.aio.AioRpcError) as missing:
                    await _call(stub)
                assert missing.value.code() == grpc.StatusCode.UNAUTHENTICATED

                with pytest.raises(grpc.aio.AioRpcError) as wrong:
                    await _call(stub, (("x-agent-token", "nope"),))
                assert wrong.value.code() == grpc.StatusCode.UNAUTHENTICATED

                ok = await _call(stub, (("x-agent-token", "secret-token"),))
                assert ok.state in ("RUNNING", "FAILED", "COMPLETED")
        finally:
            await server.stop(0)
            await shutdown()

    asyncio.run(_run())


def test_grpc_fails_closed_without_configured_token():
    async def _run():
        server, shutdown = await _boot(5735, "")
        try:
            async with grpc.aio.insecure_channel("127.0.0.1:5735") as ch:
                stub = pbg.SecretFlowAgentStub(ch)
                with pytest.raises(grpc.aio.AioRpcError) as err:
                    await _call(stub, (("x-agent-token", "anything"),))
                assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
        finally:
            await server.stop(0)
            await shutdown()

    asyncio.run(_run())
