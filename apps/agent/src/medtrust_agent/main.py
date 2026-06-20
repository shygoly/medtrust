"""Local Data Agent entrypoint: runs the gRPC dispatch server + WS log server.

    python -m medtrust_agent.main
"""

from __future__ import annotations

import asyncio
import logging

from . import config
from .grpc_server import build_server
from .log_bus import TaskLogBus
from .runtime import detect_runtime
from .ws_server import start_ws_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("medtrust_agent")


async def serve() -> None:
    loop = asyncio.get_running_loop()
    bus = TaskLogBus(loop)

    grpc_server = build_server(bus, loop)
    await grpc_server.start()
    ws_server = await start_ws_server(bus, config.WS_HOST, config.WS_PORT)

    log.info(
        "Local Data Agent up — runtime=%s gRPC=%s:%d ws=%s:%d",
        detect_runtime(), config.GRPC_HOST, config.GRPC_PORT, config.WS_HOST, config.WS_PORT,
    )
    try:
        await grpc_server.wait_for_termination()
    finally:
        ws_server.close()
        await ws_server.wait_closed()


def main() -> None:
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        log.info("agent shutting down")


if __name__ == "__main__":
    main()
