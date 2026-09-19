"""Local Data Agent entrypoint: runs the gRPC dispatch server + WS log server.

    python -m medtrust_agent.main
"""

from __future__ import annotations

import asyncio
import logging
import signal

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

    grpc_server, shutdown_runner = build_server(bus, loop)
    await grpc_server.start()
    ws_server = None
    if config.WS_ENABLED:
        ws_server = await start_ws_server(bus, config.WS_HOST, config.WS_PORT)
    else:
        log.info("WS 日志通道已关闭(AGENT_WS_ENABLED 非 true):仅保留院内 gRPC")

    stop = asyncio.Event()

    def _request_stop() -> None:
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _request_stop)

    log.info(
        "Local Data Agent up — runtime=%s gRPC=%s:%d ws=%s token=%s",
        detect_runtime(),
        config.GRPC_HOST,
        config.GRPC_PORT,
        f"{config.WS_HOST}:{config.WS_PORT}" if config.WS_ENABLED else "disabled",
        "on" if config.SHARED_TOKEN else "MISSING(fail-closed)",
    )
    try:
        await stop.wait()
    finally:
        if ws_server is not None:
            ws_server.close()
            await ws_server.wait_closed()
        await grpc_server.stop(grace=5)
        await shutdown_runner()
        log.info("agent shut down cleanly")


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
