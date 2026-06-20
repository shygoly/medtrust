"""Agent runtime configuration (env-overridable).

Ports follow the repo's 5022–5029 convention (connector owns 5022).
"""

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


GRPC_HOST = os.environ.get("AGENT_GRPC_HOST", "0.0.0.0")
GRPC_PORT = _int("AGENT_GRPC_PORT", 5024)

WS_HOST = os.environ.get("AGENT_WS_HOST", "0.0.0.0")
WS_PORT = _int("AGENT_WS_PORT", 5023)

# Advertised back to the control plane in SubmitFLTaskResponse.task_stream_url.
WS_ADVERTISE_HOST = os.environ.get("AGENT_WS_ADVERTISE_HOST", "127.0.0.1")

PARTICIPANT_ID = os.environ.get("AGENT_PARTICIPANT_ID", "local-agent")
