"""院内脱敏的本地审计链（append-only，SM3 前向链接）。

设计要点（openspec/changes/connector-agent-deidentification §8）：

* 每条记录**只含元数据与摘要**：`job_id / contract_id / spec_sm3 / row_count /
  in_digest / out_digest / started_at / ended_at / ack`，**绝不含数据行、样本或字段值**；
* `prev` 指向上一条记录的摘要，重启不丢（默认落 `data/deid-audit.jsonl`，可用
  `AGENT_DEID_AUDIT_PATH` 改；`:memory:` 表示只在本进程，测试用）；
* 回给连接器的 `agent_receipt` = 本条记录的摘要 —— 连接器把它与自己的摘要一起落审计，
  事后可对账（谁在什么时候用什么规格脱敏了多少行）。

本模块只做"记账"，不参与脱敏决策；记账失败一律**抛出**（宁可不脱敏，也不留无痕执行）。
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_AUDIT_PATH = "data/deid-audit.jsonl"
MEMORY_SENTINEL = ":memory:"


def _sm3_hex(payload: bytes) -> str:
    return hashlib.new("sm3", payload).hexdigest()


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class DeidAuditEntry:
    job_id: str
    contract_id: str
    spec_sm3: str
    row_count: int
    input_digest: str
    output_digest: str
    ack: str
    started_at: str
    ended_at: str
    prev: str = ""
    warnings: List[str] = field(default_factory=list)
    message: str = ""

    def body(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "contract_id": self.contract_id,
            "spec_sm3": self.spec_sm3,
            "row_count": self.row_count,
            "input_digest": self.input_digest,
            "output_digest": self.output_digest,
            "ack": self.ack,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "prev": self.prev,
            "warnings": list(self.warnings),
            "message": self.message,
        }

    def digest(self) -> str:
        return _sm3_hex(_canonical(self.body()))


class DeidAuditChain:
    """单进程内的 append-only 审计链（每次写入 fsync，崩溃后可续链）。"""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path or os.environ.get("AGENT_DEID_AUDIT_PATH", DEFAULT_AUDIT_PATH)
        self._lock = threading.Lock()
        self._memory: List[Dict[str, Any]] = []
        self._head = ""
        if self.path != MEMORY_SENTINEL:
            self._load_head()

    # ---- 读取 ----
    def head(self) -> str:
        return self._head

    def entries(self) -> List[Dict[str, Any]]:
        """读出整条链，并为每条补上 `digest`（文件里不重复存摘要，读时重算）。"""
        if self.path == MEMORY_SENTINEL:
            return list(self._memory)
        if not os.path.exists(self.path):
            return []
        out: List[Dict[str, Any]] = []
        with open(self.path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                out.append({**record, "digest": _sm3_hex(_canonical(record))})
        return out

    def _load_head(self) -> None:
        if not os.path.exists(self.path):
            self._head = ""
            return
        last = ""
        with open(self.path, "r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    last = line.strip()
        if last:
            self._head = _sm3_hex(_canonical(json.loads(last)))

    # ---- 写入 ----
    def append(self, entry: DeidAuditEntry) -> str:
        """写入一条记录并返回它的摘要（= 回给连接器的 agent_receipt）。"""
        with self._lock:
            linked = DeidAuditEntry(
                job_id=entry.job_id,
                contract_id=entry.contract_id,
                spec_sm3=entry.spec_sm3,
                row_count=entry.row_count,
                input_digest=entry.input_digest,
                output_digest=entry.output_digest,
                ack=entry.ack,
                started_at=entry.started_at,
                ended_at=entry.ended_at,
                prev=self._head,
                warnings=list(entry.warnings),
                message=entry.message,
            )
            record = linked.body()
            digest = linked.digest()
            if self.path == MEMORY_SENTINEL:
                self._memory.append({**record, "digest": digest})
            else:
                directory = os.path.dirname(self.path)
                if directory:
                    os.makedirs(directory, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
                    handle.flush()
                    os.fsync(handle.fileno())
            self._head = digest
            return digest


def verify_chain(entries: List[Dict[str, Any]]) -> bool:
    """校验整条链：`prev` 必须等于上一条摘要，否则链被改过。"""
    prev = ""
    for record in entries:
        body = {key: record[key] for key in record if key != "digest"}
        if body.get("prev", "") != prev:
            return False
        prev = _sm3_hex(_canonical(body))
    return True


__all__ = [
    "DEFAULT_AUDIT_PATH",
    "MEMORY_SENTINEL",
    "DeidAuditChain",
    "DeidAuditEntry",
    "verify_chain",
    "_now",
]
