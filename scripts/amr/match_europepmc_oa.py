"""Europe PMC OA matching — per DATA-ACQUISITION.md §C decision (see data/MANIFEST.md #3).

Europe PMC MESH-field search proved unreliable (616 hits for a MeSH heading that
should match hundreds of thousands), so instead we match our local PubMed corpus
PMIDs directly via EXT_ID to obtain isOpenAccess / PMCID / fullTextUrlList per
article. Only OA articles are eligible for full-text retrieval downstream.
"""
import json
import pathlib
import time

import requests

OUT = pathlib.Path("data/raw/europepmc/oa_match")
OUT.mkdir(parents=True, exist_ok=True)
BATCH = 200
SLEEP = 0.35  # stay well under Europe PMC courtesy limits

pmids = json.load(open("data/raw/pubmed/pmids.json"))
s = requests.Session()

hits, oa, pages = 0, 0, 0
for i in range(0, len(pmids), BATCH):
    f = OUT / f"pm_{i:07d}.json"
    if not (f.exists() and f.stat().st_size > 100):  # resume
        q = "EXT_ID:(" + " OR ".join(pmids[i : i + BATCH]) + ")"
        for attempt in range(3):
            try:
                r = s.get(
                    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                    params={"query": q, "format": "json", "pageSize": BATCH},
                    timeout=120,
                ).json()
                f.write_text(json.dumps(r))
                break
            except Exception as e:  # noqa: BLE001
                time.sleep(5 * (attempt + 1))
                if attempt == 2:
                    raise SystemExit(f"batch {i} failed 3x: {e}") from e
        time.sleep(SLEEP)
    r = json.loads(f.read_text())
    res = r.get("resultList", {}).get("result", [])
    hits += len(res)
    oa += sum(1 for x in res if x.get("isOpenAccess") == "Y")
    pages += 1
    if pages % 50 == 0:
        print(f"{pages} pages, matched {hits}, OA {oa}", flush=True)

summary = {
    "corpus_pmids": len(pmids),
    "matched": hits,
    "open_access": oa,
    "match_rate": round(hits / len(pmids), 4),
    "oa_rate": round(oa / len(pmids), 4),
}
(OUT / "summary.json").write_text(json.dumps(summary, indent=1))
print("SUMMARY:", summary)
