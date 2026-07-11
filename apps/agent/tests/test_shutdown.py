"""Graceful shutdown must stop gRPC before the event loop closes (Fly SIGINT deploys)."""

import asyncio

from medtrust_agent import config
from medtrust_agent.grpc_server import build_server
from medtrust_agent.log_bus import TaskLogBus
from medtrust_agent.ws_server import start_ws_server


async def _boot_and_shutdown():
    config.GRPC_PORT = 5734
    config.WS_PORT = 5733
    loop = asyncio.get_running_loop()
    bus = TaskLogBus(loop)
    server, shutdown_runner = build_server(bus, loop)
    await server.start()
    ws = await start_ws_server(bus, "127.0.0.1", config.WS_PORT)
    try:
        pass
    finally:
        ws.close()
        await ws.wait_closed()
        await server.stop(0)
        await shutdown_runner()


def test_graceful_shutdown():
    asyncio.run(_boot_and_shutdown())
