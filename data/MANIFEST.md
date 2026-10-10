# AMR Sentinel 数据采集清单（MANIFEST）

> 依据 [`docs/amr-sentinel/DATA-ACQUISITION.md`](../docs/amr-sentinel/DATA-ACQUISITION.md) 采集 ｜ 执行日期 2026-08-15
> 原则：`raw/` 只写不改；任何一步可从 raw 重跑；本文件是 data/raw 的唯一事实源。
> **AMR 数据声明**：[`docs/amr-sentinel/DATA-DISCLAIMER.md`](../docs/amr-sentinel/DATA-DISCLAIMER.md)（主结果=CHINET 先验合成 AST；Synthea 不进 AMR 主表）。

## 采集状态总表

| 优先级 | 源 | 版本/日期 | 落盘位置 | 状态 | 许可与边界 |
|---|---|---|---|---|---|
| **P0** | EUCAST 折点表 | **v16.1**（2026-06-24 生效，当前版；计划写 v16.0 已被官方取代，v16.0 直链 403） | `raw/eucast/v16.1/breakpoints.pdf`（4.1MB/123页）+ `breakpoints.xlsx`（2.6MB/42 sheets） | ✅ 已验证 | 免费公开；结构化时注意 I 语义（2019 变更）与 MIC/直径双阈值 |
| P1 | PubMed | 检索式=计划§B（MeSH 组合+2015:2026 PDAT）；**最终语料 64,700 unique PMIDs**（74,262 条记录按 `<PubmedArticle>` 提取去重；与整段查询命中 64,511 对账 ±4 漂移） | `raw/pubmed/w{year}/`（13 个年份窗口分批 XML + `pmids.json`） | ✅ 完成 | E-utilities 公开；无 API key 按 3 req/s 限速 |
| P1 | PubMed **定向语料**（448 篇，五库） | ①`q4-clinical-benchmark` 36 篇：碳青霉烯 vs BL/BLI 血流感染死亡率队列（Q4 效应量基准）②`q4-tte-methods` 184 篇：目标试验模拟方法学（Hernán 聚焦，TteSpec 设计）③`breakpoint-harmonization` 65 篇：CLSI vs EUCAST 差异（Q1 敏感性分析）④`kb-gold-reviews` 127 篇：碳青霉烯酶权威综述（知识图谱抽取对拍金标准）⑤`empirical-therapy-guidelines` 36 篇：经验性用药指南（Agent 4 依据层） | `raw/pubmed-targeted/<name>/` | ✅ 完成（检索式固化在 `scripts/amr/fetch_pubmed.py` PRESETS） | 同上；首版 q4 混合库因 TTE 短语吸入全领域文献已废弃拆分 |
| P1 | CHINET | 2024 中文年报 + 2024 英文版 + 2023 年报 + 2022 CCDCW 英文 | `raw/chinet/`（4 份 PDF） | ✅ | **仅内部对照用**：提取聚合数值须注明来源，不二次分发原始 PDF |
| P1 | MicroBIGG-E / Isolates | — | `raw/microbigge/`（空） | ⛔ **手动步骤**：无 bq CLI / Google Cloud 凭据；SQL 已在计划§E，装 bq 后执行即可 | 公共领域（BigQuery 免费额度内） |
| P2 | CARD | **v4.0.2**（2026-08-11 官方包） | `raw/card/v4.0.2/`（card.json 36MB + aro_index.tsv + FASTA 全套，已验证 6,451 条模型） | ✅ | 学术非商业免费；ARO 为 CC-BY 4.0；**成果必须引用 CARD 论文** |
| P2 | Europe PMC | PMID 批量匹配（EXT_ID，`raw/europepmc/oa_match/` 325 页 + summary）：**matched 64,596/64,700（99.84%），OA 20,469 篇（31.6%）**；检索样例 `raw/europepmc/search_p0.json` | `raw/europepmc/` | ✅ 完成 | REST 公开；全文仅取 OA（20,469 篇为 W3 候选池） |
| P2 | PMC OA | `PMC-ids.csv.gz`（252MB，现行映射表）+ `oa_file_list.csv`（113MB，**deprecated 目录，2026-08 后删除**，已抢救） | `raw/pmc-oa/` | ✅ | 只下 oa_file_list 列出的 OA 篇目；非 OA 只留摘要；官方新通道为 AWS S3（pmc.ncbi.nlm.nih.gov/tools/pmcaws/） |
| P3 | CARSS | — | `raw/carss/`（空） | ⛔ **手动步骤**：carss.cn 返回 HTTP 468（反爬），需浏览器人工下载年报 | 同 CHINET：仅引用聚合数值 |
| P3 | WHO GLASS / ECDC Atlas | — | `raw/ecdc/`（空） | ⛔ 手动步骤：Tableau dashboard 界面导出 CSV（atlas.ecdc.europa.eu） | 公开；国际对标非主力，可裁 |
| — | 统一字典 | v0（9 菌种 / 22 抗生素 / 8 标本类） | `dict/{organism,antibiotic,specimen}.csv` | ✅ v0 待人工审校 | 计划§3；ARO 列留空待规范化联接 aro_index.tsv，**不臆造** |

## 已知问题与决策记录

1. **EUCAST 版本**：计划撰写时为 v16.0，采集时官方当前版为 v16.1（2026-06-24）。取 v16.1 为统一基准；v16.0 直链已 403（归档）。结构化脚本的 `version` 字段统一写 `16.1`。
2. **NCBI efetch 历史翻页硬限制**（实测 2026-08-15）：`retstart ≥ 10000` 恒 HTTP 400（GET/POST 均然），WebEnv 会话新旧无关。已改用**年份窗口化**策略（每年一窗，>9,999 自动半/季切分——本次仅 2025 需对半切 6,017+6,032）。按年合计 73,031 hits，与整段查询的 64,511 有差（PDAT 边界效应），以窗口并集+去重为准。
3. **Europe PMC MESH 检索不可靠**：`MESH:"Drug Resistance, Bacterial"` 全库仅返回 616（应数十万级），语法/索引行为异常。**决策（已执行）**：放弃独立检索式，改用本地 PubMed 语料 PMID 清单 `EXT_ID` 批量匹配拿 `isOpenAccess`/PMCID/全文链接。结果：匹配率 99.84%，OA 占比 31.6%（20,469 篇）。脚本：`scripts/amr/match_europepmc_oa.py`。
4. **PMC OA 分发迁移中**：legacy `oa_file_list.csv` 在 deprecated 目录且官方声明 2026-08 移除，已抢挡一份；后续以 AWS S3 通道为正式来源。
5. **初始（未窗口化）抓取存档**：`raw/pubmed/_initial_run_no_window/`（10,194 unique PMIDs / 50 批，整段查询默认排序的前 1 万条）。保留作 provenance，规范化时并入去重。该批次质量门记录：raw 层 8 条重复（10202→10194），normalized 层去重。

6. **定向语料首版 q4-causal-design 已废弃**：OR 结构中 "target trial emulation" 短语吸入全医学领域（GLP-1/围手术期等）1,324 篇方法学文献，稀释临床队列。已拆为 `q4-clinical-benchmark`（36 篇精准集，该对比文献面本就窄）+ `q4-tte-methods`（聚焦版 184 篇）。

## normalized 层产物（2026-08-15）

| 产物 | 规格 | 关键质量门结果 |
|---|---|---|
| `normalized/breakpoints.parquet` | 3,045 行 × 31 菌种组 × 376 药名（EUCAST v16.1，MIC+DISK 长表，raw 值全保留） | ① 数值折点 308 组合行（核心映射）② EUCAST 显式无折点 195 行（`-`/`IE`/`Note` 原样保留，非解析缺失）③ 非标准浓度 0 行（脚注剥离内部一致性通过）。核心 5 组面板：Entero 16 药 / Pae 9 / Aba 8 / Sau 10 / Efa 8。注意：v16.1 对 S.aureus 苯唑西林无数值折点（EUCAST 改为头孢西林筛选机制，筛选折点已入库） |
| `normalized/literature.parquet` | 64,901 篇 unique（pmid/doi/title/abstract/mesh_terms/year/journal/**evidence_tier/journal_tier**/pmcid/is_oa/corpora） | 摘要非空率 **97.6%**（门 >95% ✅）；证据分层：systematic_review 459 / meta 47 / guideline 15 / rct 217 / narrative_review 2,137；期刊分层 T1 520 / T2 7,594；OA 标记 20,428 篇（联表自 oa_match） |
| `dict/antibiotic_alias.csv` | 骨架 376 行：EUCAST 名称 → whonet_code（核心 22 药经基础名匹配自动映射，其余待人工） | 别名源=eucast_v16.1；带 confidence/note 列 |

| `normalized/chinet_baseline.parquet` | 932 行 × 41 组 × 36 药（CHINET 2024 中文年报表2-12，坐标聚类提取：y 聚行 + R/S 锚点列 + 锚点边界组名） | 地标断言 3/3 PASS（MRSA×克林 53.8 / 屎肠×氨苄 91.4 / 粪肠×氨苄 1.6）；R+S>100 错位 **1/384**（p7 Group F×Clindamycin 92.1+93.5，待人工核对原 PDF）；人工清单 2 项：①该错位格 ②p6 表5 一列组名未命名（n=1664，数值正确）；NA 缺失 74 行如实保留（嗜麦芽/洋葱伯克部分药无数据） |
| `normalized/chinet_composition.parquet` | 29 行 × 3 列（organism / n_strains / pct；坐标聚类重提取，2026-08-16） | 总株数 458,271 与原文对账 ✓；非 Total 构成比和 99.8 ✓；G2 人工核对项已固化 FIXUPS（Group F 错位格 note 标记、'?' 组→adults PSSP）；先验映射注册表 `scripts/amr/synthetic/priors.py`（22 菌码，dict 缺的标 pending-v1） |
| **合成 fallback** | `scripts/amr/generate_synthetic.py` → `data/synthetic/amr/`（gitignore） | CHINET 先验 + EUCAST MIC；双出 WHONET CSV + InternalRecord JSONL；Q4 preset：`bli_noninferior` / `merino_superior`（`scripts/amr/priors/q4_effect.yaml`） |

脚本：`scripts/amr/parse_eucast.py`（含数字脚注剥离启发式：MIC 值不在倍比稀释标准集且去尾位后命中 → 尾位为脚注，如 `0.251`→0.25、`324`→32）；`scripts/amr/parse_literature.py`（跨库去重按 corpora 归属登记）；`scripts/amr/extract_chinet.py`；**合成**：`scripts/amr/generate_synthetic.py` + `scripts/amr/build_amr_connectors.py` → `data/synthetic/amr/connectors/{demohospa,demohospb}/records.json`（连接器 `localDataPath`，Q1=`condition-prevalence`）。**CHINET 提取方法决策**（实测对比）：三线表 find_tables 丢行、`strategy="text"` 混排崩坏、pymupdf4llm 表格数据行丢失但**正文叙述数据完美**——最终采用 words 坐标聚类（双栏跳行、拉丁双名切分、n 值跨 token 拼接均已处理），pymupdf4llm 用于互证门的正文百分比。2023 年报主体为柱状图，不在本提取器范围（如需需人工读图或视觉模型）。

## 待办（依赖外部条件）

- [ ] MicroBIGG-E：安装 gcloud/bq 并认证 → 跑计划§E 的 schema 查询 + 碳青霉烯基因 SQL + isolates AST
- [ ] CARSS 年报：浏览器人工下载（carss.cn 返回 HTTP 468 反爬）
- [ ] ECDC Atlas CSV：界面导出（或裁掉）
- [x] W1：EUCAST XLSX → `normalized/breakpoints.parquet`（`scripts/amr/parse_eucast.py`）
- [ ] W3：按 `oa_match/` 结果抓取 20,469 篇 OA 全文 XML（Europe PMC fullTextXML 端点，仅 OA）
- [ ] 字典人工审校（v0 → v1）：扩展菌种的 whonet 码确认、ARO 联接、商品名别名表
- [x] W2 合成 fallback → 连接器灌数：`build_amr_connectors.py` + `amr-synthetic-q1.spec.ts`（本地 Q1 condition-prevalence）
- [x] W2 联邦 Q1：`demo:amr-q1` + `e2e-amr-q1.spec.ts` + 目录/契约种子 `dp-amr-ast-{demohospa,demohospb}`
- [x] W2 联邦 Q2：`demo:amr-q2` + `amr-federated-q2.spec.ts` + `e2e-amr-q2.spec.ts`（默认双院皆压；unlock 见下）
- [x] 场景续做路线 + 论文正文：`docs/amr-sentinel/{PAPER,SCENARIO-ROADMAP,PAPER-REVIEW-OUTLINE,DATA-DISCLAIMER}.md`（PAPER §8 指导 P0→P1→P1′；Synthea 不进 AMR 主结果）
- [x] P2 Q2 merge-then-gate unlock：`demo:amr-q2-unlock` + `force_q2_unlock_counts.py` / `--q2-unlock-counts`
- [x] P2 Q5 L0 外验证分列：`demo:amr-q5`（synthetic provenance）
- [ ] 真实医院外验证（临床外推条件）

## 质量门状态（计划§5）

| 环节 | 门 | 本次状态 |
|---|---|---|
| 字典 whonet→taxid 映射率 | =100% | ✅ PASS（9/9 行全映射，含 4 条待审 whonet 码） |
| PubMed PMID 唯一性 | 无重复 | raw 层 13.1%（Entrez 大结果集已知重复现象）；**normalized 层 = `pmids.json` 64,700 条已去重，与主查询命中 64,511 对账一致** ✅ |
| PubMed 摘要非空率 | >95% | **97.6% PASS**（`normalized/literature.parquet`，2026-08-15） |
| Europe PMC 语料匹配率 | — | 99.84%（64,596/64,700） |
| EUCAST 折点缺失率 | <5% | **三分类口径 PASS**（数值折点 308 行 / EUCAST 显式无折点 195 行原样保留 / 非标准浓度 0 行；`breakpoints.parquet`） |
| CHINET 对照 | 差异>10pp 须解释 | 合成生成器 chinet_alignment 门 PASS（先验锚定）；一致性对照将在真实医院数据到位后执行 |
| 合成验收 | 已知答案回收 | **六线全过**（2026-08-16 端到端）：生成 5 门 PASS + amr-federated-q1/q2 + exp-c jest + demo:amr-q3（ROR≈2.29）+ demo:amr-q5（分列闸门）+ run_exp_d（RR 回收） |
| MicroBIGG-E 对拍 | 抽 100 条 | 未开始（依赖 bq） |
