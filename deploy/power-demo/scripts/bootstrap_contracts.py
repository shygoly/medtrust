#!/usr/bin/env python3
"""Create and MDOP-sign the six power demo contracts.

Run after the three connectors are online with the example auto-confirm
policy. The script is idempotent: existing active/signed contracts are reused.
"""

import time

from typing import Dict, Optional

from common import (
    CONSUMER_ID,
    CONTRACTS_FILE,
    PRODUCTS,
    PROVIDERS,
    PROVIDER_PASSWORD,
    PURPOSE,
    api,
    load_contracts,
    login,
    save_contracts,
)


def find_active(token: str, product_id: str) -> Optional[str]:
    contracts = api(token, "GET", "/contracts")
    for contract in contracts:
        if (
            contract.get("dataProductId") == product_id
            and contract.get("consumerId") == CONSUMER_ID
            and contract.get("purpose") == PURPOSE
            and contract.get("status") == "active"
            and contract.get("mdopStatus") == "active"
        ):
            return str(contract["id"])
    return None


def wait_active(token: str, contract_id: str, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        contract = api(token, "GET", "/contracts/" + contract_id)
        if contract.get("mdopStatus") == "active":
            return
        time.sleep(2)
    raise RuntimeError("contract %s did not become MDOP-active in time" % contract_id)


def main() -> None:
    contracts = load_contracts()
    tokens: Dict[str, str] = {}
    for product_id, provider_id, node, _path in PRODUCTS:
        _pid, email = PROVIDERS[node]
        if node not in tokens:
            tokens[node] = login(email, PROVIDER_PASSWORD)
        token = tokens[node]
        existing = find_active(token, product_id)
        if existing:
            contracts[product_id] = existing
            print("reuse %s -> %s" % (product_id, existing))
            continue
        created = api(
            token,
            "POST",
            "/contracts",
            {
                "dataProductId": product_id,
                "providerId": provider_id,
                "consumerId": CONSUMER_ID,
                "purpose": PURPOSE,
                "retention": "作业完成后 30 天",
                "output": "聚合",
                "minCell": 5,
                "validDays": 90,
                "outputPolicy": {"preset": "aggregate_only", "minCell": 5},
            },
        )
        contract_id = str(created["id"])
        api(token, "POST", "/contracts/%s/mdop/offer" % contract_id, {})
        wait_active(token, contract_id)
        contracts[product_id] = contract_id
        print("created+signed %s -> %s" % (product_id, contract_id))
    save_contracts(contracts)
    print("contracts saved to %s" % CONTRACTS_FILE)


if __name__ == "__main__":
    main()
