"""PubMed AMR literature fetcher — per docs/amr-sentinel/DATA-ACQUISITION.md §B.

Strategy: NCBI efetch cannot page past retstart≈10,000 within one WebEnv
history (HTTP 400, verified empirically 2026-08-15). Per NCBI guidance the
query is therefore partitioned into per-year PDAT windows (auto-split when a
window exceeds 9,999 hits); each window gets its own history and is fully
pageable.

Rate limit: 10 req/s with NCBI_API_KEY, else 3 req/s.
Resume-safe: per-window state + batch files skipped when already on disk.
"""
import argparse
import json
import os
import pathlib
import sys
import time

import requests

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
BASE = (
    '("Drug Resistance, Bacterial"[MeSH] OR "Anti-Bacterial Agents/pharmacology"[MeSH]) '
    'AND ("Microbial Sensitivity Tests"[MeSH] OR "Mutation"[MeSH])'
)

# 定向检索式（docs/amr-sentinel 查询计划 B 类）：按用途各自成库，落 data/raw/pubmed-targeted/<name>/
PRESETS = {
    # Q4 临床 benchmark：碳青霉烯 vs BL/BLI 血流感染死亡率队列（效应量对照基准；该对比本身文献面窄，36 篇为精准集）
    "q4-clinical-benchmark": (
        '("carbapenem"[ti] OR carbapenems[ti]) AND ("piperacillin-tazobactam"[tiab] '
        'OR "beta-lactamase inhibitor"[tiab] OR "beta-lactamase inhibitors"[tiab]) '
        'AND ("bacteremia"[tiab] OR "bloodstream infection"[tiab]) '
        'AND (mortality[tiab] OR survival[tiab])'
    ),
    # Q4 方法学：目标试验模拟框架（TteSpec 设计依据，Hernán 系列聚焦）
    "q4-tte-methods": (
        '("target trial emulation"[tiab] OR "emulating a target trial"[tiab]) '
        'AND (Hernan[au] OR "causal inference"[tiab])'
    ),
    # 折点体系差异（CLSI vs EUCAST）：Q1 重判读结论的敏感性分析依据
    "breakpoint-harmonization": (
        '(CLSI[ti] AND EUCAST[ti]) AND (breakpoints[tiab] OR breakpoint[tiab] '
        'OR "interpretive categories"[tiab] OR "interpretive category"[tiab])'
    ),
    # 基因型-表型权威综述：知识图谱五元组抽取结果的人工对拍金标准
    "kb-gold-reviews": (
        '(carbapenemase[ti] OR carbapenemases[ti]) AND (KPC[tiab] OR NDM[tiab] OR "OXA-48"[tiab]) '
        'AND (review[pt] OR systematic[sb])'
    ),
    # 经验性用药指南/指导意见：Agent 4 建议排序的临床依据层
    "empirical-therapy-guidelines": (
        '(empirical[ti] OR empiric[ti]) AND (therapy[ti] OR treatment[ti]) '
        'AND (guideline[pt] OR guidance[ti] OR guidelines[ti]) '
        'AND "Anti-Bacterial Agents"[MeSH]'
    ),
}

BATCH = 200
SPLIT_THRESHOLD = 9999  # efetch history hard limit sits at retstart=10000

API_KEY = os.environ.get("NCBI_API_KEY")
EMAIL = os.environ.get("NCBI_EMAIL")
COMMON = {"tool": "amr-sentinel"}
if EMAIL:
    COMMON["email"] = EMAIL
if API_KEY:
    COMMON["api_key"] = API_KEY
SLEEP = 0.13 if API_KEY else 0.4

OUT = pathlib.Path("data/raw/pubmed")


def esearch(session, term):
    r = session.get(
        f"{EUTILS}/esearch.fcgi",
        params={"db": "pubmed", "term": term, "usehistory": "y", "retmax": 0, "retmode": "json", **COMMON},
        timeout=60,
    ).json()["esearchresult"]
    return r["webenv"], r["querykey"], int(r["count"])


def windows(session, year_from=2015, year_to=2026):
    """Yield (label, term, count) with per-year windows, auto half-split."""
    for y in range(year_from, year_to + 1):
        term = f"{BASE} AND {y}[PDAT]"
        _, _, count = esearch(session, term)
        if count <= SPLIT_THRESHOLD:
            yield f"{y}", term, count
        else:  # split into half-years, recurse if still too large
            for half, (d1, d2) in enumerate([("01/01", "06/30"), ("07/01", "12/31")], 1):
                hterm = f"{BASE} AND {y}/{d1}:{y}/{d2}[PDAT]"
                _, _, hcount = esearch(session, hterm)
                if hcount > SPLIT_THRESHOLD:  # quarter split fallback
                    for q, (dd1, dd2) in enumerate(
                        [("01/01", "03/31"), ("04/01", "06/30"), ("07/01", "09/30"), ("10/01", "12/31")], 1
                    ):
                        qterm = f"{BASE} AND {y}/{dd1}:{y}/{dd2}[PDAT]"
                        _, _, qcount = esearch(session, qterm)
                        yield f"{y}h{half}q{q}", qterm, qcount
                else:
                    yield f"{y}h{half}", hterm, hcount
        time.sleep(SLEEP)


def fetch_window(session, label, webenv, qkey, total, limit, out_dir=None):
    wdir = out_dir or (OUT / f"w{label}")
    wdir.mkdir(parents=True, exist_ok=True)
    state_file = wdir / "state.json"
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state["total"] != total:
            state_file.unlink()  # recount drifted: redo history for this window
        else:
            webenv, qkey = state["webenv"], state["qkey"]
    else:
        state_file.write_text(json.dumps({"webenv": webenv, "qkey": qkey, "total": total}))

    n = min(total, limit) if limit else total
    for start in range(0, n, BATCH):
        f = wdir / f"{start:07d}.xml"
        if f.exists() and f.stat().st_size > 1000:
            continue
        for attempt in range(3):
            try:
                resp = session.get(
                    f"{EUTILS}/efetch.fcgi",
                    params={
                        "db": "pubmed", "WebEnv": webenv, "query_key": qkey,
                        "retstart": start, "retmax": BATCH, "retmode": "xml", **COMMON,
                    },
                    timeout=120,
                )
                resp.raise_for_status()
                f.write_text(resp.text)
                break
            except Exception as e:  # noqa: BLE001
                wait = 5 * (attempt + 1)
                print(f"[{label}] batch {start} failed ({e}), retry {wait}s", file=sys.stderr, flush=True)
                time.sleep(wait)
        else:
            print(f"[{label}] batch {start} failed 3x — rerun script to resume", file=sys.stderr, flush=True)
            sys.exit(1)
        time.sleep(SLEEP)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-per-window", type=int, default=0, help="cap records per window (0 = all)")
    ap.add_argument("--preset", choices=sorted(PRESETS), help="定向检索式（落 data/raw/pubmed-targeted/<name>/）")
    args = ap.parse_args()

    s = requests.Session()

    if args.preset:  # 定向模式：单查询直取（预期 <10k；超限则退回年份窗口）
        term = PRESETS[args.preset]
        webenv, qkey, count = esearch(s, term)
        print(f"preset {args.preset}: {count} hits")
        if count > SPLIT_THRESHOLD:
            raise SystemExit("hits > 9999: 需按年份窗口化，暂未支持（给该 preset 加 PDAT 限定后再跑）")
        out_dir = pathlib.Path("data/raw/pubmed-targeted") / args.preset
        got = fetch_window(s, args.preset, webenv, qkey, count, args.max_per_window, out_dir=out_dir)
        print(f"preset {args.preset}: {got}/{count} done -> {out_dir}")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    grand = 0
    for label, term, count in windows(s):
        webenv, qkey, _ = esearch(s, term)
        got = fetch_window(s, label, webenv, qkey, count, args.max_per_window)
        grand += got
        print(f"window {label}: {got}/{count} done (cumulative {grand})", flush=True)
    print(f"ALL DONE: {grand} records across windows")


if __name__ == "__main__":
    main()
