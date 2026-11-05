import asyncio
import json

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


async def run(chunks):
    result = []
    async for output in DeidentificationAgentServicer().RunDeidentification(_aiter(chunks), None):
        result.append(output)
    return result


async def _aiter(chunks):
    for chunk in chunks:
        yield chunk


def start(**kwargs):
    payload = {"job_id": "j1", "contract_id": "c1", "spec_sm3": "sm3:spec", "spec_json": json.dumps(spec()), "salt_ref": "org:k1", "row_limit": 10}
    payload.update(kwargs)
    return pb.DeidChunk(start=pb.DeidStart(**payload))


def test_streams_projection_and_returns_receipt(monkeypatch):
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


def test_missing_salt_denies_without_output(monkeypatch):
    monkeypatch.setenv("AGENT_DEID_SALTS_JSON", "{}")
    outputs = asyncio.run(
        run([start(), pb.DeidChunk(projected_jsonl=b'{"subject_id":"s-1","name":"Alice"}\n'), pb.DeidChunk(end=True)])
    )
    assert len(outputs) == 1
    assert outputs[0].receipt.ack_status == "DENIED"
    assert "salt unavailable" in outputs[0].receipt.message


def test_row_limit_fails_closed(monkeypatch):
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
