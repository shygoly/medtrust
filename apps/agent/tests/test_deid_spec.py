import pytest

from medtrust_agent.deid_spec import DeidSpecError, parse_deid_spec, parse_dictionary_ref


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


def test_person_name_requires_versioned_dictionary():
    """person_name 必须绑定版本化词表（与 packages/mdop 同口径）。"""
    no_ref = {
        **BASE,
        "transforms": [
            *BASE["transforms"],
            {"field": "note", "op": "text_rules", "params": {"rules": ["person_name"]}},
        ],
    }
    with pytest.raises(DeidSpecError):
        parse_deid_spec(no_ref)

    with_ref = {
        **BASE,
        "transforms": [
            *BASE["transforms"],
            {
                "field": "note",
                "op": "text_rules",
                "params": {"rules": ["person_name"], "dictionaryRef": "deid:cn-names:v2"},
            },
        ],
    }
    parsed = parse_deid_spec(with_ref)
    assert parsed.transforms[-1].params["dictionaryRef"] == "deid:cn-names:v2"


@pytest.mark.parametrize(
    "ref", ["deid:cn-names", "deid:cn-names:v0", "deid:cn-names:v2x", "Deid:cn:v2", ""]
)
def test_dictionary_ref_shape(ref):
    with pytest.raises(DeidSpecError):
        parse_dictionary_ref(ref)


def test_dictionary_ref_parsed():
    assert parse_dictionary_ref("deid:cn-names:v2") == ("deid:cn-names", 2)
