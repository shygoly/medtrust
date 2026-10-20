#!/usr/bin/env python3
"""Shared config/API helpers for the hn-power demo scripts."""
from typing import Dict, Optional
import json
import os
import time
from pathlib import Path

import requests

API_BASE = os.getenv("POWER_API_BASE", "http://127.0.0.1:5021/api/v1").rstrip("/")
SPACE_ID = os.getenv("POWER_SPACE_ID", "hn-power")
PURPOSE = os.getenv("POWER_PURPOSE", "对话式任务配置（AI Chat Agent）")
CONSUMER_ID = os.getenv("POWER_CONSUMER_ID", "p-power-analyst")
CONSUMER_EMAIL = os.getenv("POWER_CONSUMER_EMAIL", "analyst@hn-power.example")
OPS_EMAIL = os.getenv("POWER_OPS_EMAIL", "ops@hn-power.example")
DEFAULT_PASSWORD = os.getenv("POWER_DEMO_PASSWORD", "demo123456")
CONSUMER_PASSWORD = os.getenv("POWER_CONSUMER_PASSWORD", DEFAULT_PASSWORD)
OPS_PASSWORD = os.getenv("POWER_OPS_PASSWORD", DEFAULT_PASSWORD)
PROVIDER_PASSWORD = os.getenv("POWER_PROVIDER_PASSWORD", DEFAULT_PASSWORD)
CONTRACTS_FILE = Path(
    os.getenv(
        "POWER_CONTRACTS_FILE",
        str(Path(__file__).resolve().parent.parent / "runtime" / "contracts.json"),
    )
)

PROVIDERS = {
    "grid": ("p-grid-hn", os.getenv("POWER_GRID_EMAIL", "grid@hn-power.example")),
    "market": ("p-market-hn", os.getenv("POWER_MARKET_EMAIL", "market@hn-power.example")),
    "plant": ("p-res-hn", os.getenv("POWER_PLANT_EMAIL", "plant@hn-power.example")),
}

PRODUCTS = [
    ("dp-pwr-demo-load-grid", "p-grid-hn", "grid", "grid/load.csv"),
    ("dp-pwr-demo-load-market", "p-market-hn", "market", "market/load.csv"),
    ("dp-pwr-demo-load-plant", "p-res-hn", "plant", "plant/load.csv"),
    ("dp-pwr-demo-theft-grid", "p-grid-hn", "grid", "grid/theft.csv"),
    ("dp-pwr-demo-theft-market", "p-market-hn", "market", "market/theft.csv"),
    ("dp-pwr-demo-theft-plant", "p-res-hn", "plant", "plant/theft.csv"),
]


def login(email: str, password: Optional[str] = None) -> str:
    for attempt in range(6):
        response = requests.post(
            API_BASE + "/auth/login",
            json={"account": email, "password": password or DEFAULT_PASSWORD},
            timeout=15,
        )
        if response.status_code == 429:
            # Login throttle is per IP; a demo bootstrap legitimately logs in
            # several provider accounts in a row.
            time.sleep(6)
            continue
        if response.status_code != 200:
            raise RuntimeError("login %s failed: %s %s" % (email, response.status_code, response.text[:200]))
        return response.json()["access_token"]
    raise RuntimeError("login %s failed: still rate-limited after retries" % email)


def headers(token: str) -> Dict[str, str]:
    return {"Authorization": "Bearer " + token, "x-space-id": SPACE_ID}


def api(token: str, method: str, path: str, body=None, timeout=30):
    response = requests.request(
        method,
        API_BASE + path,
        headers=headers(token),
        json=body,
        timeout=timeout,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError("%s %s -> %s %s" % (method, path, response.status_code, response.text[:400]))
    return response.json() if response.text else None


def load_contracts() -> Dict[str, str]:
    if not CONTRACTS_FILE.exists():
        return {}
    return json.loads(CONTRACTS_FILE.read_text())


def save_contracts(contracts: Dict[str, str]) -> None:
    CONTRACTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONTRACTS_FILE.write_text(json.dumps(contracts, ensure_ascii=False, indent=2))
