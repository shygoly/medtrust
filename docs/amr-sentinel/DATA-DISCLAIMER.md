# AMR 数据声明（规范短文）

> 权威展开见 [`PAPER.md`](./PAPER.md) 文首「数据声明」与正文复申。  
> 提纲索引见 [`PAPER-REVIEW-OUTLINE.md`](./PAPER-REVIEW-OUTLINE.md)。  
> 工程续做见 [`SCENARIO-ROADMAP.md`](./SCENARIO-ROADMAP.md)（验收句式以 PAPER §8 为准）。

## 三条硬规则

1. **AMR 主结果** = CHINET 先验 + EUCAST 折点约束的 **synthetic AST / episodes**（`scripts/amr/generate_synthetic.py`）。表述用 *CHINET-prior synthetic* / *simulated isolates*。
2. **Synthea ≠ AMR 证据**。Synthea 仅服务通用 EHR/CKD 联邦演示；**禁止**进入耐药率、罕见表型、因果 HR 等 AMR 主结果表或摘要结论。
3. **真实院内 WHONET/HIS** 是临床流行病学与疗效外推的前提。仅有合成数据时，只可发表方法学 / 系统 / 隐私验证，不可写成真实耐药负担或用药推荐。

## 可发 vs 不可发（一句话）

| 赛道 | 合成 AST | Synthea | 真实院数据 |
|---|---|---|---|
| 方法/系统/联邦闸门论文 | 可 | 仅作非 AMR 对照 | 加强 |
| 真实 R% / 临床疗效结论 | 否 | 否 | 必需 |

## 图表标注模板

`Figure X. Resistance rates on CHINET-prior synthetic isolates (simulation; not real hospital epidemiology).`
