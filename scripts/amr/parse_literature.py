"""PubMed 原始 XML → normalized/literature.parquet.

按 docs/amr-sentinel 查询计划产出统一文献 schema，含两个质量分层字段：
- evidence_tier: systematic_review > meta_analysis > guideline > rct > narrative_review > article
- journal_tier:  T1（综合医学+感染顶刊） / T2（AMR 专业刊） / other
并联接 Europe PMC OA 匹配结果（isOpenAccess/PMCID），标出全文候选。
"""
import json
import pathlib
import re
import sys

import pandas as pd

TIER1 = {'N Engl J Med', 'Lancet', 'JAMA', 'BMJ', 'Lancet Infect Dis', 'Clin Infect Dis',
         'Clin Microbiol Rev', 'Nat Rev Microbiol', 'Nat Microbiol', 'Ann Intern Med', 'PLoS Med'}
TIER2 = {'Antimicrob Agents Chemother', 'J Antimicrob Chemother', 'Int J Antimicrob Agents',
         'Emerg Infect Dis', 'Euro Surveill', 'J Clin Microbiol', 'Clin Microbiol Infect',
         'mBio', 'Open Forum Infect Dis', 'JAMA Intern Med'}

# 证据类型优先级（一篇文章取最高级）
EVIDENCE_RANK = [
    ('systematic_review', {'Systematic Review'}),
    ('meta_analysis', {'Meta-Analysis'}),
    ('guideline', {'Practice Guideline', 'Guideline'}),
    ('rct', {'Randomized Controlled Trial'}),
    ('narrative_review', {'Review'}),
]


def txt(s):
    return re.sub(r"\s+", " ", s or "").strip()


def parse_article(art: str):
    def find1(pat, flags=0):
        m = re.search(pat, art, flags)
        return m.group(1) if m else None

    pmid = find1(r'<PMID Version="1">(\d+)</PMID>')
    if not pmid:
        return None
    title = txt(find1(r"<ArticleTitle>(.*?)</ArticleTitle>", re.S))
    # 摘要：多个 AbstractText 块（结构化摘要带 Label）
    parts = []
    for label, body in re.findall(r'<AbstractText[^>]*?(?:Label="([^"]*)")?[^>]*>(.*?)</AbstractText>', art, re.S):
        clean = re.sub(r"<[^>]+>", " ", body)
        parts.append(f"{label}: {txt(clean)}" if label else txt(clean))
    abstract = " ".join(parts)

    doi = pmcid = None
    for idtype, val in re.findall(r'<ArticleId IdType="([^"]+)">([^<]+)</ArticleId>', art):
        if idtype == "doi":
            doi = val
        elif idtype == "pmc":
            pmcid = val
    mesh = re.findall(r"<DescriptorName[^>]*>([^<]+)</DescriptorName>", art)
    year = find1(r"<ArticleDate[^>]*>.*?<Year>(\d{4})</Year>", re.S) or find1(r"<PubDate>.*?<Year>(\d{4})</Year>", re.S)
    journal = find1(r"<MedlineTA[^>]*>([^<]+)</MedlineTA>")
    types = set(re.findall(r'<PublicationType UI="[^"]*">([^<]+)</PublicationType>', art))
    tier = 'article'
    for name, sig in EVIDENCE_RANK:
        if types & sig:
            tier = name
            break
    jtier = 'T1' if journal in TIER1 else ('T2' if journal in TIER2 else 'other')
    return dict(pmid=int(pmid), doi=doi, title=title, abstract=abstract,
                mesh_terms=mesh, year=int(year) if year else None,
                journal=journal, journal_tier=jtier, evidence_tier=tier, pmcid=pmcid)


def load_oa_match():
    """Europe PMC oa_match 页 → {pmid: (is_oa, pmcid)}"""
    oa = {}
    d = pathlib.Path('data/raw/europepmc/oa_match')
    if not d.exists():
        return oa
    for f in d.glob('pm_*.json'):
        for rec in json.loads(f.read_text()).get('resultList', {}).get('result', []):
            if rec.get('id'):
                oa[str(rec['id'])] = (rec.get('isOpenAccess') == 'Y', rec.get('pmcid', ''))
    return oa


def main():
    corpora_sources = {'main': pathlib.Path('data/raw/pubmed')}
    for t in sorted(pathlib.Path('data/raw/pubmed-targeted').iterdir()):
        corpora_sources[t.name] = t

    articles = {}
    for corpus, root in corpora_sources.items():
        for f in root.rglob('*.xml'):
            for art in f.read_text(errors='ignore').split('<PubmedArticle>')[1:]:
                a = parse_article(art)
                if not a:
                    continue
                if a['pmid'] in articles:  # 跨库/库内重复：只登记语料归属
                    if corpus not in articles[a['pmid']].get('corpora', []):
                        articles[a['pmid']].setdefault('corpora', []).append(corpus)
                    continue
                a['corpora'] = [corpus]
                articles[a['pmid']] = a

    df = pd.DataFrame(articles.values())
    oa = load_oa_match()
    df['is_oa'] = df.pmid.map(lambda p: oa.get(str(p), (None, ''))[0])
    df['epmc_pmcid'] = df.pmid.map(lambda p: oa.get(str(p), (None, ''))[1])

    out = pathlib.Path('data/normalized/literature.parquet')
    df.to_parquet(out, index=False)
    print(f"literature.parquet: {len(df)} 篇 unique")
    print("\nevidence_tier 分布:")
    print(df.evidence_tier.value_counts().to_string())
    print("\njournal_tier 分布:")
    print(df.journal_tier.value_counts().to_string())
    print(f"\nOA 标记: {df.is_oa.sum() if df.is_oa.notna().any() else 0} 篇 is_oa=True")
    print(f"摘要非空率: {(df.abstract.str.len() > 0).mean():.1%}（质量门 >95%）")


if __name__ == '__main__':
    main()
