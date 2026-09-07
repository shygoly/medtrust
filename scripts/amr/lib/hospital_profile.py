"""Dual-hospital heterogeneity profiles (华山 / 瑞金)."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HospitalProfile:
    hospital_id: str
    display_name: str
    # relative organism tilts (multipliers on composition p)
    organism_tilt: dict[str, float] = field(default_factory=dict)
    # global R-rate multiplier vs CHINET national prior
    resistance_tilt: float = 1.0
    icu_rate: float = 0.22
    # logit bias for empiric carbapenem vs BL/BLI
    carbapenem_preference: float = 0.0
    # rare phenotype boost for Q2 demo (aba+CRE-like)
    rare_cre_boost: float = 1.0
    specimen_weights: dict[str, float] = field(default_factory=dict)


HUASHAN = HospitalProfile(
    hospital_id="huashan",
    display_name="华山医院",
    organism_tilt={"aba": 1.25, "kpn": 1.15, "eco": 0.95},
    resistance_tilt=1.0,  # keep CHINET marginals; heterogeneity via mix/ICU/Rx
    icu_rate=0.30,
    carbapenem_preference=0.45,
    rare_cre_boost=0.08,  # Q2 unlock: keep raw rare in (0,5) at n≈5k; pair with ruijin
    specimen_weights={
        "BLOOD": 0.18,
        "SPUTUM": 0.32,
        "URINE": 0.28,
        "WOUND": 0.10,
        "CSF": 0.02,
        "STERILE_FLUID": 0.04,
        "RESP_RES": 0.04,
        "OTHER": 0.02,
    },
)

RUIJIN = HospitalProfile(
    hospital_id="ruijin",
    display_name="瑞金医院",
    organism_tilt={"aba": 0.90, "kpn": 0.95, "eco": 1.10, "pae": 1.10},
    resistance_tilt=1.0,
    icu_rate=0.20,
    carbapenem_preference=-0.10,
    rare_cre_boost=0.11,  # Q2 unlock: keep raw rare in (0,5); merged with huashan ≥5
    specimen_weights={
        "BLOOD": 0.15,
        "SPUTUM": 0.30,
        "URINE": 0.32,
        "WOUND": 0.12,
        "CSF": 0.01,
        "STERILE_FLUID": 0.04,
        "RESP_RES": 0.04,
        "OTHER": 0.02,
    },
)

PROFILES: dict[str, HospitalProfile] = {
    "huashan": HUASHAN,
    "ruijin": RUIJIN,
}

AGE_BANDS = ["18-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"]
AGE_WEIGHTS = [0.06, 0.08, 0.12, 0.18, 0.22, 0.22, 0.12]

WARDS_ICU = ["ICU", "RICU", "SICU", "EICU"]
WARDS_WARD = ["呼吸内科", "感染科", "肾内科", "普外科", "神经内科", "血液科", "急诊观察"]
