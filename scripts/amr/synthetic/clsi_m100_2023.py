"""CLSI M100 ED33 (2023) 折点常量 — 合成数据"华山院"本院判读用（G4）.

⚠️ 用途与边界：
- 仅用于合成数据的"本院判读"标签生成（演示跨体系重判读价值），不用于任何真实临床判读。
- CLSI M100 是收费版权文档，本表不公开分发；数值本身按事实录入。
- verified 分级：
  * True  = 2026-08-16 经公开来源核实（CLSI 官方博客/Sader 2023 PMC9969732）
  * False = 常识记忆录入，未经本次核实（dict v1 审校时应逐条对照原件）
- 未收录组合 → 回退 EUCAST v16.1 数值（breakpoints.parquet），生成器在输出标注 bp_source。

已核实来源：
- CLSI Insights: Cefepime Reporting Strategies (clsi.org)
- Sader et al. 2023 (PMC9969732): ED33 阿米卡星折点修订（肠杆菌目与铜绿假单胞菌 S≤4 / R≥16）
"""

# (organism_group, whonet_code) -> dict(s=, r=, verified=, note=)
CLSI_BP = {
    # ── Enterobacterales ──────────────────────────────────────────
    ("Enterobacterales", "FEP"): dict(s=2.0, r=16.0, verified=True, note="SDD 2-8 高剂量"),
    ("Enterobacterales", "CAZ"): dict(s=4.0, r=16.0, verified=True, note=""),
    ("Enterobacterales", "CIP"): dict(s=0.25, r=1.0, verified=True, note=""),
    ("Enterobacterales", "AK"): dict(s=4.0, r=16.0, verified=True, note="ED33 修订（原≤16/≥64）"),
    ("Enterobacterales", "AMP"): dict(s=8.0, r=32.0, verified=False, note=""),
    ("Enterobacterales", "AMC"): dict(s=8.0, r=32.0, verified=False, note="口服"),
    ("Enterobacterales", "TZP"): dict(s=16.0, r=128.0, verified=False, note="恒定 TZ 4"),
    ("Enterobacterales", "CRO"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Enterobacterales", "MEM"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Enterobacterales", "IPM"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Enterobacterales", "ETP"): dict(s=0.5, r=2.0, verified=False, note=""),
    ("Enterobacterales", "CN"): dict(s=4.0, r=16.0, verified=False, note=""),
    ("Enterobacterales", "LVX"): dict(s=0.5, r=2.0, verified=False, note="R 界不确定(≥2 or ≥4)"),
    ("Enterobacterales", "SXT"): dict(s=2.0, r=4.0, verified=False, note="TMP 部分, SMX 76"),
    # ── Pseudomonas ───────────────────────────────────────────────
    ("Pseudomonas", "AK"): dict(s=4.0, r=16.0, verified=True, note="ED33 修订"),
    ("Pseudomonas", "CAZ"): dict(s=8.0, r=32.0, verified=False, note=""),
    ("Pseudomonas", "FEP"): dict(s=8.0, r=32.0, verified=False, note=""),
    ("Pseudomonas", "CIP"): dict(s=0.5, r=4.0, verified=False, note=""),
    ("Pseudomonas", "LVX"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Pseudomonas", "MEM"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Pseudomonas", "IPM"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Pseudomonas", "TZP"): dict(s=16.0, r=128.0, verified=False, note=""),
    ("Pseudomonas", "CN"): dict(s=4.0, r=16.0, verified=False, note=""),
    ("Pseudomonas", "CL"): dict(s=2.0, r=4.0, verified=False, note="CBPN"),
    # ── Staphylococcus (S. aureus) ────────────────────────────────
    ("Staphylococcus", "PEN"): dict(s=0.12, r=0.25, verified=False, note=""),
    ("Staphylococcus", "OXA"): dict(s=2.0, r=4.0, verified=False, note=""),
    ("Staphylococcus", "VA"): dict(s=2.0, r=16.0, verified=False, note="VISA 4-8"),
    ("Staphylococcus", "LZD"): dict(s=4.0, r=8.0, verified=False, note=""),
    ("Staphylococcus", "CIP"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Staphylococcus", "LVX"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Staphylococcus", "CN"): dict(s=4.0, r=16.0, verified=False, note=""),
    ("Staphylococcus", "SXT"): dict(s=2.0, r=4.0, verified=False, note="TMP 部分"),
    ("Staphylococcus", "ERY"): dict(s=0.5, r=4.0, verified=False, note="dict v0 外"),
    ("Staphylococcus", "CLI"): dict(s=0.5, r=4.0, verified=False, note="dict v0 外; D 试验"),
    # ── Enterococcus ──────────────────────────────────────────────
    ("Enterococcus", "AMP"): dict(s=8.0, r=16.0, verified=False, note="faecalis"),
    ("Enterococcus", "VA"): dict(s=4.0, r=16.0, verified=False, note=""),
    ("Enterococcus", "LZD"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Enterococcus", "TGC"): dict(s=0.25, r=0.5, verified=False, note=""),
    ("Enterococcus", "CN-HL"): dict(s=None, r=500.0, verified=False, note="HLAR 筛选 500mg/L"),
    # ── Acinetobacter ─────────────────────────────────────────────
    ("Acinetobacter", "MEM"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Acinetobacter", "IPM"): dict(s=2.0, r=8.0, verified=False, note=""),
    ("Acinetobacter", "CAZ"): dict(s=8.0, r=32.0, verified=False, note=""),
    ("Acinetobacter", "FEP"): dict(s=8.0, r=32.0, verified=False, note=""),
    ("Acinetobacter", "CIP"): dict(s=1.0, r=4.0, verified=False, note=""),
    ("Acinetobacter", "CN"): dict(s=4.0, r=16.0, verified=False, note=""),
    ("Acinetobacter", "SXT"): dict(s=2.0, r=4.0, verified=False, note=""),
    ("Acinetobacter", "CL"): dict(s=2.0, r=4.0, verified=False, note="CBPN"),
}


def interpret(organism_group: str, whonet_code: str, mic: float):
    """本院判读：S/I/R。未收录 → ('EUCAST_FALLBACK', reason) 由调用方用 EUCAST 表判读。"""
    bp = CLSI_BP.get((organism_group, whonet_code))
    if bp is None or bp["s"] is None:
        return None, "EUCAST_FALLBACK"
    if mic <= bp["s"]:
        return "S", "CLSI"
    if mic > bp["r"] if bp["r"] else False:
        return "R", "CLSI"
    return "I", "CLSI"


if __name__ == "__main__":
    n = len(CLSI_BP)
    v = sum(1 for b in CLSI_BP.values() if b["verified"])
    print(f"CLSI 常量: {n} 组合, verified {v}, unverified {n - v}（EUCAST 回退兜底）")
