"""Agent runtime configuration (env-overridable).

Ports follow the repo's 5022–5029 convention (connector owns 5022).
"""

import os
import re
from typing import List, Mapping


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

# 院内调用鉴权(outbound-longpoll-agent-auth D6):连接器调用本院 agent 必须带
# 元数据 x-agent-token,值等于这里的共享凭证。未配置 = 拒绝一切调用(fail-closed)。
SHARED_TOKEN = os.environ.get("AGENT_SHARED_TOKEN", "")

# 训练日志 WS 通道:缺省关闭(控制面不再连入 agent;日志改由连接器回传轮次指标)。
WS_ENABLED = os.environ.get("AGENT_WS_ENABLED", "false").strip().lower() == "true"

# When set, this agent trains only the named provider party (multi-connector FedAvg).
_PARTY_ALIASES = {
    "hospital-a-demohospa": "hospital-demohospa",
    "hospital-b-demohospb": "hospital-demohospb",
}


def resolved_local_party() -> str | None:
    raw = (os.environ.get("AGENT_LOCAL_PARTY") or PARTICIPANT_ID or "").strip()
    if not raw or raw == "local-agent":
        return None
    return _PARTY_ALIASES.get(raw, raw)


# omop-data-source-access task 4.4（D-CN-6） —— 院内数据只经连接器读取、投影后提供，
# agent 不持有任何数据源凭据。发现有人给 agent 配了库就拒绝启动（fail-closed），
# 而不是静默忽略：忽略会让运维以为「给 agent 接了库」而实际什么都没发生，
# 哪天有人往依赖里加了驱动，这些变量就真的连上了（libpq 的 PG* 会被驱动自动读取）。
_DATASOURCE_ENV = re.compile(
    r"^(?:"
    r"AGENT_(?:[A-Z0-9]+_)*(?:DB|DATABASE|CDM|SQL|JDBC|ODBC|DSN)(?:_[A-Z0-9]+)*"
    r"|CONNECTOR_CDM_SOURCES(?:_FILE)?"
    r"|PG(?:HOST|HOSTADDR|PORT|USER|PASSWORD|PASSFILE|DATABASE|SERVICE|SERVICEFILE)"
    r")$"
)


def datasource_credentials_in(env: Mapping[str, str]) -> List[str]:
    """环境里为 agent 配置的数据源连接 / 凭据变量（只看名字，不读值）。"""
    return sorted(k for k, v in env.items() if _DATASOURCE_ENV.match(k) and str(v).strip())


def assert_no_datasource_credentials(env: Mapping[str, str] = os.environ) -> None:
    found = datasource_credentials_in(env)
    if found:
        raise RuntimeError(
            "agent 不得持有院内数据源凭据（D-CN-6）：发现 "
            + ", ".join(found)
            + "。院内数据只经连接器读取、投影后提供；数据源只在连接器侧配置"
        )
