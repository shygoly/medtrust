#!/usr/bin/env python3
"""重识别风险评估：准标识组合 + 自由文本残留（connector-agent-deidentification Phase 2）。

用途：给"这份脱敏产物能不能拿去当评测材料"一个**可复算**的结论，而不是一句"已脱敏"。
输出的报告可附在对外材料/评审包里，逐项列出判据与阈值。

判据（三条，都是可机检的）：

1. **直接标识零残留**：扫描每个字段的字符串值，命中手机号 / 身份证 / 邮箱 / 地址即算残留；
   给了 `--dictionary`（每行一个姓名）时，词表命中同样算残留。
2. **准标识 k 阈值**：按 `--quasi-identifiers` 指定的列做组合分组，统计每个组合的规模。
   `min_k < --min-k` 即失败；同时报告 `unique_rows`（k=1 的行数）与 `violating_classes`。
3. **敏感列多样性（可选）**：给 `--sensitive` 时，报告每个组合内敏感值去重后的最少个数
   （l-diversity 的粗口径），低于 `--min-l` 即提示（不单独判失败，需人工判断）。

用法：
    PYTHONPATH=apps/agent/src python3 apps/agent/scripts/deid_reidentification_report.py \
        --rows out.jsonl --quasi-identifiers ageBand,sex --min-k 5 \
        --dictionary data/deid-dictionaries/deid_cn-names.v2.txt \
        --sensitive labValue --out report.json --markdown report.md

注意：本脚本**不宣称匿名**。它判的是"这几条可机检的判据过不过"，不是"数据不可再识别"。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence

_DIRECT_PATTERNS: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    ("phone", re.compile(r"(?<!\d)1\d{10}(?!\d)")),
    ("id_card", re.compile(r"(?<![0-9Xx])[0-9]{17}[0-9Xx](?![0-9])")),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("address", re.compile(r"[\u4e00-\u9fa5]{2,}(?:路|街|号院|号楼|单元|室)\d*")),
)


def _iter_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _iter_strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _iter_strings(item)


def scan_direct_identifiers(
    rows: Sequence[Mapping[str, Any]],
    dictionary: Sequence[str] = (),
) -> Dict[str, Any]:
    """扫描直接标识残留：返回按 (字段, 类别) 聚合的命中行数，不返回任何值。"""
    hits: Counter[str] = Counter()
    affected_rows = 0
    for row in rows:
        row_hit = False
        for field, value in row.items():
            for text in _iter_strings(value):
                for kind, pattern in _DIRECT_PATTERNS:
                    if pattern.search(text):
                        hits[f"{field}:{kind}"] += 1
                        row_hit = True
                if dictionary and any(word in text for word in dictionary):
                    hits[f"{field}:person_name"] += 1
                    row_hit = True
        if row_hit:
            affected_rows += 1
    return {
        "affected_rows": affected_rows,
        "hit_columns": dict(sorted(hits.items())),
        "passed": affected_rows == 0,
    }


def k_anonymity(
    rows: Sequence[Mapping[str, Any]],
    quasi_identifiers: Sequence[str],
    min_k: int,
) -> Dict[str, Any]:
    """准标识组合的 k 分布。缺列的行走 `missing` 计数（不静默当成某个值）。"""
    if not quasi_identifiers:
        return {
            "checked": False,
            "reason": "未指定准标识列（--quasi-identifiers）",
            "passed": False,
            "min_k_observed": None,
            "classes": 0,
            "violating_classes": 0,
            "violating_rows": 0,
            "unique_rows": 0,
            "missing_key_rows": 0,
        }

    classes: Counter[tuple] = Counter()
    missing = 0
    for row in rows:
        if any(qi not in row for qi in quasi_identifiers):
            missing += 1
            continue
        classes[tuple(sorted((qi, str(row[qi])) for qi in quasi_identifiers))] += 1

    if not classes:
        return {
            "checked": True,
            "passed": False,
            "min_k_observed": 0,
            "classes": 0,
            "violating_classes": 0,
            "violating_rows": 0,
            "unique_rows": 0,
            "missing_key_rows": missing,
            "reason": "所有行都缺准标识列",
        }

    sizes = list(classes.values())
    violating = [size for size in sizes if size < min_k]
    return {
        "checked": True,
        "passed": not violating and missing == 0,
        "min_k_observed": min(sizes),
        "classes": len(classes),
        "violating_classes": len(violating),
        "violating_rows": sum(violating),
        "unique_rows": sum(1 for size in sizes if size == 1),
        "missing_key_rows": missing,
        "threshold": min_k,
        "size_histogram": dict(sorted(Counter(sizes).items())),
    }


def l_diversity(
    rows: Sequence[Mapping[str, Any]],
    quasi_identifiers: Sequence[str],
    sensitive: Sequence[str],
    min_l: int,
) -> Dict[str, Any]:
    """每个准标识组合内，各敏感列的去重值个数的最小值（粗口径 l-diversity）。"""
    if not quasi_identifiers or not sensitive:
        return {"checked": False, "reason": "需要同时给 --quasi-identifiers 与 --sensitive"}
    groups: Dict[tuple, List[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        if any(qi not in row for qi in quasi_identifiers):
            continue
        groups[tuple(sorted((qi, str(row[qi])) for qi in quasi_identifiers))].append(row)
    if not groups:
        return {"checked": True, "passed": False, "reason": "没有可分组的数据"}

    per_column: Dict[str, int] = {}
    for column in sensitive:
        worst = min(
            len({str(row.get(column)) for row in members}) for members in groups.values()
        )
        per_column[column] = worst
    return {
        "checked": True,
        "passed": all(value >= min_l for value in per_column.values()),
        "min_distinct": per_column,
        "threshold": min_l,
    }


def build_report(
    rows: Sequence[Mapping[str, Any]],
    *,
    quasi_identifiers: Sequence[str] = (),
    min_k: int = 5,
    sensitive: Sequence[str] = (),
    min_l: int = 2,
    dictionary: Sequence[str] = (),
    source: str = "",
) -> Dict[str, Any]:
    direct = scan_direct_identifiers(rows, dictionary)
    kanon = k_anonymity(rows, quasi_identifiers, min_k)
    ld = l_diversity(rows, quasi_identifiers, sensitive, min_l)
    checks = {"direct_identifiers": direct, "k_anonymity": kanon}
    if ld.get("checked"):
        checks["l_diversity"] = ld
    verdict = direct["passed"] and kanon.get("passed") is True and (
        ld.get("passed", True) is not False
    )
    return {
        "source": source,
        "row_count": len(rows),
        "quasi_identifiers": list(quasi_identifiers),
        "min_k": min_k,
        "checks": checks,
        "verdict": "PASS" if verdict else "FAIL",
        "note": (
            "本报告只覆盖可机检判据（直接标识残留 / 准标识 k / 敏感列多样性粗口径）。"
            "它不构成「匿名化」结论：重识别风险还取决于外部数据集、时间线与机构知识。"
        ),
    }


def render_markdown(report: Mapping[str, Any]) -> str:
    lines: List[str] = []
    lines.append("# 重识别风险评估")
    lines.append("")
    lines.append(f"- 数据来源：{report.get('source') or '（未标注）'}")
    lines.append(f"- 行数：{report['row_count']}")
    lines.append(f"- 准标识列：{', '.join(report['quasi_identifiers']) or '（未指定）'}")
    lines.append(f"- k 阈值：{report['min_k']}")
    lines.append(f"- **结论：{report['verdict']}**")
    lines.append("")

    direct = report["checks"]["direct_identifiers"]
    lines.append("## 1. 直接标识残留")
    lines.append("")
    if direct["passed"]:
        lines.append("未检出直接标识残留（手机号 / 身份证 / 邮箱 / 地址" + (
            " / 词表姓名" if "person_name" in json.dumps(direct.get("hit_columns", {})) else ""
        ) + "）。")
    else:
        lines.append(f"检出残留，涉及 **{direct['affected_rows']}** 行：")
        lines.append("")
        lines.append("| 字段:类别 | 命中次数 |")
        lines.append("|---|---|")
        for key, count in direct["hit_columns"].items():
            lines.append(f"| {key} | {count} |")
    lines.append("")

    kanon = report["checks"]["k_anonymity"]
    lines.append("## 2. 准标识 k 匿名性")
    lines.append("")
    if not kanon.get("checked"):
        lines.append(f"未评估：{kanon.get('reason')}")
    else:
        lines.append(f"- 组合数：{kanon['classes']}")
        lines.append(f"- 实际最小 k：{kanon['min_k_observed']}（阈值 {kanon['threshold']}）")
        lines.append(f"- 低于阈值的组合：{kanon['violating_classes']} 个，涉及 {kanon['violating_rows']} 行")
        lines.append(f"- 唯一组合（k=1）行数：{kanon['unique_rows']}")
        lines.append(f"- 缺准标识列的行：{kanon['missing_key_rows']}")
        if kanon.get("size_histogram"):
            lines.append("")
            lines.append("| 组合规模 | 组合数 |")
            lines.append("|---|---|")
            for size, count in kanon["size_histogram"].items():
                lines.append(f"| {size} | {count} |")
    lines.append("")

    ld = report["checks"].get("l_diversity")
    if ld:
        lines.append("## 3. 敏感列多样性（粗口径）")
        lines.append("")
        if ld.get("checked"):
            lines.append(f"- 阈值 min_l = {ld['threshold']}")
            for column, value in ld["min_distinct"].items():
                lines.append(f"- `{column}` 最小去重值个数：{value}")
        else:
            lines.append(f"未评估：{ld.get('reason')}")
        lines.append("")

    lines.append("## 附注")
    lines.append("")
    lines.append(str(report.get("note")))
    lines.append("")
    return "\n".join(lines)


def load_rows(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            parsed = json.loads(line)
            if isinstance(parsed, dict):
                rows.append(parsed)
    return rows


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="重识别风险评估（准标识组合 + 直接标识残留）")
    parser.add_argument("--rows", required=True, help="脱敏后的 JSONL（每行一个对象）")
    parser.add_argument("--out", required=True, help="JSON 报告输出路径")
    parser.add_argument("--markdown", help="Markdown 报告输出路径（可选）")
    parser.add_argument("--quasi-identifiers", default="", help="逗号分隔的准标识列")
    parser.add_argument("--min-k", type=int, default=5)
    parser.add_argument("--sensitive", default="", help="逗号分隔的敏感列（算 l-diversity）")
    parser.add_argument("--min-l", type=int, default=2)
    parser.add_argument("--dictionary", help="姓名词表路径（每行一个词）")
    args = parser.parse_args(argv)

    rows = load_rows(Path(args.rows))
    dictionary: List[str] = []
    if args.dictionary:
        dictionary = [
            line.strip()
            for line in Path(args.dictionary).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    report = build_report(
        rows,
        quasi_identifiers=[item.strip() for item in args.quasi_identifiers.split(",") if item.strip()],
        min_k=args.min_k,
        sensitive=[item.strip() for item in args.sensitive.split(",") if item.strip()],
        min_l=args.min_l,
        dictionary=dictionary,
        source=str(args.rows),
    )
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.markdown:
        Path(args.markdown).write_text(render_markdown(report), encoding="utf-8")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
