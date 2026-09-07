"""CHINET 2024 中文年报 → normalized/chinet_baseline.parquet + chinet_composition.parquet.

提取策略（实测结论，见 data/MANIFEST.md）：
- 耐药率表（表2-表11）：**words 坐标聚类**重建——y 聚行、R/S 表头 token 作列锚点、
  组名按 x 序与 (n=…) 配对、数值按 x 最近锚点归列。三线表 find_tables 会丢行，此法完整。
- 菌种构成比（第4页 29×3 规整表）：直接用 find_tables（该表线条完整）。
- 互证门：表格数值 vs pymupdf4llm 正文叙述百分比交叉验证 + 地标断言（硬门）。
输出是合成数据 fallback 的分布先验入口（DATA-ACQUISITION.md §7）。
"""
import math
import re
import sys

import fitz
import pandas as pd
import pymupdf4llm

PDF = "data/raw/chinet/CHINET-2024-中国细菌耐药监测.pdf"
OUT_RATE = "data/normalized/chinet_baseline.parquet"
OUT_COMP = "data/normalized/chinet_composition.parquet"
SOURCE = "CHINET-2024-CN"

Y_TOL = 3  # y 聚类容差(pt)

# 已在正文/表格互证过的地标（提取器正确性的硬门）
# 人工核对修正（G2, 2026-08-16，渲染原 PDF 8x 逐格核实）
FIXUPS = {
    # p7 表7 Group F×Clindamycin：原 PDF 排印错误（R=92.1 + S=93.5 >100 物理不可能；文本层/视觉/坐标三方确认）
    ("Group F", "Clindamycin"): {"note": "原PDF排印错误：R+S>100，S=93.5 不可信，作先验时禁用该格"},
    # p6 表5 第4列（n=1664）：列头词粘连未解析出组名，锚点定位=成人 PSSP
    ("?", None): {"group": "adults PSSP"},
}

LANDMARKS = [
    ("MRSA", "Clindamycin", "R", 53.8),
    ("E. faecium", "Ampicillin", "R", 91.4),
    ("E. faecalis", "Ampicillin", "R", 1.6),
]


def has_cjk(s: str) -> bool:
    # 注意：全角括号（）不算 CJK——(n=… token 以全角括号开头，是组解析的关键分隔符
    return any("\u4e00" <= c <= "\u9fff" for c in s)


def is_num(s: str) -> bool:
    return bool(re.fullmatch(r"\d+\.?\d*", s))


def page_rows(page):
    """y 聚类成行，行内按 x 排序。返回 [(yc, [(x0,x1,token), ...]), ...]"""
    from collections import defaultdict
    rows = defaultdict(list)
    for w in page.get_text("words"):
        rows[round((w[1] + w[3]) / 2 / Y_TOL) * Y_TOL].append(w)
    return [(yc, sorted(ws, key=lambda w: w[0])) for yc, ws in sorted(rows.items())]


def parse_groups(header_words, header_rows, anchors):
    """锚点边界分配：组 k 的名字/n 词 = x 中心落在组 k 锚点区间内的表头词。
    标题行（含 'Susceptibility'/'Table'/'表'）整行剔除，避免两栏正文与居中标题桥接。"""
    n_groups = len(anchors) // 2
    centers = [(anchors[2 * k][0] + anchors[2 * k + 1][0]) / 2 for k in range(n_groups)]
    bounds = []
    for k in range(n_groups):
        lo = (centers[k - 1] + centers[k]) / 2 if k > 0 else centers[0] - 60
        hi = (centers[k] + centers[k + 1]) / 2 if k < n_groups - 1 else centers[-1] + 60
        bounds.append((lo, hi))

    SKIP = {"R", "S", "a", "（%", "(%)", "（%）"}
    # 收集词：跳过标题行整行
    words = []
    for ws in header_rows:
        line = " ".join(w[4] for w in ws)
        if "Susceptibility" in line or any(t.startswith(("Table", "表")) for t in (w[4] for w in ws)):
            continue
        for w in ws:
            t = w[4]
            if has_cjk(t) or t in SKIP or "≥" in t or "≤" in t or t in ("Antimicrobial", "agent"):
                continue
            words.append(w)

    groups = [[] for _ in range(n_groups)]
    for w in words:
        xc = (w[0] + w[2]) / 2
        k = min(range(n_groups), key=lambda g: abs(centers[g] - xc)) if not (bounds[0][0] <= xc < bounds[-1][1]) else next(g for g, (lo, hi) in enumerate(bounds) if lo <= xc < hi)
        groups[k].append(w[4])

    # n 值独立归组：'（n=' 起始 token 按最近组中心，后续数字 token 强制跟随（防 bounds 切断）
    n_vals = [None] * n_groups
    cur = None
    for ws in header_rows:
        for w in ws:
            t = w[4]
            if "n=" in t:
                xc = (w[0] + w[2]) / 2
                cur = min(range(n_groups), key=lambda g: abs(centers[g] - xc))
                n_vals[cur] = re.findall(r"\d", t)
            elif cur is not None and re.match(r"^[\d（）()]", t):
                n_vals[cur] += re.findall(r"\d", t)
                if t.endswith(("）", ")")) or not re.search(r"[\d]$", t):
                    cur = None

    out = []
    for k, toks in enumerate(groups):
        # 剥离数字/括号前后缀：'344）E.'→'E.'，'055）Acinetobacter'→'Acinetobacter'
        cleaned = []
        for t in toks:
            if "n=" in t:
                continue  # n token 不进组名
            t2 = re.sub(r"^[\d（）()]+|[\d（）()]+$", "", t)
            if t2:
                cleaned.append(t2)
        name = " ".join(cleaned)
        out.append((name or "?", int("".join(n_vals[k])) if n_vals[k] else None))

    # 拉丁双名切半修复：组名以属名缩写结尾且下一组以小写开头 → 缩写移交
    for k in range(len(out) - 1):
        if re.search(r"\b[A-Z]\.$", out[k][0]) and out[k + 1][0][:1].islower():
            head, tail = out[k][0].rstrip().rsplit(" ", 1)
            out[k] = (head, out[k][1])
            out[k + 1] = (tail + " " + out[k + 1][0], out[k + 1][1])
    return out


def digits(parts):
    d = "".join(re.findall(r"\d", "".join(parts)))
    return int(d) if d else None


def find_table_title(rows, idx):
    """在表头上方向上找最近的 '表N/Table N' 行。"""
    for yc, ws in reversed(rows[:idx]):
        line = " ".join(w[4] for w in ws)
        m = re.search(r"(?:表|Table)\s*(\d+)", line)
        if m and ("Susceptibility" in line or not has_cjk(line.replace(m.group(0), ""))):
            return int(m.group(1)), line[:80]
    return None, ""


def extract_rate_tables(doc):
    records, warnings = [], []
    for pno in range(3, 11):
        rows = page_rows(doc[pno])
        i = 0
        while i < len(rows):
            yc, ws = rows[i]
            tokens = [w[4] for w in ws]
            # R/S 锚点行：R/S 交替且无数字
            if tokens.count("R") >= 2 and tokens.count("S") >= 2 and not any(is_num(t) for t in tokens):
                anchors = [( (w[0]+w[2])/2, w[4]) for w in ws if w[4] in ("R", "S")]
                # 组头 = 上方向上 3 行内含非 CJK 词组名的行（合并）
                header_rows = [pw for _, pw in rows[max(0, i-5):i]]
                groups = parse_groups(None, header_rows, anchors)
                table_no, _ = find_table_title(rows, i)
                if any(g[0] == "?" for g in groups):
                    warnings.append(f"p{pno+1} y={yc}: 存在未命名列组: {[g for g in groups if g[0]=='?']}")
                # 数据行：首 token 纯 ASCII 词，行内无 CJK，≥2 个数值/NA。
                # 双栏排版：跳过完全位于表格左锚点左侧的正文行（预算 6 行连续跳过）
                j = i + 1
                skip_budget = 6
                tbl_x0 = min(a[0] for a in anchors) - 15
                while j < len(rows):
                    dws = rows[j][1]
                    dtoks = [w[4] for w in dws]
                    if dws and all(w[2] < tbl_x0 for w in dws):
                        skip_budget -= 1
                        if skip_budget <= 0:
                            break
                        j += 1
                        continue
                    nums = [w for w in dws if is_num(w[4]) or w[4] == "NA"]
                    if not dtoks or has_cjk("".join(dtoks)) or len(nums) < 2 \
                       or not re.match(r"^[A-Za-z][\w\-]*$", dtoks[0]):
                        break
                    # 药名 = 首个数值前的全部非数值 token（Penicillin G 类）
                    name_parts = []
                    val_words = []
                    for w in dws:
                        if is_num(w[4]) or w[4] == "NA":
                            val_words.append(w)
                        elif val_words:
                            val_words.append(w)  # 数值后的杂 token（罕见）
                        else:
                            name_parts.append(w[4])
                    antibiotic = " ".join(name_parts)
                    # 数值按最近锚点归列
                    col_vals = {}
                    for w in val_words:
                        if not (is_num(w[4]) or w[4] == "NA"):
                            continue
                        xc = (w[0] + w[2]) / 2
                        k = min(range(len(anchors)), key=lambda a: abs(anchors[a][0] - xc))
                        col_vals[k] = w[4]
                    if len(col_vals) < 2:
                        break
                    for k, raw in col_vals.items():
                        gi = k // 2 if k // 2 < len(groups) else None
                        gname = groups[gi][0] if gi is not None else f"?col{k}"
                        n_iso = groups[gi][1] if gi is not None else None
                        records.append(dict(
                            page=pno + 1, table_no=table_no, group=gname, n_isolates=n_iso,
                            antibiotic=antibiotic, indicator=anchors[k][1],
                            value_pct=float(raw) if is_num(raw) else None,
                            raw=raw, source=SOURCE,
                        ))
                    j += 1
                i = j
            else:
                i += 1
    return pd.DataFrame(records), warnings


def extract_composition(doc):
    """第4页表1 菌种构成比（右栏，与左栏正文混排）。
    列锚点：菌名 x∈[315,470]，株数 x∈[477,497]（两 token 拼接），构成比 x≥500。
    跨 y 行菌名（Klebsiella/spp）由"无数据的名字行并入下一条记录"处理。"""
    HDR = {"Table", "Distribution", "of", "bacterial", "species", "Organism", "No.", "strains", "%", "in", "2024"}

    def cols(ws):
        name = [w[4] for w in ws if 315 <= w[0] < 470 and w[4] not in ("a", "b") and w[4] not in HDR and not w[4].isdigit()]
        n_tok = [w[4] for w in ws if 477 <= w[0] < 497 and w[4].isdigit()]
        pct_tok = [w[4] for w in ws if w[0] >= 500 and re.fullmatch(r"\d+\.?\d*", w[4])]
        return name, n_tok, pct_tok

    recs, pending = [], []
    for _, ws in page_rows(doc[3]):
        name, n_tok, pct_tok = cols(ws)
        if n_tok and pct_tok:
            recs.append(dict(organism=" ".join(pending + name),
                             n_strains=int("".join(n_tok)),
                             pct=float(pct_tok[0]), source=SOURCE))
            pending = []
        elif name and all(w[0] >= 315 for w in ws):
            pending += name
    return pd.DataFrame(recs)


def corroboration_gate(df):
    """互证门：① 地标断言（硬门）② 表格数值在正文百分比中的复现率（软指标）。"""
    md = pymupdf4llm.to_markdown(PDF, show_progress=False)
    narrative = {round(float(x), 1) for x in re.findall(r"(\d+\.?\d*)%", md)}
    ok = True
    for group, abx, ind, val in LANDMARKS:
        hit = df[(df.group == group) & (df.antibiotic.str.startswith(abx)) &
                 (df.indicator == ind) & (df.value_pct == val)]
        status = "PASS" if len(hit) else "FAIL"
        if hit.empty:
            ok = False
        print(f"  地标 {group}×{abx}×{ind}={val}: {status}")
    vals = df.value_pct.dropna().round(1)
    seen = set(vals)
    matched = sum(1 for v in seen if v in narrative)
    print(f"  正文复现：{matched}/{len(seen)} 个不同表值出现在正文叙述百分比中（{matched/len(seen):.0%}）")
    return ok


def main():
    doc = fitz.open(PDF)
    df, warnings = extract_rate_tables(doc)
    comp = extract_composition(doc)
    doc.close()

    # 应用人工核对修正
    df["note"] = ""
    for (grp, abx), fix in FIXUPS.items():
        mask = (df.group == grp) & (df.antibiotic.str.startswith(abx) if abx else True)
        for col, val in fix.items():
            df.loc[mask, col] = val
    df.to_parquet(OUT_RATE, index=False)
    comp.to_parquet(OUT_COMP, index=False)
    print(f"chinet_baseline.parquet: {len(df)} 行（{df.group.nunique()} 组 × {df.antibiotic.nunique()} 药）")
    print(f"chinet_composition.parquet: {len(comp)} 行")
    print(f"\n警告（锚点/组数不齐，需人工看）: {len(warnings)}")
    for w in warnings:
        print("  ⚠", w)
    # R+S>100 一致性门（S/I/R 三分类，R+S≤100 恒成立；>100 即提取错位）
    piv = df.pivot_table(index=["page", "table_no", "group", "antibiotic"], columns="indicator", values="value_pct")
    piv["sum"] = piv.get("R", 0) + piv.get("S", 0)
    over = piv[piv["sum"] > 100.15]
    print(f"\nR+S>100 错位检查: {len(over)}/ {len(piv)}（须人工核对）")
    for idx, row in over.iterrows():
        print(f"  ⚠ {idx} R={row.get('R')} S={row.get('S')}")
    print("\n互证门:")
    gate_ok = corroboration_gate(df)
    print(f"\n质量门结论: {'PASS' if gate_ok and not warnings else 'REVIEW'}"
          f"（地标{'✓' if gate_ok else '✗'}，警告{len(warnings)}条）")


if __name__ == "__main__":
    main()
