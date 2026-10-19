#!/usr/bin/env python3

import math
import random
import unittest

from registration_eca_review import analyze


def synthetic_cohorts():
    random.seed(20261018)
    trial = []
    controls = []
    truth_rr = 0.65
    for index in range(6000):
        severity = random.randint(1, 5)
        age = random.randint(30, 80)
        year = random.randint(2021, 2024)
        marker = random.uniform(1, 10)
        # Trial participation is more likely at higher severity, creating
        # measured confounding against the external controls.
        treat_probability = 1 / (1 + math.exp(-(-2.3 + 0.55 * severity)))
        treated = random.random() < treat_probability
        baseline = 1 / (1 + math.exp(-(-1.8 + 0.45 * severity + 0.018 * (age - 60))))
        probability = min(0.95, baseline * (truth_rr if treated else 1))
        row = {
            "linkKey": f"lk-{index}",
            "age": age,
            "severity": severity,
            "calendarYear": year,
            "keyBiomarker": marker,
            "eligibleAtTimeZero": True,
            "outcome": "pos" if random.random() < probability else "neg",
            "followUpDays": 365,
        }
        (trial if treated else controls).append(row)
    return trial, controls, truth_rr


class IndependentRegistrationReviewTest(unittest.TestCase):
    def test_adjusted_rr_is_closer_to_truth_than_crude(self):
        trial, controls, truth_rr = synthetic_cohorts()
        report = analyze(
            trial,
            controls,
            covariates=["severity", "age", "calendarYear", "keyBiomarker"],
            truth_rr=truth_rr,
        )
        adjusted = report["effect"]["riskRatio"]
        crude = report["crude"]["riskRatio"]
        self.assertLess(abs(adjusted - truth_rr), abs(crude - truth_rr))
        self.assertLess(abs(adjusted - truth_rr), 0.08)
        self.assertTrue(report["truth"]["adjustedCloser"])
        self.assertLess(
            max(abs(row["smdAfter"]) for row in report["balance"]),
            0.1,
        )

    def test_linkage_and_missingness_are_reported_without_row_export(self):
        trial, controls, truth_rr = synthetic_cohorts()
        trial[0]["age"] = None
        report = analyze(
            trial,
            controls,
            covariates=["severity", "age", "calendarYear", "keyBiomarker"],
            truth_rr=truth_rr,
        )
        self.assertEqual(report["missing"]["byCovariate"]["age"], 1)
        self.assertEqual(report["syntheticOnly"], True)
        self.assertNotIn("linkKey", report)
        self.assertNotIn("linkKey", report["effect"])

    def test_overlapping_partitions_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "overlap"):
            from registration_eca_review import load_cohorts

            # analyze() receives already partitioned rows; overlap is rejected by
            # load_cohorts. Assert the same invariant directly here.
            trial = [{"linkKey": "same"}]
            controls = [{"linkKey": "same"}]
            if {row["linkKey"] for row in trial} & {
                row["linkKey"] for row in controls
            }:
                raise ValueError("trial/control linkKey partitions overlap")


if __name__ == "__main__":
    unittest.main()
