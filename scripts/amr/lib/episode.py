"""Generate T0 isolates + T1 infection episodes."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .composition import sample_organism
from .hospital_profile import AGE_BANDS, AGE_WEIGHTS, WARDS_ICU, WARDS_WARD, HospitalProfile
from .mic import MicEngine
from .priors import PANELS, Q4Preset, ResistancePrior


def _hash_id(prefix: str, *parts: object) -> str:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:16]
    return f"{prefix}-{h}"


def _norm_weights(d: dict[str, float]) -> tuple[list[str], np.ndarray]:
    keys = list(d.keys())
    w = np.array([d[k] for k in keys], dtype=float)
    w = w / w.sum()
    return keys, w


@dataclass
class GeneratorConfig:
    n_isolates: int
    seed: int
    start_date: date = date(2022, 1, 1)
    end_date: date = date(2024, 12, 31)
    with_t1: bool = True
    q4_preset: Q4Preset | None = None
    # CRE latent base rate among Enterobacterales / non-fermenters
    cre_base_rate: float = 0.08  # retained for docs; CRE now derived from SIR
    esbl_base_rate: float = 0.25  # retained for docs; ESBL now derived from SIR
    # rare phenotype rate among Acinetobacter isolates (Q2 demo)
    rare_col_r_aba_rate: float = 0.07


class AmrEpisodeGenerator:
    def __init__(
        self,
        prior: ResistancePrior,
        mic: MicEngine,
        profile: HospitalProfile,
        cfg: GeneratorConfig,
    ):
        self.prior = prior
        self.mic = mic
        self.profile = profile
        self.cfg = cfg

    def generate(self) -> tuple[list[dict], list[dict]]:
        rng = np.random.default_rng(self.cfg.seed + abs(hash(self.profile.hospital_id)) % 10_000)
        isolates: list[dict] = []
        episodes: list[dict] = []
        days = (self.cfg.end_date - self.cfg.start_date).days

        for i in range(self.cfg.n_isolates):
            org = sample_organism(rng, self.profile.organism_tilt)
            icu = bool(rng.random() < self.profile.icu_rate)
            age_band = str(rng.choice(AGE_BANDS, p=AGE_WEIGHTS))
            sex = "M" if rng.random() < 0.55 else "F"
            specs, sw = _norm_weights(self.profile.specimen_weights)
            specimen = str(rng.choice(specs, p=sw))
            sample_day = self.cfg.start_date + timedelta(days=int(rng.integers(0, days + 1)))
            ward = str(rng.choice(WARDS_ICU if icu else WARDS_WARD))

            # Phenotype flags are DERIVED from sampled SIR (do not force MIC),
            # so marginal R% stays calibrated to CHINET. Mild hospital/ICU tilt only.
            mrsa = org.phenotype == "MRSA"
            panel = list(PANELS.get(org.organism, ["CIP", "MEM"]))
            r_tilt = self.profile.resistance_tilt * (1.03 if icu else 1.0)
            r_tilt *= 1.0 + 0.01 * (sample_day.year - 2022)

            results = self.mic.sample_panel(
                rng,
                organism=org.organism,
                rate_group=org.rate_group,
                panel=panel,
                prior_get=self.prior.get,
                resistance_tilt=r_tilt,
                latent_cre=False,
                latent_esbl=False,
                mrsa=mrsa,
            )

            # rare cell for Q2: colistin-R Acinetobacter (rate among aba isolates)
            rare_flag = False
            if org.organism == "aba" and rng.random() < self.cfg.rare_col_r_aba_rate * self.profile.rare_cre_boost:
                rare_flag = True
                if "CL" in results:
                    results["CL"] = {"mic": 16.0, "sir_eucast": "R"}

            latent_cre = any(
                results.get(wh, {}).get("sir_eucast") == "R" for wh in ("IPM", "MEM", "ETP")
            )
            latent_esbl = any(
                results.get(wh, {}).get("sir_eucast") == "R" for wh in ("CRO", "CAZ")
            ) and org.organism in ("eco", "kpn")

            patient_hash = _hash_id("pt", self.profile.hospital_id, i // 3, sex, age_band)
            isolate_id = _hash_id("iso", self.profile.hospital_id, i, sample_day.isoformat())

            row: dict = {
                "isolate_id": isolate_id,
                "patient_hash": patient_hash,
                "hospital_id": self.profile.hospital_id,
                "sex": sex,
                "age_band": age_band,
                "ward": ward,
                "icu": icu,
                "specimen_code": specimen,
                "sample_date": sample_day.isoformat(),
                "organism_whonet": org.organism,
                "chinet_rate_group": org.rate_group,
                "phenotype_mrsa": mrsa,
                "phenotype_esbl": latent_esbl,
                "phenotype_cre": latent_cre,
                "rare_phenotype": rare_flag,
                "breakpoint_system": "EUCAST",
                "breakpoint_version": "16.1",
            }
            for wh, vals in results.items():
                row[f"mic_{wh}"] = vals["mic"]
                row[f"sir_eucast_{wh}"] = vals["sir_eucast"]
            isolates.append(row)

            if self.cfg.with_t1:
                ep = self._build_episode(rng, row, results)
                if ep:
                    episodes.append(ep)

        return isolates, episodes

    def _build_episode(self, rng: np.random.Generator, iso: dict, results: dict) -> dict | None:
        """T1 episode; blood Enterobacterales get Q4-eligible exposure/outcome."""
        preset = self.cfg.q4_preset
        charlson = int(rng.integers(0, 7))
        prior_abx = bool(rng.random() < (0.45 if iso["icu"] else 0.25))
        blood = iso["specimen_code"] == "BLOOD"
        entero = iso["organism_whonet"] in ("eco", "kpn")

        # empiric therapy assignment
        logit = self.profile.carbapenem_preference
        if iso["icu"]:
            logit += 0.8
        if prior_abx:
            logit += 0.35
        if iso["age_band"] in ("70-79", "80+"):
            logit += 0.25
        if iso["phenotype_cre"]:
            logit += 1.2
        p_carb = 1.0 / (1.0 + np.exp(-logit))
        use_carbapenem = bool(rng.random() < p_carb)
        exposure = "drug:MEM" if use_carbapenem else "drug:TZP"
        meds = [exposure]
        if iso["icu"] and rng.random() < 0.25:
            meds.append("drug:AK")

        # outcome model (only meaningful for Q4-eligible; still fill for all)
        event = False
        follow = int(rng.integers(1, 31))
        if preset is not None:
            x = preset.intercept
            x += preset.tau * (1.0 if use_carbapenem else 0.0)
            cov = preset.covariates
            if iso["icu"]:
                x += cov.get("icu", 0.0)
            if iso["age_band"] in ("70-79", "80+"):
                x += cov.get("age_band_70plus", 0.0)
            x += cov.get("charlson_per_point", 0.0) * charlson
            if prior_abx:
                x += cov.get("prior_abx_90d", 0.0)
            if iso["phenotype_cre"]:
                x += cov.get("cre_phenotype", 0.0)
            p_death = 1.0 / (1.0 + np.exp(-x))
            # blood infections: higher base risk
            if blood:
                p_death = min(0.85, p_death + 0.05)
            else:
                p_death *= 0.55
            event = bool(rng.random() < p_death)
            if event:
                follow = int(rng.integers(1, 31))
            else:
                follow = 30

        conditions = [
            f"organism:{iso['organism_whonet']}",
            f"specimen:{iso['specimen_code']}",
        ]
        if blood:
            conditions.append("bacteremia")
        if entero:
            conditions.append("enterobacterales")
        if iso["phenotype_esbl"]:
            conditions.append("esbl")
        if iso["phenotype_cre"]:
            conditions.append("cre")
        if iso["rare_phenotype"]:
            conditions.append("rare_colistin_r_aba")
        if iso["icu"]:
            conditions.append("icu")
        # Q1: organism×drug×SIR labels for condition-prevalence
        for wh, vals in results.items():
            sir = vals.get("sir_eucast")
            if sir and sir != "ND":
                conditions.append(f"resist:{iso['organism_whonet']}:{wh}:{sir}")

        q4_eligible = bool(blood and entero and iso["age_band"] != "18-29")

        return {
            "subjectKey": iso["patient_hash"],
            "isolate_id": iso["isolate_id"],
            "hospital_id": iso["hospital_id"],
            "ageBand": iso["age_band"],
            "sex": iso["sex"],
            "icuAtBaseline": iso["icu"],
            "charlsonIndex": charlson,
            "specimenType": iso["specimen_code"],
            "organism": iso["organism_whonet"],
            "timeZero": iso["sample_date"],
            "medications": meds,
            "treated": use_carbapenem,  # relative to carbapenem exposure arm
            "followUpDays": follow,
            "eventOccurred": event,
            "conditions": conditions,
            "priorAbxExposure90d": prior_abx,
            "q4Eligible": q4_eligible,
            # Connector InternalRecord.adverseEvents requires organSystem+term+serious
            "adverseEvents": (
                [
                    {
                        "organSystem": "general",
                        "term": "30天全因死亡",
                        "serious": True,
                    }
                ]
                if event
                else []
            ),
        }
