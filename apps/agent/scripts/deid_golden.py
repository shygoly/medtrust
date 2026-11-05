#!/usr/bin/env python3
"""golden corpus 驱动：按 DeidSpec 对一批结构化行执行脱敏，供一致性回归比对。

用途（openspec/changes/connector-agent-deidentification「golden corpus 一致性回归」）：
同一份语料分别过内置 TS `Deidentifier`（builtin 通道）与 agent 侧算子（agent 通道），
逐字段比对，确认迁移期口径没有漂移。

用法：
    PYTHONPATH=apps/agent/src python3 apps/agent/scripts/deid_golden.py \
        --spec spec.json --rows rows.jsonl --salts '{"org:k1":"salt"}' --out out.jsonl

约束与 agent 服务一致：不读数据源、不执行任意代码；盐只从参数/环境拿。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from medtrust_agent.deid_spec import parse_deid_spec  # noqa: E402
from medtrust_agent.deidentify_servicer import apply_deid_record  # noqa: E402


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply a DeidSpec to a JSONL corpus")
    parser.add_argument("--spec", required=True, help="DeidSpec JSON file")
    parser.add_argument("--rows", required=True, help="input JSONL (one object per line)")
    parser.add_argument("--out", required=True, help="output JSONL")
    parser.add_argument("--salts", default="{}", help="JSON map saltRef -> salt")
    parser.add_argument("--salt-ref", default="", help="default salt ref")
    args = parser.parse_args(argv)

    spec = parse_deid_spec(json.loads(Path(args.spec).read_text(encoding="utf-8")))
    salts: Dict[str, str] = json.loads(args.salts)

    rows: List[Dict[str, Any]] = []
    for line in Path(args.rows).read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))

    out: List[Dict[str, Any]] = [
        apply_deid_record(row, spec, salts, args.salt_ref) for row in rows
    ]
    Path(args.out).write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in out) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
