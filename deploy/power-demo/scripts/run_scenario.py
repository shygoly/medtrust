#!/usr/bin/env python3
"""Run load-forecast / demand-response / theft-detection end to end."""

import argparse
import json
import time

from typing import Dict, Optional

from common import (
    CONSUMER_EMAIL,
    CONSUMER_PASSWORD,
    PURPOSE,
    PRODUCTS,
    api,
    load_contracts,
    login,
)

LOAD = [p for p in PRODUCTS if p[3].endswith("load.csv")]
THEFT = [p for p in PRODUCTS if p[3].endswith("theft.csv")]


def participants(products, with_role: bool = False):
    out = []
    for product_id, participant_id, _node, _path in products:
        item = {"participantId": participant_id, "dataProductId": product_id}
        if with_role:
            item["role"] = "grid"
        out.append(item)
    return out


def run(name: str, template: str, analysis_key: str, input_payload: dict, contracts: Dict[str, str]) -> dict:
    token = login(CONSUMER_EMAIL, CONSUMER_PASSWORD)
    plan = api(token, "POST", "/mdop/plans/preview", {"template": template, "input": input_payload})
    job = api(token, "POST", "/mdop/jobs", {**plan, "analysisKey": analysis_key})
    job_id = job["jobId"]
    print("%s: submitted %s" % (name, job_id))
    compiled = api(token, "POST", "/mdop/jobs/%s/compile" % job_id)
    print("%s: compile -> %s" % (name, compiled.get("status")))
    deadline = time.time() + 240
    last = None
    while time.time() < deadline:
        detail = api(token, "GET", "/mdop/jobs/" + job_id)
        status = detail["job"]["status"]
        if status != last:
            print("%s: %s" % (name, status))
            last = status
        if status in ("SUCCEEDED", "FAILED", "REJECTED", "PURGED"):
            break
        time.sleep(2)
    if last != "SUCCEEDED":
        raise RuntimeError("%s ended in %s: %s" % (name, last, detail["job"].get("rejectReason")))
    print("%s: result" % name)
    print(json.dumps(detail.get("result"), ensure_ascii=False, indent=2)[:4000])
    return detail


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=["load", "dr", "theft"])
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()
    contracts = load_contracts()
    missing = [p[0] for p in PRODUCTS if p[0] not in contracts]
    if missing:
        raise SystemExit("missing contract ids in runtime/contracts.json: %s" % ", ".join(missing))

    if args.scenario == "load":
        products = LOAD
        input_payload = {
            "purpose": PURPOSE,
            "applicant": {"org": "河南电力调度中心", "project": "power demo load forecast"},
            "contracts": [contracts[p[0]] for p in products],
            "participants": participants(products, with_role=True),
            "spec": {"forecastHorizon": 24, "features": ["load"], "model": "baseline"},
            "notBefore": "2026-01-01T00:00:00.000Z",
            "notAfter": "2027-01-31T00:00:00.000Z",
        }
        run("load-forecast", "power.load-forecast", "power.load-forecast", input_payload, contracts)
        return

    if args.scenario == "dr":
        products = LOAD
        target = [120, 115, 110, 108, 112, 125, 150, 180, 210, 230, 240, 245,
                  248, 246, 240, 235, 230, 240, 260, 280, 270, 240, 200, 160]
        input_payload = {
            "purpose": PURPOSE,
            "applicant": {"org": "河南电力调度中心", "project": "power demo demand response"},
            "contracts": [contracts[p[0]] for p in products],
            "participants": [
                {**participants(products)[i], "userType": ["industrial", "commercial", "industrial"][i]}
                for i in range(len(products))
            ],
            "spec": {"targetLoad": target, "incentiveBudget": 50000, "timeWindow": [18, 22]},
            "notBefore": "2026-01-01T00:00:00.000Z",
            "notAfter": "2027-01-31T00:00:00.000Z",
        }
        run("demand-response", "power.demand-response", "power.demand-response", input_payload, contracts)
        return

    products = THEFT
    input_payload = {
        "purpose": PURPOSE,
        "applicant": {"org": "河南电力调度中心", "project": "power demo theft detection"},
        "contracts": [contracts[p[0]] for p in products],
        "participants": participants(products),
        "spec": {"detectionPeriod": 30, "anomalyThreshold": args.threshold, "topK": 10},
        "notBefore": "2026-01-01T00:00:00.000Z",
        "notAfter": "2027-01-31T00:00:00.000Z",
    }
    run("theft-detection", "power.theft-detection", "power.theft-detection", input_payload, contracts)


if __name__ == "__main__":
    main()
