#!/usr/bin/env python3
"""申报书字数与口径自检（无第三方依赖）。

用法： python3 scripts/check-shenbao-words.py
对 docs/申报书/ 下的报送版逐节统计中文字符数（去空白、去 Markdown 表格），
按模板上限判定 PASS/FAIL；并检查内部口径词与"真实机构部署"类越界表述。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHENBAO = ROOT / "docs" / "申报书"

# 每份报送版：文件 -> [(节名, 起始正则, 结束正则, 上限字数)]
SPECS: dict[str, list[tuple[str, str, str, int]]] = {
    "01-报送版-国家行业模板.md": [
        ("二（一）主体基本情况", r"^### （一）试点申报单位基本情况", r"^### （二）", 1000),
        ("二（三）已开展工作", r"^### （三）已开展工作", r"^## 三、", 1000),
        ("三、试点目标（叙述）", r"^## 三、试点目标", r"^## 四、", 1000),
        ("五、试点方案", r"^## 五、试点方案", r"^## 六、", 15000),
    ],
    "02-报送版-2026省级模板.md": [
        ("二（一）主体基本情况", r"^### （一）试点申报单位基本情况", r"^### （二）", 1000),
        ("二（三）已开展工作", r"^### （三）已开展工作", r"^## 三、", 1000),
        ("三、试点总体思路", r"^## 三、试点总体思路", r"^## 四、", 3000),
    ],
}

# 内部口径词：报送版中不得出现
FORBIDDEN = [
    "填报红线", "技术上不可以说", "不得虚报", "演示已具备", "未作为已交付",
    "本填报稿", "本文件如何使用", "不得与多主体联合", "内部版",
]
# 越界表述：不得声称真实机构部署（除"尚无/未/演示"等否定语境）
OVERCLAIM = re.compile(r"(已接入|已部署|已上线)[^。；\n]{0,12}?(\d+|[一二三四五六七八九十]+)\s*家(医院|医疗机构|疾控)")


def strip_tables(text: str) -> str:
    keep = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("|") or re.fullmatch(r"[-=]{5,}", s):
            continue
        keep.append(line)
    return "\n".join(keep)


def count_chars(text: str) -> int:
    t = strip_tables(text)
    t = re.sub(r"^#+\s*", "", t, flags=re.M)
    t = t.replace("*", "").replace("`", "")
    return len(re.sub(r"\s", "", t))


def slice_section(lines: list[str], start_pat: str, end_pat: str) -> str:
    si = ei = None
    for i, line in enumerate(lines):
        if si is None and re.search(start_pat, line):
            si = i
        elif si is not None and re.search(end_pat, line):
            ei = i
            break
    if si is None:
        return ""
    return "\n".join(lines[si:ei])


def main() -> int:
    failures = 0
    for fname, specs in SPECS.items():
        path = SHENBAO / fname
        if not path.exists():
            print(f"[SKIP] 缺少 {fname}")
            failures += 1
            continue
        raw = path.read_text(encoding="utf-8")
        lines = raw.splitlines()
        print(f"\n=== {fname} ===")
        for name, sp, ep, limit in specs:
            seg = slice_section(lines, sp, ep)
            if not seg:
                print(f"  [FAIL] {name}: 未定位到章节")
                failures += 1
                continue
            n = count_chars(seg)
            ok = n <= limit
            failures += 0 if ok else 1
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {n} 字 / 上限 {limit}")

        for word in FORBIDDEN:
            if word in raw:
                print(f"  [FAIL] 出现内部口径词：{word}")
                failures += 1
        for m in OVERCLAIM.finditer(raw):
            ctx = raw[max(0, m.start() - 30): m.end() + 30].replace("\n", " ")
            if not re.search(r"尚无|尚未|未|不|演示|目标|待填", ctx):
                print(f"  [FAIL] 疑似越界表述：…{ctx}…")
                failures += 1

    print(f"\n{'全部通过' if failures == 0 else f'{failures} 项待修正'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
