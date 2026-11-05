import pytest

from medtrust_agent.deid_spec import DeidSpecError, parse_deid_spec


BASE = {
    "version": 1,
    "id": "mask.v1",
    "scope": {"product": "urn:tds:space:product", "level": "C0_internal"},
    "transforms": [
        {"field": "subject_id", "op": "hmac_pseudonym", "params": {"saltRef": "org:k1", "outLen": 32}},
        {"field": "name", "op": "drop"},
    ],
    "denyIfTransformMissing": ["subject_id", "name"],
}


def test_parse_closed_spec():
    parsed = parse_deid_spec(BASE)
    assert parsed.spec_id == "mask.v1"
    assert [item.op for item in parsed.transforms] == ["hmac_pseudonym", "drop"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: {**value, "version": 2},
        lambda value: {**value, "transforms": [{"field": "x", "op": "python"}]},
        lambda value: {**value, "denyIfTransformMissing": ["phone"]},
        lambda value: {**value, "quasiIdentifierPolicy": {"k": 4, "suppressIfBelow": True, "columns": ["age"]}},
        lambda value: {**value, "transforms": [{"field": "x", "op": "date_shift", "params": {"maxDays": 31}}], "denyIfTransformMissing": []},
    ],
)
def test_rejects_unsafe_specs(mutate):
    with pytest.raises(DeidSpecError):
        parse_deid_spec(mutate(BASE))
