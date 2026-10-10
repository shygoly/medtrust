# Antimicrobial Sentinel — 数据采集方案

> 公开数据获取 + 医院数据接入的可执行手册
> 版本 v0.1 ｜ 2026-08-15 ｜ 配套文档：[项目整体方案](./PROPOSAL.md)

---

## 0. 边界：做什么，不做什么

**做**：官方 API、官方批量下载、明确开放许可的数据集。

**不做**（写在最前面，避免团队走错路）：

- ❌ 不爬非开放获取（non-OA）的期刊全文——只取摘要
- ❌ 不绕过任何网站的访问限制或速率限制
- ❌ 不二次分发 CHINET / CARSS 的原始报告文件——只引用其中的聚合数值并注明来源
- ❌ 不把任何医院的行级数据拉出院外——医院侧只出聚合量

**优先级铁律**：先做 EUCAST 折点表，再做其他一切。它是所有跨院对齐的地基，缺了它后面全是空转。

---

## 1. 数据源总表

| 优先级 | 源 | 拿什么 | 访问方式 | 许可 | 更新 |
|---|---|---|---|---|---|
| **P0** | **EUCAST v16.0 (2026)** | MIC / 抑菌圈 → S-I-R 判读规则 | 官网 PDF + XLSX 直下 | 免费公开 | 年度 |
| P1 | NCBI MicroBIGG-E / Isolates | 分离株基因组 + AMRFinderPlus 耐药基因 + 提交的 AST 表型 | **Google BigQuery**（无 FTP） | 公共领域 | 每日 |
| P1 | CHINET | 中国 2024 年 45.8 万株临床分离株耐药率 | chinets.com/Document 年报 | 引用注明来源 | 年度 |
| P1 | PubMed | 耐药文献摘要 + MeSH 标引 | E-utilities API | 公开 | 每日 |
| P2 | CARD | 耐药基因 / 突变 / 机制本体（ARO） | card.mcmaster.ca/download | 学术非商业，ARO 为 CC-BY 4.0 | 版本发布 |
| P2 | Europe PMC | 全文 + **预抽取实体标注** | REST API | 依单篇许可 | 每日 |
| P2 | PMC OA Subset | 开放获取全文包 | FTP 批量 | 单篇 CC 许可 | 每日 |
| P3 | CARSS | 全国耐药监测年报 | carss.cn | 引用注明来源 | 年度 |
| P3 | WHO GLASS / ECDC Atlas | 国别聚合耐药率 | dashboard / CSV 导出 | 公开 | 年度 |

---

## 2. 逐源操作手册

### A. EUCAST 折点表（P0，关键路径）

**为什么最重要**：不同医院可能用不同折点体系（中国多数医院用 CLSI M100，少数用 EUCAST）、不同版本。同一个 MIC 值在不同折点下判读出不同的 S/I/R。**不统一折点，跨院耐药率对比就是假的。**

```bash
mkdir -p data/raw/eucast/v16.0
curl -o data/raw/eucast/v16.0/breakpoints.pdf \
  https://www.eucast.org/fileadmin/eucast/pdf/breakpoints/v_16.0_Breakpoint_Tables.pdf
# XLSX 版本从折点表页面获取当期链接：
# https://www.eucast.org/bacteria/clinical-breakpoints-and-interpretation/clinical-breakpoint-tables/
```

**结构化目标**：`(菌种组, 抗生素, 方法, S阈值, R阈值, 单位, 备注, 版本)`

```python
# scripts/amr/parse_eucast.py
import pandas as pd

# XLSX 每个菌种组一个 sheet，表头有合并单元格，需逐 sheet 定位表头行
sheets = pd.read_excel("data/raw/eucast/v16.0/breakpoints.xlsx", sheet_name=None, header=None)

# 输出统一 schema
# organism_group, antibiotic, method(MIC|DISK), s_breakpoint, r_breakpoint,
# unit(mg/L|mm), note, source(EUCAST), version(16.0)
```

**三个必须处理的陷阱**：

1. **"I" 的语义在 2019 年变了。** 现在 I = "susceptible, increased exposure"（增加暴露量下敏感），不再是 "intermediate"。跨年份数据合并时若不处理，耐药率会系统性偏移。
2. **抑菌圈直径与 MIC 是两套阈值**，方向相反（直径越大越敏感）。折点表要按 `method` 分别存。
3. **CLSI vs EUCAST 差异**。CLSI M100 是收费文档，不能公开分发。**方法学决策**：以 EUCAST 作为公开可复现的统一基准重新判读；医院侧把实际使用的折点体系与版本作为必填元数据上报，原始判读保留用于敏感性分析。这个决策要写进研究方案，是可辩护的。

**质量门**：目标菌种 × 抗生素组合的折点缺失率 < 5%，缺失项人工补齐或显式标注为"无折点"。

---

### B. PubMed 文献抓取

先申请 NCBI API key（免费，限速从 3 req/s 提到 10 req/s）。NCBI 要求所有请求携带 `tool` 与 `email` 参数。

**检索式**（MeSH 标引比关键词稳定得多，直接决定语料质量）：

```
("Drug Resistance, Bacterial"[MeSH] OR "Anti-Bacterial Agents/pharmacology"[MeSH])
AND ("Microbial Sensitivity Tests"[MeSH] OR "Mutation"[MeSH])
AND 2015:2026[PDAT]
```

```python
# scripts/amr/fetch_pubmed.py
import os, time, json, pathlib, requests

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
COMMON = {"tool": "amr-sentinel", "email": os.environ["NCBI_EMAIL"],
          "api_key": os.environ["NCBI_API_KEY"]}
QUERY = ('("Drug Resistance, Bacterial"[MeSH] OR "Anti-Bacterial Agents/pharmacology"[MeSH]) '
         'AND ("Microbial Sensitivity Tests"[MeSH] OR "Mutation"[MeSH]) '
         'AND 2015:2026[PDAT]')

out = pathlib.Path("data/raw/pubmed"); out.mkdir(parents=True, exist_ok=True)

# 1) esearch 建立服务端结果集（usehistory 避免翻页丢结果）
r = requests.get(f"{EUTILS}/esearch.fcgi", params={
    "db": "pubmed", "term": QUERY, "usehistory": "y",
    "retmax": 0, "retmode": "json", **COMMON}, timeout=60).json()["esearchresult"]
webenv, qkey, total = r["webenv"], r["querykey"], int(r["count"])
print(f"命中 {total} 篇")

# 2) efetch 分批取 XML
BATCH = 200
for start in range(0, total, BATCH):
    f = out / f"{start:07d}.xml"
    if f.exists():                       # 断点续传
        continue
    xml = requests.get(f"{EUTILS}/efetch.fcgi", params={
        "db": "pubmed", "WebEnv": webenv, "query_key": qkey,
        "retstart": start, "retmax": BATCH, "retmode": "xml", **COMMON},
        timeout=120).text
    f.write_text(xml)
    time.sleep(0.11)                     # 10 req/s 上限，留余量
```

**抽取字段**：PMID、DOI、标题、摘要、MeSH 主题词、发表年、期刊、PMCID（用于后续取全文）。

---

### C. 全文：Europe PMC 优先，PMC OA 兜底

**推荐先用 Europe PMC**——REST API 更友好，且提供**预抽取的实体标注**（基因、化学物质、生物体），能省掉大量 NLP 工作量。

```bash
# 检索（cursorMark 分页）
curl -G 'https://www.ebi.ac.uk/europepmc/webservices/rest/search' \
  --data-urlencode 'query=(DRUG_RESISTANCE) AND (SRC:MED)' \
  --data-urlencode 'format=json' \
  --data-urlencode 'pageSize=1000' \
  --data-urlencode 'cursorMark=*'

# 单篇全文 XML（仅 OA 篇目可取）
curl 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7145624/fullTextXML'
```

**PMC OA 批量兜底**：

```bash
mkdir -p data/raw/pmc-oa
curl -o data/raw/pmc-oa/oa_file_list.csv https://ftp.ncbi.nlm.nih.gov/pub/pmc/oa_file_list.csv
# 按 PMCID 过滤出目标篇目，再从 /pub/pmc/oa_package/xx/xx/PMCxxxxxxx.tar.gz 取包
```

**边界**：`oa_file_list.csv` 里的才是开放获取，只下这些。非 OA 篇目只保留摘要。

---

### D. CARD 耐药基因本体

```bash
mkdir -p data/raw/card
# 以 card.mcmaster.ca/download 页面给出的当期版本链接为准
# 打包内含 card.json（Broad Street 模型）、aro_index.tsv、核酸/蛋白 FASTA
tar -xjf card-data.tar.bz2 -C data/raw/card/
```

**用途**：`element_symbol → ARO 术语 → 耐药机制 → 作用抗生素` 的本体骨架，作为知识图谱的边定义来源。

**许可**：学术/政府/非营利机构非商业使用免费；ARO 本体为 CC-BY 4.0。**成果中必须引用 CARD 论文并注明来源。**

配套工具 RGI（Resistance Gene Identifier）用于从基因组序列注释耐药基因——只在 T2 加分模块（WGS）用得上，主线不依赖。

---

### E. NCBI MicroBIGG-E（BigQuery）

**注意**：MicroBIGG-E **没有 FTP**，网页界面限 10 万行。批量获取只能走 BigQuery。每月 1 TB 免费查询额度，本项目用量远低于此。

```bash
# 前置：Google Cloud 账号 + 启用 BigQuery API + 安装 bq CLI
gcloud auth login
gcloud config set project <your-project-id>
```

**第一步永远是查 schema**（字段名会变，不要照抄任何文档里的字段列表）：

```sql
SELECT column_name, data_type
FROM `ncbi-pathogen-detect.pdbrowser`.INFORMATION_SCHEMA.COLUMNS
WHERE table_name IN ('microbigge', 'isolates')
ORDER BY table_name, ordinal_position;
```

**碳青霉烯耐药基因分布**：

```sql
SELECT
  taxgroup_name,
  element_symbol,
  subclass,
  COUNT(DISTINCT biosample_acc) AS n_isolates
FROM `ncbi-pathogen-detect.pdbrowser.microbigge`
WHERE subclass LIKE '%CARBAPENEM%'
  AND taxgroup_name IN ('Klebsiella pneumoniae',
                        'Escherichia coli',
                        'Acinetobacter baumannii',
                        'Pseudomonas aeruginosa')
GROUP BY 1, 2, 3
ORDER BY n_isolates DESC;
```

**AST 表型**在 `isolates` 表，以嵌套结构存储（先用上面的 schema 查询确认 struct 字段名，再写 `UNNEST`）：

```sql
-- 字段名以 INFORMATION_SCHEMA 查询结果为准
SELECT biosample_acc, scientific_name, ast.*
FROM `ncbi-pathogen-detect.pdbrowser.isolates`, UNNEST(AST_phenotypes) AS ast
WHERE scientific_name = 'Klebsiella pneumoniae'
LIMIT 100;
```

导出：

```bash
bq query --use_legacy_sql=false --format=csv --max_rows=10000000 \
  < scripts/amr/sql/carbapenem_genes.sql > data/raw/microbigge/carbapenem_genes.csv
```

**质量门**：随机抽 100 条与网页浏览器结果对拍（BigQuery 数据可能比网页滞后 1 天，属正常）。

---

### F. CHINET / CARSS 中国基线

**这是国内评委真正认的对照基线，比 ECDC 重要得多。** CHINET 由复旦大学附属示范甲医院牵头，2024 年报覆盖 458,271 株临床分离株。

```bash
mkdir -p data/raw/chinet
# 从 https://www.chinets.com/Document 下载当期年报
# CARSS 年报：http://www.carss.cn/
```

年报是 PDF，用 `pdfplumber` / `camelot` 提取表格，**必须人工校验**——耐药率表格常有跨页和合并单元格，自动提取错误率高。

**用途**（三个，都很关键）：

1. 合成数据 fallback 的**分布先验**——按真实的菌种构成比和耐药率生成分离株
2. 分析结果的**外部一致性对照**——本项目算出的耐药率若与 CHINET 差异过大，说明数据或方法有问题
3. 演示叙事的**权威锚点**

**边界**：只提取聚合数值用于对照和先验，注明来源，不二次分发原始 PDF。

---

### G. WHO GLASS / ECDC Atlas（P3，国际对标）

- ECDC Surveillance Atlas：`atlas.ecdc.europa.eu`，界面直接导出 CSV
- WHO GLASS：dashboard 下载聚合数据

用于国际对比章节，非主力，时间紧可裁掉。

---

## 3. 统一字典（跨源对齐的枢纽）

**这三张表是整个项目的粘合剂**，公开数据和医院数据都要映射到它们。放在 `data/dict/`，纳入版本控制，人工审校。

**`organism.csv`** — 菌种

| 列 | 说明 |
|---|---|
| `whonet_code` | WHONET 菌种代码（`eco`=大肠埃希菌、`kpn`=肺炎克雷伯菌、`sau`=金黄色葡萄球菌、`pae`=铜绿假单胞菌、`aba`=鲍曼不动杆菌） |
| `ncbi_taxid` | NCBI 分类号，与 MicroBIGG-E 对接 |
| `scientific_name` | 拉丁学名 |
| `name_zh` | 中文名（医院侧字段常用中文） |
| `eucast_group` | EUCAST 折点表的菌种组归属 |

**`antibiotic.csv`** — 抗生素

| 列 | 说明 |
|---|---|
| `atc_code` | ATC J01 分类，与 DDD 用量统计对接 |
| `whonet_code` | WHONET 药物代码 |
| `card_aro` | CARD ARO 术语 ID |
| `name_en` / `name_zh` | 通用名（**注意医院侧常用商品名，需额外别名表**） |
| `drug_class` | 药物类别 |

**`specimen.csv`** — 标本类型：本地编码 → 标准编码（血/痰/尿/伤口/脑脊液/无菌体液）+ 中文名。

**质量门**：`whonet_code → ncbi_taxid` 映射率必须 100%，无法自动映射的人工兜底，不允许留空。

---

## 4. 目录结构

```
data/
├── raw/                      # 原样落盘，只读，不修改
│   ├── eucast/v16.0/
│   ├── pubmed/               # 分批 XML
│   ├── pmc-oa/
│   ├── card/<version>/
│   ├── microbigge/
│   └── chinet/
├── normalized/               # 统一 schema，parquet
│   ├── breakpoints.parquet   # 折点规则表
│   ├── literature.parquet    # 文献元数据 + 摘要
│   ├── amr_genes.parquet     # 耐药基因 + 机制
│   └── isolates.parquet      # 公开分离株 + AST
├── dict/                     # 统一字典，版本控制，人工审校
│   ├── organism.csv
│   ├── antibiotic.csv
│   └── specimen.csv
├── kb/                       # 知识图谱产物
└── synthetic/                # CHINET 先验生成的合成数据（fallback）
```

**原则**：`raw/` 只写不改，所有清洗在 `normalized/` 重新生成。任何一步都能从 raw 重跑。

---

## 5. 流水线与质量门

```
raw  ──parse──>  normalized  ──map(dict)──>  kb
                      │
                      └──> 质量门（不过则阻断下游）
```

| 环节 | 质量门 | 阈值 |
|---|---|---|
| EUCAST | 目标菌种×抗生素折点缺失率 | < 5% |
| 字典 | `whonet_code → ncbi_taxid` 映射率 | = 100% |
| PubMed | PMID 唯一性、摘要非空率 | 无重复；> 95% |
| MicroBIGG-E | 抽样 100 条与网页 UI 对拍 | 一致 |
| 知识图谱 | 抽取五元组人工抽检准确率 | **报告真实数值，不设及格线** |
| CHINET 对照 | 本项目耐药率 vs CHINET 同菌种同药 | 差异 > 10 个百分点须给出解释 |

> 知识图谱抽取准确率由陈老师团队抽样校验。**报告真实准确率而非只报规模**——评委看得出"我们抽取了 50 万条三元组"和"我们抽取了 5 万条、抽检准确率 87%"哪个可信。

---

## 6. 医院侧数据接入

### 数据需求清单（可直接发给医院）

**T0 · 必须**（微生物室 WHONET / LIS 导出，成本近乎为零）

WHONET 是 WHO 免费软件，中国细菌耐药监测网本就在用，配套的 BacLink 工具支持从 VITEK、BD Phoenix、Meditech 等主流 LIS 导出并做编码标准化。

| 字段 | 说明 |
|---|---|
| 患者标识 | **哈希后** |
| 性别、年龄段 | 年龄按段（避免精确出生日期） |
| 科室 / 病区 / ICU 标记 | 分层分析必需 |
| 标本类型 | 血 / 痰 / 尿 / 伤口 / 脑脊液 |
| 采样日期 | 连接键之一 |
| 菌种代码 | WHONET 代码或本院编码 + 码表 |
| 各抗生素 MIC 或抑菌圈直径 | 原始测量值，**不要只给 S/I/R** |
| S/I/R 判读 + **所用折点体系与版本** | 版本是必填元数据 |
| ESBL / 碳青霉烯酶表型标记 | 若有 |

> **重点**：一定要拿到**原始 MIC / 抑菌圈**，不能只要 S/I/R。只有原始测量值才能按统一折点重新判读，这是跨院可比的前提。

**T1 · 强烈建议**（HIS / 药剂科；**没有它就只能做描述，做不了因果**）

抗菌药物医嘱（ATC J01、DDD、起止时间、给药途径）、入出院与转科记录、30 天全因死亡、侵入性操作（导管 / 机械通气）、查尔森合并症指数。抗菌药物使用强度（DDDs/100人天）本就是医院强制上报指标，是现成的。

**T2 · 加分**：碳青霉烯酶基因 PCR 分型、科研留存的 WGS。

### 连接键

`患者ID_hash + 采样日期窗口` — 把一次感染事件的用药暴露与药敏结果对齐。这就是目标试验模拟的基本单元。

### 医院侧上传边界

| 上传到控制平面 | 留在院内 |
|---|---|
| 字段名、菌种码表、抗生素字典、折点体系与版本（**元数据**） | 所有行级数据 |
| 经输出闸门过滤的聚合量（计数、率、效应量、KM 分箱） | 原始 MIC、患者标识、病历 |

对齐 Agent 只看码表不看数据——这个边界既满足仓库 `AGENT.md` 的治理约束（连接器平面禁止部署 agent），也是向医院解释时最有说服力的一句话。

### 合规路径

1. **伦理**：回顾性去标识研究，走伦理委员会**免知情同意**申请。**8 月底前必须启动**——这是整条时间线上唯一不可压缩的外部依赖。
2. **技术证明**：用 MedTrust 的连接器 + 数字契约 + 输出闸门 + 链上存证，给出"原始数据不出院"的可验证证明。医院拒绝的第一理由是数据外流风险，能从技术上消掉它，比任何合作意向书都管用。
3. **分级**：细菌基因组本身不含人类遗传信息，合规负担较轻；重的是与之关联的患者临床信息，这部分全程留在院内。

---

## 7. 合成数据 Fallback（必须先建，不是备选）

**在等待医院数据的同时就要建好**，否则一旦伦理或对接延误，整个项目没有演示。

```
CHINET 年报（菌种构成比 + 各药耐药率）
        ↓ 作为分布先验
生成分离株级合成数据（含 MIC 分布、科室分布、时间趋势）
        ↓ 灌入两个连接器实例
双院连接器真实联邦运行（编排、契约、闸门、聚合全部走真实代码路径）
```

**关键点**：合成的是**数据**，不是**系统行为**。编排、契约执行、输出闸门、跨院聚合全部走真实代码路径。演示时可以坦诚说明数据来源为合成——评委扣的是数据真实性的分，但系统真实性的分拿满；反过来（真数据 + 假系统）才是致命的。

---

## 8. 执行排期

| 周 | 日期 | 任务 | 产出 |
|---|---|---|---|
| W1 | 8/20–8/27 | **EUCAST 折点表结构化**（关键路径）；三张统一字典；PubMed 抓取启动 | `breakpoints.parquet`、`dict/*.csv` |
| W1 | 8/20–8/27 | **同步**：T0/T1 清单发候选医院；启动伦理申报 | 数据需求函 |
| W2 | 8/27–9/5 | MicroBIGG-E BigQuery 导出；CARD 解析；CHINET 年报表格提取 | `normalized/*.parquet` |
| W2 | 8/27–9/5 | 合成数据 fallback 建成，跑通 L1 | 双院连接器出 Q1 结果 |
| W3 | 9/5–9/12 | Europe PMC 全文 + 实体标注；知识图谱构建 | `kb/` |
| W3 | 9/5–9/12 | 医院码表接入，对齐契约生成 | 对齐契约可机器校验 |
| W4 | 9/12–9/20 | 质量门全量跑；CHINET 一致性对照 | 数据质量报告 |

**关键路径是 EUCAST 折点表**。它是唯一有"做不完"风险的基础工作，必须最先启动、最先完成。

---

## 9. 环境变量

```bash
export NCBI_API_KEY="..."        # https://account.ncbi.nlm.nih.gov/settings/
export NCBI_EMAIL="..."          # NCBI 要求所有 E-utilities 请求携带
export GOOGLE_CLOUD_PROJECT="..." # BigQuery
```

---

## 附：数据源链接

- [EUCAST 折点表](https://www.eucast.org/bacteria/clinical-breakpoints-and-interpretation/clinical-breakpoint-tables/) · [v16.0 PDF](https://www.eucast.org/fileadmin/eucast/pdf/breakpoints/v_16.0_Breakpoint_Tables.pdf)
- [NCBI MicroBIGG-E on GCP](https://www.ncbi.nlm.nih.gov/pathogens/docs/microbigge_gcp/) · [Isolates on GCP](https://www.ncbi.nlm.nih.gov/pathogens/docs/isolates_gcp/) · [BigQuery 入门](https://www.ncbi.nlm.nih.gov/pathogens/docs/getting_started_bigquery/)
- [CARD 下载](https://card.mcmaster.ca/download) · [CARD 说明](https://card.mcmaster.ca/about)
- [CHINET 文档页](https://www.chinets.com/Document) · [CARSS](http://www.carss.cn/)
- [Europe PMC 批量下载](https://europepmc.org/downloads)
- [WHONET / BacLink](https://whonet.org/)
- [ECDC Surveillance Atlas](https://atlas.ecdc.europa.eu/)
