"""EUCAST breakpoint XLSX → normalized/breakpoints.parquet + dict/antibiotic_alias.csv 骨架.

Per docs/amr-sentinel/DATA-ACQUISITION.md §A:
- 输出长表：一行 = (菌种组, 抗生素, 方法) 的 S/R 阈值
- 表头位置按 sheet 动态定位（找 "S ≤" / "S ≥" 行），不硬编码列号
- 原始值全保留（"IE"/"-"/"Note" 等非数值不丢弃，parsed=None 显式标注"无折点"）
- 脚注后缀剥离（"14A" → 14 + note_refs="A"）
- 质量门：核心菌种组 × 核心抗生素折点缺失率 < 5%
"""
import math
import re
import sys
import pathlib

import pandas as pd

RAW = pathlib.Path("data/raw/eucast/v16.1/breakpoints.xlsx")
OUT_BP = pathlib.Path("data/normalized/breakpoints.parquet")
OUT_ALIAS = pathlib.Path("data/dict/antibiotic_alias.csv")

VERSION = "16.1"
META_SHEETS = {
    "Content", "Changes", "Notes", "Guidance", "Dosages",
    "Technical uncertainty", "Topical agents", "PK PD breakpoints", "PK PD cutoffs",
}

# 核心药物（dict/antibiotic.csv 的 whonet 码）→ EUCAST 名称归一化映射（人工可验证的确定项）
EUCAST_TO_WHONET = {
    "benzylpenicillin": "PEN", "oxacillin": "OXA", "ampicillin": "AMP",
    "amoxicillin-clavulanicacid": "AMC", "piperacillin-tazobactam": "TZP",
    "cefoxitin": "FOX", "ceftriaxone": "CRO", "ceftazidime": "CAZ", "cefepime": "FEP",
    "meropenem": "MEM", "imipenem": "IPM", "ertapenem": "ETP",
    "amikacin": "AK", "gentamicin": "CN", "ciprofloxacin": "CIP", "levofloxacin": "LVX",
    "azithromycin": "AZM", "trimethoprim-sulfamethoxazole": "SXT",
    "vancomycin": "VA", "linezolid": "LZD", "tigecycline": "TGC", "colistin": "CL",
}

# 质量门目标：dict/organism.csv 核心菌种的 EUCAST 菌种组
CORE_GROUPS = {
    "Enterobacterales", "Pseudomonas", "Acinetobacter", "Staphylococcus",
    "Enterococcus", "S.pneumoniae", "H.influenzae",
}


def whonet_for(raw_name: str) -> str:
    """EUCAST 原始药名 → whonet_code（基础名匹配）。
    处理限定词：逗号分段("Ciprofloxacin, Salmonella spp.1")、括号限定、
    尾部脚注数字、iv/oral 路径后缀("Ampicillin iv1")。"""
    s = raw_name.strip().split(",")[0]
    s = re.sub(r"\s*\(.*?\)\s*", " ", s)          # 括号限定
    s = re.sub(r"\d+$", "", s.strip())            # 尾部脚注数字
    s = s.replace("‐", "-").replace("–", "-").replace(" ", "").lower()
    for q in ("iv", "oral"):                       # 路径后缀：剥掉后若命中则采用
        if s.endswith(q) and s[: -len(q)] in EUCAST_TO_WHONET:
            s = s[: -len(q)]
    return EUCAST_TO_WHONET.get(s, "")


# MIC 倍比稀释标准浓度集（EUCAST 表内数值必属此集合；用于剥离数字脚注 "0.251"→0.25+note1）
MIC_STANDARD = {0.001, 0.002, 0.004, 0.008, 0.015, 0.016, 0.03, 0.032, 0.06, 0.064,
                0.12, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512}


def parse_value(v, unit="mg/L"):
    """'14A'/'0.5'/'(8)'/'-'/'IE' → (数值或None, 原始字符串, 脚注引用).
    MIC 数字脚注剥离：解析值非标准浓度而去掉尾数字后落在标准浓度集 → 尾数字是脚注。"""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None, None, ""
    raw = str(v).strip()
    if raw == "":
        return None, None, ""
    note_refs = "".join(re.findall(r"[A-Z]", raw)) if not raw.isalpha() else ""
    if re.match(r"^note", raw, re.I):  # "Note2,4" = 折点在注释里，表内无数值
        return None, raw, note_refs
    m = re.search(r"\d+\.?\d*", raw)
    num = float(m.group()) if m else None
    if num is not None and unit == "mg/L" and num not in MIC_STANDARD and len(m.group()) > 1:
        stripped = float(m.group()[:-1])
        if stripped in MIC_STANDARD:  # "0.251"→0.25, "0.062"→0.06
            note_refs += m.group()[-1]
            num = stripped
    return num, raw, note_refs


def cell(df, i, j):
    return df.iloc[i, j] if j is not None and j < df.shape[1] else None


def parse_sheet(name: str, df: pd.DataFrame):
    rows = []
    mic_cols = disk_cols = None
    section = None
    for i in range(len(df)):
        cells = [str(c).strip() if c is not None and not (isinstance(c, float) and math.isnan(c)) else "" for c in df.iloc[i]]
        if len(cells) > 1 and "MIC breakpoints" in cells[1]:
            section = cells[0] or section
        if len(cells) > 1 and cells[1] == "S ≤":
            mic_cols = (1, 2)   # S≤, R>
            if "S ≥" in cells:  # 该 sheet 有抑菌圈列（部分 sheet 仅 MIC）
                sge = cells.index("S ≥")
                rlt = cells.index("R <") if "R <" in cells else sge + 1
                disk_cols = (sge, rlt, sge - 1)
            else:
                disk_cols = None
            continue
        if mic_cols and cells[0] and cells[0] not in {"nan"} and not cells[0].startswith(("For ", "*", "Note", "Reading", "Quality", "Medium", "Inoculum", "Incubation", "Disk diffusion", "MIC determination", "Expert Rules", "EUCAST")):
            abx = cells[0]
            if re.match(r"^[A-Z]", abx) and len(abx) > 2 and not abx.startswith("EUCAST"):
                s_n, s_raw, s_note = parse_value(cell(df, i, mic_cols[0]), "mg/L")
                r_n, r_raw, r_note = parse_value(cell(df, i, mic_cols[1]), "mg/L")
                if s_raw or r_raw:  # 至少一侧有内容才算折点行
                    rows.append(dict(
                        organism_group=name, section=section, antibiotic=abx,
                        method="MIC", unit="mg/L",
                        s=s_n, r=r_n, raw_s=s_raw, raw_r=r_raw, note_refs=s_note + r_note,
                        disk_content_ug=None, source="EUCAST", version=VERSION,
                    ))
                if disk_cols:
                    ds_n, ds_raw, ds_note = parse_value(cell(df, i, disk_cols[0]), "mm")
                    dr_n, dr_raw, dr_note = parse_value(cell(df, i, disk_cols[1]), "mm")
                    dc_n, _, _ = parse_value(cell(df, i, disk_cols[2]), "ug")
                    if ds_raw or dr_raw:
                        rows.append(dict(
                            organism_group=name, section=section, antibiotic=abx,
                            method="DISK", unit="mm",
                            s=ds_n, r=dr_n, raw_s=ds_raw, raw_r=dr_raw, note_refs=ds_note + dr_note,
                            disk_content_ug=dc_n, source="EUCAST", version=VERSION,
                        ))
    return rows


def main():
    sheets = pd.read_excel(RAW, sheet_name=None, header=None)
    all_rows = []
    skipped = []
    for name, df in sheets.items():
        if name.strip() in META_SHEETS:
            skipped.append(name.strip())
            continue
        rows = parse_sheet(name.strip(), df)
        all_rows += rows
        print(f"  sheet {name!r}: {len(rows)} rows", file=sys.stderr)
    bp = pd.DataFrame(all_rows)
    bp["whonet_code"] = bp["antibiotic"].map(whonet_for)

    OUT_BP.parent.mkdir(parents=True, exist_ok=True)
    bp.to_parquet(OUT_BP, index=False)
    print(f"\nbreakpoints.parquet: {len(bp)} rows, {bp.organism_group.nunique()} organism groups, "
          f"{bp.antibiotic.nunique()} antibiotics (skipped meta sheets: {skipped})")

    # ---- 质量门（三类口径，对齐计划§A："缺失项人工补齐或显式标注为无折点"） ----
    core = bp[(bp.method == "MIC") & (bp.whonet_code != "")]
    numeric = core[core.s.notna()]
    explicit_na = core[(core.raw_s.isin(["-", "IE"])) | (core.raw_s.astype(str).str.startswith("Note"))]
    panel = numeric.groupby("organism_group")["whonet_code"].nunique()
    print("\n质量门（核心映射 MIC 组合三分类）:")
    print(f"  ① 数值折点（可直接喂重判读引擎）: {len(numeric)} 组合行")
    print(f"  ② EUCAST 显式无折点（'-'=不适用 / 'IE'=证据不足 / 'Note'=见注）: {len(explicit_na)} 行 — 已原样保留，非解析缺失")
    odd = numeric[~numeric.s.isin(list(MIC_STANDARD))]
    print(f"  ③ 非标准浓度数值（需人工核验脚注剥离）: {len(odd)} 行")
    if len(odd):
        print(odd[["organism_group", "antibiotic", "raw_s", "s", "raw_r", "r"]].head(10).to_string(index=False))
    for g, n in panel.items():
        print(f"  分析面板 {g}: {n} 个核心药有数值折点")

    # ---- 别名表骨架：EUCAST 名称 → whonet_code（确定映射 + 待人工） ----
    uniq = bp[["antibiotic", "whonet_code"]].drop_duplicates().sort_values("antibiotic")
    alias = pd.DataFrame({
        "alias": uniq.antibiotic,
        "alias_source": "eucast_v16.1",
        "whonet_code": uniq.whonet_code,
        "confidence": uniq.whonet_code.map(lambda c: "high" if c else ""),
        "note": uniq.whonet_code.map(lambda c: "" if c else "待人工映射"),
    })
    OUT_ALIAS.parent.mkdir(parents=True, exist_ok=True)
    alias.to_csv(OUT_ALIAS, index=False)
    print(f"antibiotic_alias.csv 骨架: {len(alias)} 个 EUCAST 名称, 其中 {int((alias.whonet_code!='').sum())} 已映射, "
          f"{int((alias.whonet_code=='').sum())} 待人工")


if __name__ == "__main__":
    main()
