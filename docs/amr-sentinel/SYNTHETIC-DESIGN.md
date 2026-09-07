# AMR Sentinel — 合成数据生成器设计

> **状态更新 2026-08-16（重基线）**：本设计文档撰写期间，并行工作流已交付实现——`scripts/amr/generate_synthetic.py` + `scripts/amr/lib/`（1303 行：episode/MIC/emit/validate/gates）+ PAPER.md 实验 A–D 框架 + connector 联邦测试（`amr-federated-q1/q2.spec.ts`，数据到位自动激活）。**本文的 S0–S5 设计已由实现落地并验证**（2026-08-16 端到端：生成 2×5000 episodes、5 gates PASS、connector 4 个 jest spec 全过、实验 C/D PASS）。差异与剩余项见 §9。

> 版本 v0.1 ｜ 2026-08-16 ｜ 上游：[PROPOSAL.md](./PROPOSAL.md)（Q1–Q5 / R1 / R2 / T0-T1 / 连接键）· [DATA-ACQUISITION.md §7](./DATA-ACQUISITION.md)（合成 fallback 铁律）
> 数据先验已就位：`data/normalized/chinet_baseline.parquet`（41 组×36 药 R/S 率）、`chinet_composition.parquet`、`breakpoints.parquet`（EUCAST v16.1）、`data/dict/` 三码表

---

## 0. 设计原则（从方案直接推导）

1. **合成的是数据，不是系统行为**（§7 铁律）：编排、契约、PEP、输出闸门、跨院聚合全部走 MedTrust 真实代码路径。生成器只产出连接器本地数据。
2. **已知答案**（可验证性）：Q3/Q4 的关联与因果效应由生成器**注入已知真值**（如 HR_true=0.75），验收 = 分析管线能否回收真值。这把合成数据从"演示道具"升级为"分析管线的回归测试集"。
3. **保留原始测量**（T0 铁律）：每株生成 **raw MIC**（稀释度序列），本院判读与 EUCAST 重判读都从 MIC 派生——重判读引擎由此被真实锻炼（R2）。
4. **耐药相关性是结构性的**：耐药不是独立伯努利。ESBL 株头孢类联动耐药、碳青霉烯酶株 bla 联动——用潜在变量模型生成，否则 Q5 预测任务会失真。
5. **固定种子可复现**（对齐 D-DATA-1）：产物 gitignore，任何时点可从 seed 重生成。

## 1. 管线总览（六步）

```
chinet_baseline(R/S率) ─┐
chinet_composition(构成比)─┤→ S0 先验装载（组名/药名→dict规范码）
breakpoints(EUCAST v16.1)─┤        ↓
dict/ 三码表 ────────────┘   S1 两院 profile（构成扰动/折点体系/用药强度/科室）
                                    ↓
                        S2 菌株级生成 T0（菌种×标本×科室×时间×MIC×联动耐药×罕见表型）
                                    ↓
                        S3 T1 生成（医嘱/结局/Charlson，注入 HR_true 与 DDD 信号）
                                    ↓
                        S4 双格式输出（WHONET 风 CSV + connector 本地 SQLite）
                                    ↓
                        S5 已知答案验收门（七项，见 §6）
```

## 2. S1 两院 profile（差异即叙事）

| 维度 | huashan（华山） | ruijin（瑞金） | 设计意图 |
|---|---|---|---|
| 菌种构成 | CHINET 全国先验 × δ₁ 扰动 | CHINET × δ₂ 扰动 | 跨院构成差异真实存在 |
| 本院折点体系 | **CLSI M100 2023** | **EUCAST v16.1** | 同一 MIC 两院本院判读可能不同 → 重判读后一致（R2 叙事的数据基础） |
| ICU 分离株占比 | 高 | 中 | Q1 分层有意义 |
| 碳青霉烯经验用药偏好 | 高 | 低 | Q4 两臂均衡性 |
| DDDs 基线 | 高且科室分化大 | 中 | Q3 信号源 |
| 罕见表型种子 | VISA 2 株、罕见菌 3-4 株 | 不同罕见菌 3-4 株 | Q2 单院 n<5 压制 → 联邦解锁 |

CLSI 折点数值表作为生成器常量文件（手工录入 22 核心药，**不公开分发**，仅本地用于生成判读差异；输出物只含本院判读结果与 raw MIC）。

## 3. S2 菌株级生成（T0 schema，逐字段对齐计划 §6）

**采样单元**：一次"感染事件"= 患者×采样日期窗口（与 T1 的连接键在生成期即绑定）。

| 字段 | 生成规则 |
|---|---|
| `patient_hash` | `uuid5(seed, 患者序号)`；同一患者可多次分离（重复感染，供 Q4 配对与聚类敏感性分析） |
| `age_band` / `sex` | 全院分布 + 菌种条件修正（尿路→老年女性富集） |
| `ward` / `icu_flag` | 院 profile 的科室分布；ICU 菌种构成偏 MDR |
| `specimen_type` | 菌种条件分布：血→凝固酶阴性葡萄球菌污染谱、尿→肠杆菌富集、痰→铜绿/鲍曼富集（`dict/specimen.csv` 标准码） |
| `sampled_at` | 2023-01→2025-12 月度；**注入时间趋势**：CRE 相对年增 +3%、某药耐药缓慢下降 −1%/年（Q1 趋势项有真值） |
| `organism` | 构成比抽样（`chinet_composition` 拆列 + 罕见菌池）；`dict/organism.csv` whonet 码 |
| **MIC 向量**（核心 22 药） | 三层模型（§3.1） |
| `sir_native` + `bp_system_ver` | 按本院折点体系判读；`bp_system_ver` 必填（T0 铁律） |
| `esbl_flag` / `carbapenemase_flag` | 潜在变量显式化：ESBL→青霉素/头孢（除头霉素）联动 R；KPC/NDM→碳青霉烯联动 R（bla 表型真值，Q5 标签） |

### 3.1 MIC 三层生成模型（关键）

```
第 1 层 菌株潜在耐药倾向 z ~ N(0,1)          （住院天数/抗生素暴露的代理）
第 2 层 药类层面: z_class = a·z + ε_class    （ESBL/碳青霉烯酶等机制载荷 a）
第 3 层 单药: P(R_{i,j}) = logistic(β0_{i,j} + β1_j·z_class_i)
              β0 由 chinet_baseline 的 R 率反解（logit 校准，保持边际率=CHINET）
MIC 落点: S 类 → 断点 S 下 1-2 个稀释度；I 类 → (S,R) 区间；R 类 → R 上 1-3 稀释度
         （稀释度序列取自 breakpoints.parquet 的标准倍比集，log2 均匀）
```

边际率锚定 CHINET（分布对拍门），相关结构由 z 载荷产生（Q5 可学习）。ICU 株 z 平移 +0.5σ（真实现象：ICU 更耐药）。

## 4. S3 T1 生成（Q3/Q4 的已知答案）

**医嘱**（血培养阳性事件的经验治疗）：
- 臂分配：`P(carbapenem) = logistic(γ0 + γ1·ICU + γ2·Charlson + γ3·既往90d碳青霉烯暴露)`——**适应症混杂按指示构造**：重症→更可能用碳青霉烯→未调整比较显示碳青霉烯"更差"，调整后显示更优（演示 PSM 价值的核心结构）
- **注入 `HR_true = 0.75`**：30 天生存时间按 Cox 危险模型生成（臂效应 ln0.75 + ageBand/ICU/Charlson 危险载荷），删失= administrative

**DDDs 信号（Q3）**：
- 科室月度 DDDs/100人天：基线 + 科室效应；**注入关联**：DDDs 高科室的耐药概率 OR_true=1.8（通过第 1 层 z 与 DDDs 联动实现）
- 验收 = disprofectionality 管线（已有 `disproportionality.ts`）ROR/PRR 检出该信号

**Charlson / 侵入性操作 / 转科**：从年龄/科室条件分布生成，仅作协变量。

## 5. S4 输出与灌入

- `synthetic/huashan/`、`synthetic/ruijin/` 各产出：`isolates.csv`（T0）+ `orders.csv` + `outcomes.csv`（T1）+ `whonet_export.csv`（模拟医院 WHONET 导出形态，含商品名列——顺带锻炼别名表）
- **connector 本地库**：直接生成 SQLite 落 `apps/connector` 本地 schema（`packages/database/src/connector`）。⚠️ 当前 schema 为 CKD/Synthea 形态，**需新增 AMR 表**（`isolate` / `ast_result` / `med_order` / `outcome_event`）——见 §8 未完成清单 G3
- 量级：每院 ~6k 株/年 × 3 年 × 2 院 ≈ 3.6 万株、MIC 记录 ~80 万条；生成目标 <30s

## 6. S5 验收门（七项，全部固化进 `synthetic/validate.py`）

| # | 门 | 判据 | 对应 |
|---|---|---|---|
| V1 | 分布对拍 | 合成总体 R 率 vs CHINET 同组合差 **<10pp**（计划 §5 原门） | 先验保真 |
| V2 | 重判读一致性 | EUCAST 重判后两院同菌同药率差 **<** 本院判读下的率差 | R2 叙事 |
| V3 | Q1 分层率 | 各层 95%CI 覆盖生成真值比例 ≥ 94% | Q1 |
| V4 | Q2 闸门 | 罕见表型单院 n<5 被 output-gate 抑制；联邦合并后 n≥10 发布 | Q2 差异化 |
| V5 | Q3 信号 | ROR/PRR 检出注入的 DDD-耐药关联（OR_true=1.8） | Q3 |
| V6 | Q4 因果 | PSM+ Cox 回收 HR ∈ [0.70, 0.85]（真值 0.75） | Q4 |
| V7 | Q5 迁移 | 模型 A 院训练→B 院验证 AUC 落差符合注入的分布偏移设定 | Q5 |

V4–V7 即"分析管线回归测试集"：以后任何 rws-orchestrator 改动跑一遍即知有没有破坏检测能力。

## 7. 文件规划

```
scripts/amr/synthetic/
├── generate.py        # 主生成器（S0–S4，--seed --hospital huashan|ruijin）
├── clsi_m100_2023.py  # CLSI 折点常量（本地私有，不公开分发）
├── priors.py          # chinet_baseline/composition 装载 + dict 映射
└── validate.py        # S5 七门（读 synthetic/ 产物，输出报告）
docs/amr-sentinel/SYNTHETIC-DESIGN.md   # 本文
```

## 9. 实现落地差异与剩余项（2026-08-16 重基线）

实现（`scripts/amr/generate_synthetic.py` + `lib/`）与本设计的对应与偏差：

| 设计项 | 实现现状 | 偏差说明 |
|---|---|---|
| S0 先验 | `lib/priors.py` ResistancePrior 直读 chinet_baseline.parquet（schema 与 extractor 输出完全对接，含 Group F 错位格 clip 归一） | ✅ 对齐；`scripts/amr/synthetic/priors.py`（本会话产物）额外提供 composition→dict 映射注册表，待收编 |
| S1 两院 profile | `lib/hospital_profile.py`（organism_tilt 差异化） | 折点差异用 **native_clsi_like_v0 合成偏移**（`priors/native_breakpoint_offsets.yaml`，刻意不宣称 CLSI 版权合规）；`synthetic/clsi_m100_2023.py`（5 值已查证）为可选现实性升级 profile v1 |
| S2 菌株+MIC | `lib/episode.py` + `lib/mic.py`（EUCAST 网格落点）+ Q2 罕见表型注入 | ✅ |
| S3 T1/Q4 | `priors/q4_effect.yaml`（bli_noninferior / merino_superior 预设，注入 HR 带） | ✅ |
| S4 输出 | `lib/emit.py` → hospital bundle + **connector `records.json`**（internal_records 格式，LocalDataLoader 消费）——优于设计的 WHONET CSV+SQLite 方案（复用既有 connector 契约） | 设计被超越 |
| S5 验收 | `lib/validate.py` run_all_gates 5 门：chinet_alignment / breakpoint_consistency / panel_completeness / q4_effect / rare_phenotype_q2 ——对应本文 V1/V2/面板/V6/V4 | **V3（Q1 分层 CI 覆盖）、V5（Q3 失衡信号）、V7（Q5 迁移）未覆盖**，即下述剩余项 R2/R3 |

**剩余项**：
- R1（原 G3）：真实医院 WHONET CSV → connector 采集器（合成走 records.json，真实数据仍需对齐层）
- R2：**Q3 实验 runner**（DDDs-耐药失衡信号，PAPER §4.4 已有方法定义，无脚本）——生成器需补 T1 医嘱强度注入
- R3：Q5 薄实验（PAPER §5.3c 标 P2）
- R4：exp-C 可选升级 native_clsi_2023_subset profile（真实 CLSI 值，42/47 待核）
- R5：字典 v1 审校收编（`synthetic/priors.py` 映射注册表 + pending 码）
