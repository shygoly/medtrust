"""合成数据先验装载（G1）：CHINET parquet + dict + breakpoints → 生成器可用形态.

映射原则：dict/organism.csv、antibiotic.csv 已有的码直接用（status=dict）；
CHINET 有而 dict v0 没有的，给稳定内部码并标 status=pending-v1（字典 v1 审校时收编，不臆造）。
"""
import pathlib

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[3]
D = ROOT / "data" / "normalized"
DICT = ROOT / "data" / "dict"

# ── 构成比：CHINET 表1 菌名 → 生成器编码 ──────────────────────────────
COMP_ORG_MAP = {
    "Escherichia coli": ("eco", "dict"),
    "Klebsiella spp": ("kpn", "dict"),            # 属级近似（CHINET 报属）
    "Staphylococcus aureus": ("sau", "dict"),
    "Acinetobacter spp": ("aba", "dict"),
    "Enterococcus spp": ("ent", "pending-v1"),    # 生成时按正文 42.1/49.1/8.8 拆 efa/efm/其他
    "Pseudomonas aeruginosa": ("pae", "dict"),
    "Haemophilus influenzae": ("hin", "dict"),
    "Coagulase-negative Staphylococcus": ("scn", "pending-v1"),
    "β-hemolytic Streptococcus": ("bhs", "pending-v1"),
    "Stenotrophomonas maltophilia": ("smm", "pending-v1"),
    "Enterobacter spp": ("enc", "pending-v1"),
    "Streptococcus pneumoniae": ("spn", "dict"),
    "Moraxella catarrhalis": ("mca", "pending-v1"),
    "Proteus spp": ("prp", "pending-v1"),
    "Serratia spp": ("srs", "pending-v1"),
    "S. viridans": ("svi", "pending-v1"),
    "Salmonella spp": ("sal", "pending-v1"),
    "Citrobacter spp": ("cit", "pending-v1"),
    "Burkholderia cepacia": ("bce", "pending-v1"),
    "Morganella spp": ("mgn", "pending-v1"),
    "Providencia spp": ("pvd", "pending-v1"),
}
# 罕见菌种子（Q2 用）：构成比表尾的小菌 + Others 之外手工指定
RARE_POOL = [
    ("Achromobacter xylosoxidans", "axl"),
    ("Elizabethkingia meningosepticum", "emn"),
    ("Chryseobacterium indologenes", "cin"),
    ("Neisseria gonorrhoeae", "ngo"),
]

# ── 耐药率：baseline 组名 → (菌码, 分层) ─────────────────────────────
RATE_GROUP_MAP = {
    "MRSA": ("sau", "MRSA"), "MSSA": ("sau", "MSSA"),
    "MRSE": ("scn", "MRSE"), "MSSE": ("scn", "MSSE"),
    "MRCNS": ("scn", "MRCNS"), "MSCNS": ("scn", "MSCNS"),
    "E. faecalis": ("efa", ""), "E. faecium": ("efm", ""),
    "P. aeruginosa": ("pae", ""), "Acinetobacter": ("aba", ""),
    "E. coli": ("eco", ""), "Klebsiella spp": ("kpn", ""),
    "Enterobacter spp": ("enc", ""), "Citrobacter spp": ("cit", ""),
    "Morganella spp": ("mgn", ""), "Providencia spp": ("pvd", ""),
    "Proteus spp": ("prp", ""), "Serratia spp": ("srs", ""),
    "S. typhimurium": ("sal", "typhimurium"), "S. enteritidis": ("sal", "enteritidis"),
    "Group A": ("bhs", "A"), "Group B": ("bhs", "B"), "Group C": ("bhs", "C"),
    "Group F": ("bhs", "F"), "Group G": ("bhs", "G"), "S. viridans": ("svi", ""),
    "Total": ("__total__", ""),  # H.influenzae 表的总列，按 page/table 上下文特判
}
# spn/hin 的分层组名（表5/6/12），正则匹配
import re  # noqa: E402

SPN_STRATUM = re.compile(r"(children|adults)?.*(PSSP|PISP|PRSP)")
HIN_STRATUM = re.compile(r"(children|adults)", re.I)

# ── 抗生素：baseline 药名 → dict 码 ─────────────────────────────────
ABX_MAP = {
    "Penicillin G": "PEN", "Oxacillin": "OXA", "Ampicillin": "AMP",
    "Amoxicillin-clavulanic acid": "AMC", "Piperacillin-tazobactam": "TZP",
    "Cefoxitin": "FOX", "Ceftriaxone": "CRO", "Ceftazidime": "CAZ", "Cefepime": "FEP",
    "Meropenem": "MEM", "Imipenem": "IPM", "Ertapenem": "ETP",
    "Amikacin": "AK", "Gentamicin": "CN", "Gentamicin-High": "CN-HL",
    "Ciprofloxacin": "CIP", "Levofloxacin": "LVX", "Azithromycin": "AZM",
    "Trimethoprim-sulfamethoxazole": "SXT", "Vancomycin": "VA", "Linezolid": "LZD",
    "Tigecycline": "TGC", "Colistin": "CL",
    # dict v0 没有但 CHINET 常报（pending-v1）
    "Teicoplanin": "TEC*", "Rifampin": "RIF*", "Cefotaxime": "CTX*",
    "Aztreonam": "ATM*", "Fosfomycin": "FOS*", "Nitrofurantoin": "NIT*",
    "Chloramphenicol": "CHL*", "Moxifloxacin": "MXF*", "Clindamycin": "CLI*",
    "Erythromycin": "ERY*", "Rifampicin": "RIF*",
}

# 肠球菌属拆分（正文地标：粪肠 42.1% / 屎肠 49.1% / 其他 8.8%）
ENT_SPLIT = {"efa": 0.421, "efm": 0.491, "ent-other": 0.088}
# 金葡 MRSA 检出率（正文地标 28.4%），用于 sau = MRSA/MSSA 加权
MRSA_PREVALENCE = 0.284


def load_rate_prior() -> pd.DataFrame:
    """chinet_baseline → (organism_code, stratum, antibiotic_code, R, S, I, n)。
    排除勘误格（note 非空）。"""
    bp = pd.read_parquet(D / "chinet_baseline.parquet")
    bp = bp[bp.note == ""]
    rows = []
    for _, r in bp.iterrows():
        g = r.group
        org, strat = RATE_GROUP_MAP.get(g, (None, None))
        if org == "__total__" and r.table_no == 12:  # 流感嗜血杆菌表的总列
            org, strat = "hin", "total"
        if g in ("Isolates from children", "Isolates from adults") and r.table_no == 12:
            org, strat = "hin", g.split()[-1]
        if org is None:
            m = SPN_STRATUM.search(g)
            if m and r.table_no in (5, 6):
                org, strat = "spn", (m.group(1) or "") + m.group(2)
            elif "influenzae" in g or r.table_no == 12:
                org = "hin"
                m2 = HIN_STRATUM.search(g)
                strat = (m2.group(1) if m2 else "total")
            elif g in ("Total",) and r.table_no == 12:
                org, strat = "hin", "total"
            else:
                continue
        abx = ABX_MAP.get(r.antibiotic.strip())
        if not abx or r.indicator not in ("R", "S") or pd.isna(r.value_pct):
            continue
        rows.append(dict(organism=org, stratum=strat, antibiotic=abx,
                         indicator=r.indicator, value=r.value_pct / 100.0,
                         n=r.n_isolates))
    df = pd.DataFrame(rows).pivot_table(
        index=["organism", "stratum", "antibiotic", "n"],
        columns="indicator", values="value").reset_index()
    df["I"] = 1.0 - df.get("R", 0) - df.get("S", 1.0)
    return df


def load_composition_prior() -> pd.DataFrame:
    """chinet_composition → (code, name, pct_norm)，肠球菌拆分、剔除 Others/Total。"""
    comp = pd.read_parquet(D / "chinet_composition.parquet")
    comp = comp[~comp.organism.isin(["Others", "Total"])]
    recs = []
    for _, r in comp.iterrows():
        code, status = COMP_ORG_MAP.get(r.organism, (None, None))
        if code == "ent":
            for c, w in ENT_SPLIT.items():
                recs.append(dict(code=c, name=r.organism, pct=r.pct * w, status="pending-v1"))
        elif code:
            recs.append(dict(code=code, name=r.organism, pct=r.pct,
                             status="dict" if status == "dict" else "pending-v1"))
    df = pd.DataFrame(recs)
    df["pct_norm"] = df.pct / df.pct.sum()
    return df


def load_breakpoints() -> pd.DataFrame:
    """EUCAST v16.1 数值 MIC 折点（生成器 MIC 落点用）。"""
    bp = pd.read_parquet(D / "breakpoints.parquet")
    return bp[(bp.method == "MIC") & bp.s.notna() & (bp.whonet_code != "")]


if __name__ == "__main__":
    rate = load_rate_prior()
    comp = load_composition_prior()
    print(f"率先验: {len(rate)} 行, 菌 {rate.organism.nunique()} 种, 药 {rate.antibiotic.nunique()} 种")
    print(f"构成先验: {len(comp)} 行, pct_norm 和 = {comp.pct_norm.sum():.3f}")
    print("\n按菌的药数:")
    print(rate.groupby("organism").antibiotic.nunique().sort_values(ascending=False).to_string())
    print("\n构成 Top8:")
    print(comp.nlargest(8, "pct_norm")[["code", "pct_norm"]].to_string(index=False))
