import asyncio
import hashlib
import json

from medtrust_agent.deid_audit import DeidAuditChain, verify_chain
from medtrust_agent.deidentify_servicer import DeidentificationAgentServicer
from medtrust_agent.generated import deidentify_pb2 as pb


def spec():
    return {
        "version": 1,
        "id": "mask.v1",
        "scope": {"product": "urn:tds:space:product", "level": "C0_internal"},
        "transforms": [
            {"field": "subject_id", "op": "hmac_pseudonym", "params": {"saltRef": "org:k1", "outLen": 16}},
            {"field": "name", "op": "drop"},
            {"field": "age", "op": "generalize", "params": {"to": "age_band_10"}},
            {"field": "note", "op": "text_rules", "params": {"rules": ["phone"]}},
        ],
        "denyIfTransformMissing": ["subject_id", "name"],
    }


def canonical(payload) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def spec_digest(payload=None) -> str:
    raw = canonical(payload if payload is not None else spec()).encode()
    return hashlib.new("sm3", raw).hexdigest()


async def run(chunks):
    result = []
    async for output in DeidentificationAgentServicer().RunDeidentification(_aiter(chunks), None):
        result.append(output)
    return result


async def _aiter(chunks):
    for chunk in chunks:
        yield chunk


def start(**kwargs):
    payload = {
        "job_id": "j1",
        "contract_id": "c1",
        "spec_sm3": spec_digest(),
        "spec_json": canonical(spec()),
        "salt_ref": "org:k1",
        "row_limit": 10,
    }
    payload.update(kwargs)
    return pb.DeidChunk(start=pb.DeidStart(**payload))


def write_dictionary(tmp_path, ref: str, words: list[str]) -> tuple[str, str]:
    """按 agent 的命名规则投放一份本院词表，返回 (ref, sm3)。"""
    from medtrust_agent.deid_dictionary import dictionary_path

    path = dictionary_path(ref, tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = ("\n".join(words) + "\n").encode("utf-8")
    path.write_bytes(payload)
    return ref, hashlib.new("sm3", payload).hexdigest()


def test_streams_projection_and_returns_receipt(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "local-only-test-salt"}))
    rows = b'{"subject_id":"s-1","name":"Alice","age":34,"note":"call 13800138000"}\n'
    outputs = asyncio.run(
        run([start(), pb.DeidChunk(projected_jsonl=rows), pb.DeidChunk(end=True)])
    )
    transformed = json.loads(outputs[0].deidentified_jsonl)
    receipt = outputs[-1].receipt
    assert transformed["subject_id"].startswith("sk_")
    assert transformed["age"] == "30-39"
    assert transformed["note"] == "call [PHONE]"
    assert "name" not in transformed
    assert receipt.ack_status == "OK"
    assert receipt.row_count == 1
    assert receipt.input_digest.startswith(tuple("0123456789abcdef"))
    assert receipt.output_digest.startswith(tuple("0123456789abcdef"))
    # 回执的 agent_receipt = 审计链末条摘要，且链可校验
    entries = DeidAuditChain(str(tmp_path / "audit.jsonl")).entries()
    assert verify_chain(entries) is True
    assert entries[-1]["digest"] == receipt.agent_receipt
    assert entries[-1]["spec_sm3"] == spec_digest()


def test_output_digest_matches_emitted_bytes(monkeypatch, tmp_path):
    """输出摘要必须等于「实际发出的字节」的 SM3 —— 连接器据此逐字节对账。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    rows = b'{"subject_id":"s-1","name":"Alice","age":34,"note":"x"}\n'
    outputs = asyncio.run(
        run([start(), pb.DeidChunk(projected_jsonl=rows), pb.DeidChunk(end=True)])
    )
    emitted = b"".join(o.deidentified_jsonl for o in outputs if o.deidentified_jsonl)
    assert hashlib.new("sm3", emitted).hexdigest() == outputs[-1].receipt.output_digest


def test_missing_salt_denies_without_output(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", "{}")
    outputs = asyncio.run(
        run([start(), pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"Alice"}\n'), pb.DeidChunk(end=True)])
    )
    assert len(outputs) == 1
    assert outputs[0].receipt.ack_status == "DENIED"
    assert "salt unavailable" in outputs[0].receipt.message
    # 拒跑也留痕
    entries = DeidAuditChain(str(tmp_path / "audit.jsonl")).entries()
    assert entries[-1]["ack"] == "DENIED"
    assert outputs[0].receipt.agent_receipt == entries[-1]["digest"]


def test_row_limit_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    outputs = asyncio.run(
        run(
            [
                start(row_limit=1),
                pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"Alice"}\n{"subject_id":"s-2","name":"Bob"}\n'),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert outputs[-1].receipt.ack_status == "FAILED"
    assert "row_limit" in outputs[-1].receipt.message


def test_spec_digest_mismatch_is_denied(monkeypatch, tmp_path):
    """连接器转发被改过的规格：agent 自己重算摘要，不信对方声称的值。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    tampered = start(spec_sm3=spec_digest({"version": 1}))
    outputs = asyncio.run(
        run([tampered, pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"A"}\n'), pb.DeidChunk(end=True)])
    )
    assert outputs[0].receipt.ack_status == "DENIED"
    assert "spec_sm3" in outputs[0].receipt.message


def test_receipt_never_carries_row_values(monkeypatch, tmp_path):
    """回执/错误消息不得出现任何字段值（回执是要出 agent 的）。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    secret = "13800138000"
    rows = ('{"subject_id":"s-1","name":"Alice","age":34,"note":"' + secret + '"}\n').encode()
    outputs = asyncio.run(run([start(), pb.DeidChunk(projected_jsonl=rows), pb.DeidChunk(end=True)]))
    receipt = outputs[-1].receipt
    for field in (receipt.message, receipt.agent_receipt, receipt.input_digest, receipt.output_digest):
        assert secret not in field
        assert "Alice" not in field
    assert list(receipt.warnings) == []


def test_invalid_date_reports_field_not_value(monkeypatch, tmp_path):
    """错误消息带字段名，不带值（值即数据）。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    payload = spec()
    payload["transforms"].append(
        {"field": "visit_date", "op": "date_shift", "params": {"saltRef": "org:k1", "maxDays": 7}}
    )
    rows = b'{"subject_id":"s-1","name":"Alice","age":34,"note":"x","visit_date":"2026-13-99"}\n'
    outputs = asyncio.run(
        run(
            [
                start(spec_json=canonical(payload), spec_sm3=spec_digest(payload)),
                pb.DeidChunk(projected_jsonl=rows),
                pb.DeidChunk(end=True),
            ]
        )
    )
    receipt = outputs[-1].receipt
    assert receipt.ack_status == "FAILED"
    assert "visit_date" in receipt.message
    assert "2026-13-99" not in receipt.message


def test_person_name_rule_uses_signed_dictionary(monkeypatch, tmp_path):
    """person_name 依赖版本化词表：ref + 平台签名摘要，agent 自己核对文件 SM3。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    monkeypatch.setenv("AGENT_DEID_DICTIONARY_DIR", str(tmp_path))
    ref, digest = write_dictionary(tmp_path, "deid:cn-names:v2", ["张三", "李四"])
    payload = spec()
    payload["transforms"][3] = {
        "field": "note",
        "op": "text_rules",
        "params": {"rules": ["person_name"], "dictionaryRef": ref},
    }
    rows = '{"subject_id":"s-1","name":"Alice","age":34,"note":"张三今日复诊"}\n'.encode()
    outputs = asyncio.run(
        run(
            [
                start(
                    spec_json=canonical(payload),
                    spec_sm3=spec_digest(payload),
                    dictionary_ref=ref,
                    dictionary_sm3=digest,
                ),
                pb.DeidChunk(projected_jsonl=rows),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert json.loads(outputs[0].deidentified_jsonl)["note"] == "[NAME]今日复诊"


def test_dictionary_digest_mismatch_is_denied(monkeypatch, tmp_path):
    """本院词表文件与平台签名的摘要对不上 → DENIED（不"跳过替换"继续跑）。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    monkeypatch.setenv("AGENT_DEID_DICTIONARY_DIR", str(tmp_path))
    ref, _ = write_dictionary(tmp_path, "deid:cn-names:v2", ["张三"])
    payload = spec()
    payload["transforms"][3] = {
        "field": "note",
        "op": "text_rules",
        "params": {"rules": ["person_name"], "dictionaryRef": ref},
    }
    rows = '{"subject_id":"s-1","name":"Alice","age":34,"note":"张三复诊"}\n'.encode()
    outputs = asyncio.run(
        run(
            [
                start(
                    spec_json=canonical(payload),
                    spec_sm3=spec_digest(payload),
                    dictionary_ref=ref,
                    dictionary_sm3=hashlib.new("sm3", b"another dictionary").hexdigest(),
                ),
                pb.DeidChunk(projected_jsonl=rows),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert [o.WhichOneof("payload") for o in outputs] == ["receipt"]
    assert outputs[-1].receipt.ack_status == "DENIED"
    assert "digest mismatch" in outputs[-1].receipt.message


def test_dictionary_missing_file_is_denied(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    monkeypatch.setenv("AGENT_DEID_DICTIONARY_DIR", str(tmp_path))
    payload = spec()
    payload["transforms"][3] = {
        "field": "note",
        "op": "text_rules",
        "params": {"rules": ["person_name"], "dictionaryRef": "deid:cn-names:v9"},
    }
    outputs = asyncio.run(
        run(
            [
                start(
                    spec_json=canonical(payload),
                    spec_sm3=spec_digest(payload),
                    dictionary_ref="deid:cn-names:v9",
                    dictionary_sm3="a" * 64,
                ),
                pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"A","age":1,"note":"x"}\n'),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert outputs[-1].receipt.ack_status == "DENIED"
    assert "missing" in outputs[-1].receipt.message


def test_spec_dictionary_requires_start_fields(monkeypatch, tmp_path):
    """规格引用了词表但 start 没带 ref/摘要 → DENIED（不猜词表）。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    payload = spec()
    payload["transforms"][3] = {
        "field": "note",
        "op": "text_rules",
        "params": {"rules": ["person_name"], "dictionaryRef": "deid:cn-names:v2"},
    }
    outputs = asyncio.run(
        run(
            [
                start(spec_json=canonical(payload), spec_sm3=spec_digest(payload)),
                pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"A","age":1,"note":"x"}\n'),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert outputs[-1].receipt.ack_status == "DENIED"
    assert "dictionary_ref" in outputs[-1].receipt.message


def test_residual_direct_identifier_fails_closed(monkeypatch, tmp_path):
    """变换后仍能扫出手机号（规格漏了 phone 规则）→ FAILED，且该行**不发出**。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    payload = spec()
    payload["transforms"][3] = {"field": "note", "op": "text_rules", "params": {"rules": ["address"]}}
    rows = b'{"subject_id":"s-1","name":"Alice","age":34,"note":"call 13800138000"}\n'
    outputs = asyncio.run(
        run(
            [
                start(spec_json=canonical(payload), spec_sm3=spec_digest(payload)),
                pb.DeidChunk(projected_jsonl=rows),
                pb.DeidChunk(end=True),
            ]
        )
    )
    # 只有回执，没有任何脱敏块流出（残留不带进下游）
    assert [o.WhichOneof("payload") for o in outputs] == ["receipt"]
    receipt = outputs[-1].receipt
    assert receipt.ack_status == "FAILED"
    assert "residual direct identifier" in receipt.message
    assert "note:phone" in receipt.message
    assert "13800138000" not in receipt.message


def test_residual_person_name_detected_with_dictionary(monkeypatch, tmp_path):
    """词表只用于 `other` 字段时，`note` 里的姓名仍会被残留检测抓住。"""
    monkeypatch.setenv("AGENT_DEID_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", json.dumps({"org:k1": "salt"}))
    monkeypatch.setenv("AGENT_DEID_DICTIONARY_DIR", str(tmp_path))
    ref, digest = write_dictionary(tmp_path, "deid:cn-names:v2", ["张三"])
    payload = spec()
    payload["transforms"][3] = {"field": "note", "op": "text_rules", "params": {"rules": ["phone"]}}
    payload["transforms"].append(
        {"field": "other", "op": "text_rules", "params": {"rules": ["person_name"], "dictionaryRef": ref}}
    )
    rows = '{"subject_id":"s-1","name":"Alice","age":34,"note":"张三复诊","other":"张三"}\n'.encode()
    outputs = asyncio.run(
        run(
            [
                start(
                    spec_json=canonical(payload),
                    spec_sm3=spec_digest(payload),
                    dictionary_ref=ref,
                    dictionary_sm3=digest,
                ),
                pb.DeidChunk(projected_jsonl=rows),
                pb.DeidChunk(end=True),
            ]
        )
    )
    assert outputs[-1].receipt.ack_status == "FAILED"
    assert "note:person_name" in outputs[-1].receipt.message
