"""CHINET composition cleaning + organism sampling weights."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

# CHINET 2024 构成比（由 composition raw + baseline n 交叉核对；core 合成用）
# pct 相对全国总分离株；合成时再归一化到所选菌种集合。
CORE_COMPOSITION = [
    # organism_whonet, chinet_group_for_rates, weight_n, phenotype
    {"organism": "eco", "rate_group": "E. coli", "n": 83632, "phenotype": None},
    {"organism": "kpn", "rate_group": "Klebsiella spp", "n": 72674, "phenotype": None},
    {"organism": "sau", "rate_group": "MRSA", "n": 11750, "phenotype": "MRSA"},
    {"organism": "sau", "rate_group": "MSSA", "n": 29589, "phenotype": "MSSA"},
    {"organism": "aba", "rate_group": "Acinetobacter", "n": 36802, "phenotype": None},
    {"organism": "pae", "rate_group": "P. aeruginosa", "n": 35055, "phenotype": None},
    {"organism": "efm", "rate_group": "E. faecium", "n": 17929, "phenotype": None},
    {"organism": "efa", "rate_group": "E. faecalis", "n": 15344, "phenotype": None},
]


@dataclass(frozen=True)
class OrganismDraw:
    organism: str
    rate_group: str
    phenotype: str | None


def composition_frame() -> pd.DataFrame:
    df = pd.DataFrame(CORE_COMPOSITION)
    df["p"] = df["n"] / df["n"].sum()
    return df


def sample_organism(rng, tilt: dict[str, float] | None = None) -> OrganismDraw:
    """Polynomial sample over core composition, with optional organism_whonet tilts."""
    df = composition_frame().copy()
    if tilt:
        for org, mult in tilt.items():
            df.loc[df.organism == org, "p"] *= mult
        df["p"] = df["p"] / df["p"].sum()
    row = df.iloc[int(rng.choice(len(df), p=df["p"].to_numpy()))]
    return OrganismDraw(
        organism=str(row.organism),
        rate_group=str(row.rate_group),
        phenotype=None if pd.isna(row.phenotype) else str(row.phenotype),
    )
