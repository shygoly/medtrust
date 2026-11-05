"""院内脱敏 gRPC 服务。

The connector owns datasource access and sends a restricted JSONL projection.
This service never opens a database connection and never accepts SQL, paths, or
arbitrary Python code from the caller.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, AsyncIterable, Dict, Iterable, Mapping

from .deid_spec import DeidSpec, DeidSpecError, DeidTransform, parse_deid_spec
from .generated import deidentify_pb2 as pb
from .generated import deidentify_pb2_grpc as pb_grpc


class DeidExecutionError(ValueError):
    pass


class DeidentificationAgentServicer(pb_grpc.DeidentificationAgentServicer):
    """Streaming connector-projection -> deidentified-output implementation."""

    async def RunDeidentification(self, request_iterator, context):  # noqa: N802
        started = None
        input_hash = hashlib.new("sm3")
        output_hash = hashlib.new("sm3")
        row_count = 0
        output_count = 0
        try:
            async for chunk in request_iterator:
                kind = chunk.WhichOneof("payload")
                if kind == "start":
                    if started is not None:
                        raise DeidExecutionError("duplicate start")
                    started = chunk.start
                    spec = self._load_spec(started)
                    salt_map = _load_salts()
                    _ensure_salts(spec, salt_map, started.salt_ref)
                    continue
                if started is None:
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
                        transformed = apply_deid_record(record, spec, _load_salts(), started.salt_ref)
                        encoded = _canonical_json(transformed) + b"\n"
                        output_hash.update(encoded)
                        output_count += 1
                        yield pb.DeidOutput(deidentified_jsonl=encoded)
                    continue
                if kind == "end":
                    break
                raise DeidExecutionError("unknown stream message")

            if started is None:
                raise DeidExecutionError("missing start")
            input_digest = input_hash.hexdigest()
            output_digest = output_hash.hexdigest()
            receipt = {
                "job_id": started.job_id,
                "contract_id": started.contract_id,
                "spec_sm3": started.spec_sm3,
                "input_digest": input_digest,
                "output_digest": output_digest,
                "row_count": output_count,
                "status": "OK",
            }
            yield pb.DeidOutput(
                receipt=pb.DeidReceipt(
                    ack_status="OK",
                    row_count=output_count,
                    input_digest=input_digest,
                    output_digest=output_digest,
                    spec_sm3=started.spec_sm3,
                    agent_receipt=_sm3(_canonical_json(receipt)),
                    message="ok",
                )
            )
        except (DeidSpecError, DeidExecutionError, json.JSONDecodeError) as exc:
            yield pb.DeidOutput(
                receipt=pb.DeidReceipt(
                    ack_status="DENIED" if isinstance(exc, DeidSpecError) else "FAILED",
                    spec_sm3=started.spec_sm3 if started else "",
                    message=str(exc),
                )
            )

    @staticmethod
    def _load_spec(start) -> DeidSpec:
        if not start.spec_json or not start.spec_sm3:
            raise DeidSpecError("spec_json and spec_sm3 are required")
        raw = json.loads(start.spec_json)
        return parse_deid_spec(raw)


def apply_deid_record(
    record: Mapping[str, Any],
    spec: DeidSpec,
    salts: Mapping[str, str],
    default_salt_ref: str,
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
                output[transform.field], transform, output, salts, default_salt_ref
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
        if params.get("to") == "age_band_10" and isinstance(value, (int, float)):
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
            raise DeidExecutionError(f"date value is invalid: {value}") from None
    if transform.op == "truncate":
        return str(value)[: int(params.get("maxLen", len(str(value))))]
    if transform.op == "bucketize" and isinstance(value, (int, float)):
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
        return result
    return value


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
