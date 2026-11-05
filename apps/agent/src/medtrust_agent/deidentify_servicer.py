"""院内脱敏 gRPC 服务。

数据边界（openspec/changes/connector-agent-deidentification design §2）：

* 数据源凭据只在连接器（`config.assert_no_datasource_credentials` 启动硬门）；
  本服务**不打开任何数据库连接**，也不接受 SQL、路径或任意 Python 代码；
* 连接器按 D-CN-6 做完列裁剪/行过滤，把受限投影块流进来；脱敏块流回去，
  平台永远不在流路径上；
* 规格**再校验**（不信任连接器转发）：schema、算子集、参数上界、强制字段，
  以及 `spec_json` 与 `spec_sm3` 的自洽；
* 每次执行写本地审计链（`deid_audit.py`），`agent_receipt` = 该条记录的摘要；
  回执与错误消息里**不出现任何数据行、样本或字段值**；
* 变换后做**残留检测**（手机号 / 身份证 / 邮箱 / 地址 / 词表姓名）：命中即 FAILED，
  且这一行不发出 —— 带残留的行既不进下游也不进本地库。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, AsyncIterable, Dict, Mapping

from .deid_audit import DeidAuditChain, DeidAuditEntry, _now
from .deid_dictionary import load_dictionary
from .deid_spec import DeidSpec, DeidSpecError, DeidTransform, parse_deid_spec
from .generated import deidentify_pb2 as pb
from .generated import deidentify_pb2_grpc as pb_grpc


class DeidExecutionError(ValueError):
    """执行期失败（不是规格非法）。消息里只出现字段名与摘要，不出现字段值。"""


def _audit_chain() -> DeidAuditChain:
    """每次调用重建实例：链头从文件尾巴恢复，进程内不留跨任务的隐式状态。"""
    return DeidAuditChain()


class DeidentificationAgentServicer(pb_grpc.DeidentificationAgentServicer):
    """Streaming connector-projection -> deidentified-output implementation."""

    async def RunDeidentification(self, request_iterator, context):  # noqa: N802
        started = None
        started_at = _now()
        input_hash = hashlib.new("sm3")
        output_hash = hashlib.new("sm3")
        row_count = 0
        output_count = 0
        spec: DeidSpec | None = None
        warnings: list[str] = []
        try:
            async for chunk in request_iterator:
                kind = chunk.WhichOneof("payload")
                if kind == "start":
                    if started is not None:
                        raise DeidExecutionError("duplicate start")
                    started = chunk.start
                    spec = self._load_spec(started)
                    salts = _load_salts()
                    _ensure_salts(spec, salts, started.salt_ref)
                    words = _load_dictionary_words(spec, started)
                    continue
                if started is None or spec is None:
                    raise DeidExecutionError("start must be the first message")
                if kind == "projected_jsonl":
                    for raw_line in chunk.projected_jsonl.splitlines():
                        if not raw_line.strip():
                            continue
                        row_count += 1
                        if started.row_limit > 0 and row_count > started.row_limit:
                            raise DeidExecutionError("row_limit exceeded")
                        input_hash.update(raw_line.strip() + b"\n")
                        record = json.loads(raw_line)
                        if not isinstance(record, dict):
                            raise DeidExecutionError("projected row must be an object")
                        transformed = apply_deid_record(
                            record, spec, _load_salts(), started.salt_ref, words
                        )
                        # 残留检测：变换后再扫一遍直接标识。命中即 FAILED，且**不发出**
                        # 这一行 —— 带残留的行不进下游，也不进本地库（Phase 2 第 2 条）。
                        assert_no_residual_identifiers(transformed, words)
                        encoded = _canonical_json(transformed) + b"\n"
                        output_hash.update(encoded)
                        output_count += 1
                        yield pb.DeidOutput(deidentified_jsonl=encoded)
                    continue
                if kind == "end":
                    break
                raise DeidExecutionError("unknown stream message")

            if started is None or spec is None:
                raise DeidExecutionError("missing start")
            input_digest = input_hash.hexdigest()
            output_digest = output_hash.hexdigest()
            agent_receipt = _record(
                started,
                ack="OK",
                row_count=output_count,
                input_digest=input_digest,
                output_digest=output_digest,
                started_at=started_at,
                warnings=warnings,
                message="ok",
            )
            yield pb.DeidOutput(
                receipt=pb.DeidReceipt(
                    ack_status="OK",
                    row_count=output_count,
                    input_digest=input_digest,
                    output_digest=output_digest,
                    spec_sm3=started.spec_sm3,
                    agent_receipt=agent_receipt,
                    warnings=warnings,
                    message="ok",
                )
            )
        except (DeidSpecError, DeidExecutionError, json.JSONDecodeError) as exc:
            # 失败也留痕：不留痕的拒跑等于没拒过。
            message = str(exc)
            ack = "DENIED" if isinstance(exc, DeidSpecError) else "FAILED"
            agent_receipt = ""
            if started is not None:
                agent_receipt = _record(
                    started,
                    ack=ack,
                    row_count=output_count,
                    input_digest=input_hash.hexdigest(),
                    output_digest=output_hash.hexdigest(),
                    started_at=started_at,
                    warnings=warnings,
                    message=message,
                )
            yield pb.DeidOutput(
                receipt=pb.DeidReceipt(
                    ack_status=ack,
                    spec_sm3=started.spec_sm3 if started else "",
                    agent_receipt=agent_receipt,
                    message=message,
                )
            )

    @staticmethod
    def _load_spec(start) -> DeidSpec:
        if not start.spec_json or not start.spec_sm3:
            raise DeidSpecError("spec_json and spec_sm3 are required")
        # 规格自洽：摘要必须由 spec_json 重算得到（不采信转发方声称的值，
        # 否则"连接器被改过"这件事在 agent 侧就看不出来了）。
        digest = _sm3(start.spec_json.encode())
        claimed = start.spec_sm3.strip().lower()
        claimed = claimed[len("sm3:"):] if claimed.startswith("sm3:") else claimed
        if claimed != digest:
            raise DeidSpecError("spec_sm3 does not match spec_json digest")
        raw = json.loads(start.spec_json)
        return parse_deid_spec(raw)


def _record(
    started,
    *,
    ack: str,
    row_count: int,
    input_digest: str,
    output_digest: str,
    started_at: str,
    warnings: list[str],
    message: str,
) -> str:
    return _audit_chain().append(
        DeidAuditEntry(
            job_id=started.job_id,
            contract_id=started.contract_id,
            spec_sm3=started.spec_sm3,
            row_count=row_count,
            input_digest=input_digest,
            output_digest=output_digest,
            ack=ack,
            started_at=started_at,
            ended_at=_now(),
            warnings=list(warnings),
            message=message[:500],
        )
    )


# 直接标识的残留形态。与 `text_rules` 同源但用途相反：这里不替换，只**判定残留**。
_RESIDUAL_PATTERNS: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    ("phone", re.compile(r"(?<!\d)1\d{10}(?!\d)")),
    ("id_card", re.compile(r"(?<![0-9Xx])[0-9]{17}[0-9Xx](?![0-9])")),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("address", re.compile(r"[\u4e00-\u9fa5]{2,}(?:路|街|号院|号楼|单元|室)\d*")),
)


def _spec_dictionary_refs(spec: DeidSpec) -> set[str]:
    return {
        str(transform.params["dictionaryRef"]).strip()
        for transform in spec.transforms
        if transform.op == "text_rules" and transform.params.get("dictionaryRef")
    }


def _load_dictionary_words(spec: DeidSpec, started) -> list[str]:
    """按规格的 `dictionaryRef` 读本院词表并核对摘要；对不上即 DENIED。

    规格里引用了词表但 `start` 没带 ref/摘要 → 拒（不接受"猜一份词表"）。
    本版只支持一个词表引用（多个 ref 需要多份文件，留给后续版本）。
    """
    refs = _spec_dictionary_refs(spec)
    if not refs:
        if started.dictionary_ref:
            raise DeidSpecError("dictionary_ref was supplied but the spec references no dictionary")
        return []
    if len(refs) > 1:
        raise DeidSpecError("only a single dictionaryRef is supported in this version")
    ref = next(iter(refs))
    if not started.dictionary_ref or not started.dictionary_sm3:
        raise DeidSpecError("spec references a dictionary but dictionary_ref/dictionary_sm3 are missing")
    if started.dictionary_ref.strip() != ref:
        raise DeidSpecError("dictionary_ref does not match the spec's dictionaryRef")
    words = load_dictionary(ref, started.dictionary_sm3)
    if not words:
        raise DeidSpecError("dictionary file is empty")
    return sorted(words, key=len, reverse=True)  # 长词优先，避免截断


def _iter_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _iter_strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _iter_strings(item)


def assert_no_residual_identifiers(record: Mapping[str, Any], names: list[str] | None = None) -> None:
    """变换后仍能扫出直接标识 → 抛错（消息只带字段名与标识类别，不带值）。

    这一步是"看起来脱敏过"与"确实没残留"之间的分界：`text_rules` 漏了某类规则、
    或规格把字段写成 `keep`，都在这里变成 FAILED，而不是把残留带进本地库。
    """
    hits: list[str] = []
    names = names or []
    for field, value in record.items():
        for text in _iter_strings(value):
            for kind, pattern in _RESIDUAL_PATTERNS:
                if pattern.search(text):
                    hits.append(f"{field}:{kind}")
            if names and any(name in text for name in names):
                hits.append(f"{field}:person_name")
    if hits:
        raise DeidExecutionError(
            "residual direct identifier after transform: " + ",".join(sorted(set(hits)))
        )


def apply_deid_record(
    record: Mapping[str, Any],
    spec: DeidSpec,
    salts: Mapping[str, str],
    default_salt_ref: str,
    dictionary_words: list[str] | None = None,
) -> Dict[str, Any]:
    """Apply only the closed operator set from a validated spec."""
    output = dict(record)
    for transform in spec.transforms:
        if transform.op == "drop":
            output.pop(transform.field, None)
        elif transform.op == "keep":
            continue
        elif transform.field in output:
            output[transform.field] = _apply_transform(
                output[transform.field],
                transform,
                output,
                salts,
                default_salt_ref,
                dictionary_words,
            )
    for field in spec.deny_if_transform_missing:
        transform = next(item for item in spec.transforms if item.field == field)
        if transform.op == "keep" or field in output and transform.op == "drop":
            raise DeidExecutionError(f"mandatory field was not transformed: {field}")
    return output


def _apply_transform(
    value: Any,
    transform: DeidTransform,
    record: Mapping[str, Any],
    salts: Mapping[str, str],
    default_salt_ref: str,
    dictionary_words: list[str] | None = None,
) -> Any:
    params = transform.params
    if transform.op == "hmac_pseudonym":
        salt_ref = str(params.get("saltRef") or default_salt_ref)
        salt = salts.get(salt_ref)
        if not salt:
            raise DeidExecutionError(f"salt is unavailable: {salt_ref}")
        digest = hmac.new(salt.encode(), str(value).encode(), digestmod="sm3").hexdigest()
        return "sk_" + digest[: int(params.get("outLen", 32))]
    if transform.op == "generalize":
        if params.get("to") == "age_band_10" and isinstance(value, (int, float)) and not isinstance(value, bool):
            start = int(value // 10) * 10
            return f"{start}-{start + 9}"
        return value
    if transform.op == "date_shift":
        if not isinstance(value, str):
            return value
        max_days = int(params.get("maxDays", 0))
        salt = salts.get(str(params.get("saltRef") or default_salt_ref))
        if not salt:
            raise DeidExecutionError("date_shift salt is unavailable")
        subject = str(record.get("subject_id", record.get("subjectKey", "")))
        digest = hmac.new(salt.encode(), subject.encode(), digestmod="sm3").digest()
        offset = int.from_bytes(digest[:2], "big") % (2 * max_days + 1) - max_days if max_days else 0
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return (parsed + timedelta(days=offset)).isoformat()
        except ValueError:
            # 不把值写进消息：错误消息会回给连接器，值即数据。
            raise DeidExecutionError(
                f"date value is not ISO-8601: field={transform.field}"
            ) from None
    if transform.op == "truncate":
        return str(value)[: int(params.get("maxLen", len(str(value))))]
    if transform.op == "bucketize" and isinstance(value, (int, float)) and not isinstance(value, bool):
        width = float(params.get("width", 1))
        if width <= 0:
            raise DeidExecutionError("bucket width must be positive")
        return int(value // width) * width
    if transform.op == "suppress":
        return None
    if transform.op == "text_rules" and isinstance(value, str):
        result = value
        rules = set(params.get("rules", []))
        if "phone" in rules:
            result = re.sub(r"(?<!\d)1\d{10}(?!\d)", "[PHONE]", result)
        if "id_card" in rules:
            result = re.sub(r"(?<![0-9Xx])[0-9]{17}[0-9Xx](?![0-9])", "[ID]", result)
        if "address" in rules:
            result = re.sub(r"[^，。；;]{0,20}(?:路|街|号|室)[^，。；;]{0,20}", "[ADDRESS]", result)
        if "person_name" in rules:
            result = _apply_name_dictionary(result, dictionary_words)
        return result
    return value


# 姓名/术语词表由 `dictionaryRef` 指向**版本化签名清单**（内容留在医院，见 deid_dictionary.py）。
# 中文姓名没有词边界，只能按**子串**替换；宁可多删 —— 残留检测会再扫一遍。
def _apply_name_dictionary(text: str, words: list[str] | None = None) -> str:
    for word in words or []:  # 长词优先，避免截断
        text = text.replace(word, "[NAME]")
    return text


def _ensure_salts(spec: DeidSpec, salts: Mapping[str, str], default_ref: str) -> None:
    refs = {
        str(transform.params.get("saltRef") or default_ref)
        for transform in spec.transforms
        if transform.op in {"hmac_pseudonym", "date_shift"}
    }
    missing = sorted(ref for ref in refs if not salts.get(ref))
    if missing:
        raise DeidSpecError("salt unavailable: " + ", ".join(missing))


def _load_salts() -> Dict[str, str]:
    raw = os.environ.get("AGENT_DEID_SALTS_JSON", "{}")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DeidSpecError("AGENT_DEID_SALTS_JSON is invalid") from exc
    if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
        raise DeidSpecError("AGENT_DEID_SALTS_JSON must map string refs to string salts")
    return value


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _sm3(value: bytes) -> str:
    return hashlib.new("sm3", value).hexdigest()
