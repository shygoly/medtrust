"""院内词表解析：ref → 本院文件 → 核对平台签名的摘要（Phase 2）。"""

import hashlib

import pytest

from medtrust_agent.deid_dictionary import dictionary_path, load_dictionary
from medtrust_agent.deid_spec import DeidSpecError


def put(root, ref: str, words) -> str:
    path = dictionary_path(ref, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = ("\n".join(words) + "\n").encode("utf-8")
    path.write_bytes(payload)
    return hashlib.new("sm3", payload).hexdigest()


def test_path_rule_is_deterministic(tmp_path):
    assert dictionary_path("deid:cn-names:v2", tmp_path).name == "deid_cn-names.v2.txt"


def test_loads_words_when_digest_matches(tmp_path):
    digest = put(tmp_path, "deid:cn-names:v2", ["张三", "李四"])
    assert load_dictionary("deid:cn-names:v2", digest, tmp_path) == ["张三", "李四"]


def test_rejects_digest_mismatch(tmp_path):
    put(tmp_path, "deid:cn-names:v2", ["张三"])
    with pytest.raises(DeidSpecError, match="digest mismatch"):
        load_dictionary("deid:cn-names:v2", "b" * 64, tmp_path)


def test_rejects_missing_file(tmp_path):
    with pytest.raises(DeidSpecError, match="missing"):
        load_dictionary("deid:cn-names:v9", "b" * 64, tmp_path)


def test_rejects_bad_digest_shape(tmp_path):
    put(tmp_path, "deid:cn-names:v2", ["张三"])
    for bad in ["", "xyz", "a" * 63]:
        with pytest.raises(DeidSpecError):
            load_dictionary("deid:cn-names:v2", bad, tmp_path)


def test_rejects_ref_without_digest(tmp_path):
    with pytest.raises(DeidSpecError, match="required together"):
        load_dictionary("deid:cn-names:v2", "", tmp_path)
