"""院内脱敏词表的本地解析（Phase 2）。

口径（与盐同向，D-CN-9）：

* **词表内容留在医院**：平台只签摘要（`medtrust.deid-dictionary.v1:<sm3>`）；
* 连接器验签后把 `dictionary_ref` 与 `dictionary_sm3` 一起发给 agent；
* agent 按 ref 在本院词表目录里找文件，**自己算 SM3**，与连接器给的摘要比对：
  对不上或找不到即 DENIED —— 不"跳过姓名替换"继续跑。

文件命名（确定性规则，运维照此投放）：
    <AGENT_DEID_DICTIONARY_DIR>/<id 里的 ':' 换成 '_'>.v<version>.txt
例：ref = `deid:cn-names:v2` → `deid_cn-names.v2.txt`，每行一个词。
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Optional

from .deid_spec import DeidSpecError, parse_dictionary_ref

DEFAULT_DICTIONARY_DIR = "data/deid-dictionaries"
MAX_DICTIONARY_BYTES = 32 * 1024 * 1024


def dictionary_dir() -> Path:
    return Path(os.environ.get("AGENT_DEID_DICTIONARY_DIR", DEFAULT_DICTIONARY_DIR))


def dictionary_path(ref: str, root: Optional[Path] = None) -> Path:
    """按 ref 推出本院词表文件路径（不读文件）。"""
    dictionary_id, version = parse_dictionary_ref(ref)
    safe_id = dictionary_id.replace(":", "_")
    return (root or dictionary_dir()) / f"{safe_id}.v{version}.txt"


def load_dictionary(
    ref: str,
    expected_sm3: str,
    root: Optional[Path] = None,
) -> list[str]:
    """读入词表并核对摘要。任何不满足都抛 `DeidSpecError`（调用方按 DENIED 处置）。"""
    if not ref or not expected_sm3:
        raise DeidSpecError("dictionary_ref and dictionary_sm3 are required together")
    digest = expected_sm3.strip().lower()
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        raise DeidSpecError("dictionary_sm3 must be 64 hex")

    path = dictionary_path(ref, root)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        # 只报路径与 ref，不把目录内容带进消息。
        raise DeidSpecError(f"dictionary file is missing for {ref}") from exc
    if len(payload) > MAX_DICTIONARY_BYTES:
        raise DeidSpecError("dictionary file exceeds the 32 MB limit")
    actual = hashlib.new("sm3", payload).hexdigest()
    if actual != digest:
        raise DeidSpecError(
            f"dictionary digest mismatch for {ref}: local file is not the approved version"
        )
    words = [line.strip() for line in payload.decode("utf-8", errors="strict").splitlines()]
    return [word for word in words if word]


__all__ = [
    "DEFAULT_DICTIONARY_DIR",
    "MAX_DICTIONARY_BYTES",
    "dictionary_dir",
    "dictionary_path",
    "load_dictionary",
]
