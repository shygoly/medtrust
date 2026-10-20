#!/usr/bin/env python3
"""Generate deterministic synthetic power time-series for the hn-power demo.

Output: data/{grid,market,plant}/{load,theft}.csv
- load.csv: normal daily load curve, 10 meters (load-forecast / demand-response)
- theft.csv: 6 anomaly meters (zero + negative spikes) + 4 normal meters
"""
import csv
import math
import os
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DAYS = 35
HOURS = DAYS * 24
START = datetime(2026, 8, 31, 16, 0, 0, tzinfo=timezone.utc)  # 2026-09-01 00:00 +08:00
METERS = 10
ANOMALOUS = 6


def normal_value(prefix: str, meter: int, hour: int) -> float:
    h = hour % 24
    day = hour // 24
    scale = {"grid": 1.0, "market": 1.35, "plant": 0.8}[prefix]
    daily = 22.0 * math.sin(2 * math.pi * (h - 8) / 24)
    weekday = 1.18 if 0 <= day % 7 <= 4 else 0.86
    base = (80 + meter * 12) * scale * weekday
    ripple = 1.5 * math.sin(2 * math.pi * hour / 7.0 + meter)
    return round(max(1.0, base + daily * scale + ripple), 3)


def anomaly_value(prefix: str, hour: int) -> float:
    if hour < 96:
        return normal_value(prefix, 0, hour)
    # zero-power pattern with periodic negative (reverse-flow) spikes.
    return -50.0 if (hour - 96) % 40 == 0 else 0.0


def write_file(path: str, prefix: str, theft: bool) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["timestamp", "entityId", "activePower"])
        for meter in range(METERS):
            entity = "%s-meter-%d" % (prefix, meter)
            for hour in range(HOURS):
                ts = START + timedelta(hours=hour)
                value = (
                    anomaly_value(prefix, hour)
                    if theft and meter < ANOMALOUS
                    else normal_value(prefix, meter, hour)
                )
                writer.writerow([ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"), entity, value])


def main() -> None:
    for prefix in ("grid", "market", "plant"):
        write_file(os.path.join(ROOT, prefix, "load.csv"), prefix, False)
        write_file(os.path.join(ROOT, prefix, "theft.csv"), prefix, True)
    print("generated 6 CSV files under %s" % ROOT)


if __name__ == "__main__":
    main()
