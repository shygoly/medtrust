"""连接器投影的联邦训练切片（omop-data-source-access 4.3，D-CN-6）。

agent 不自行读取任何院内数据：训练数据只来自连接器随 RunLocalRound 请求给出的这个切片。
特征与标签的**口径**由连接器定义（``schema`` 标明口径版本，如 ``esrd-proxy@1``），
agent 这里只做结构校验——并且拒收切片之外的任何字段：假名、年龄段、诊断文本之类
即便被误塞进来，也在进入训练前被挡掉。

本模块不依赖 torch，便于在没有训练栈的环境里单测校验逻辑。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import List

_ALLOWED_KEYS = {"schema", "featureKeys", "rows", "labels"}


class TrainingSliceError(ValueError):
    """切片缺失或不合规——训练轮次必须失败，不能退回任何本地数据源。"""


@dataclass(frozen=True)
class TrainingSlice:
    schema: str
    feature_keys: List[str]
    rows: List[List[float]]
    labels: List[int]

    def __len__(self) -> int:
        return len(self.rows)


def _is_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_training_slice(raw: str, *, expected_dim: int) -> TrainingSlice:
    if not raw or not raw.strip():
        raise TrainingSliceError(
            "连接器未提供训练切片：agent 不自行读取院内数据（D-CN-6），拒绝训练"
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TrainingSliceError(f"训练切片不是合法 JSON：{exc.msg}") from exc
    if not isinstance(data, dict):
        raise TrainingSliceError("训练切片须为对象")
    extra = sorted(set(data) - _ALLOWED_KEYS)
    if extra:
        raise TrainingSliceError(f"训练切片含不允许的字段 {extra}：只收特征、标签与口径标识")

    schema = data.get("schema")
    if not isinstance(schema, str) or not schema.strip():
        raise TrainingSliceError("训练切片缺少口径标识 schema")

    keys = data.get("featureKeys")
    if not (isinstance(keys, list) and all(isinstance(k, str) and k for k in keys)):
        raise TrainingSliceError("featureKeys 须为非空字符串数组")
    if len(keys) != expected_dim:
        raise TrainingSliceError(
            f"切片特征维数 {len(keys)} 与模型 structured_ehr 维数 {expected_dim} 不符"
        )

    rows = data.get("rows")
    labels = data.get("labels")
    if not isinstance(rows, list) or not rows:
        raise TrainingSliceError("训练切片没有任何记录")
    if not isinstance(labels, list) or len(labels) != len(rows):
        raise TrainingSliceError("labels 须与 rows 等长")
    for i, row in enumerate(rows):
        if not (isinstance(row, list) and len(row) == expected_dim and all(_is_number(v) for v in row)):
            raise TrainingSliceError(f"第 {i} 行须为 {expected_dim} 个有限数值")
    for i, label in enumerate(labels):
        if isinstance(label, bool) or label not in (0, 1):
            raise TrainingSliceError(f"第 {i} 个标签须为 0 或 1")

    return TrainingSlice(
        schema=schema,
        feature_keys=list(keys),
        rows=[[float(v) for v in row] for row in rows],
        labels=[int(v) for v in labels],
    )
